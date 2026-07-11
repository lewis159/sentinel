// The Brain graph — a ReAct-style agent (reason → tool-call → observe → answer)
// built on LangGraph.js, with an INTERRUPT before any tool whose effective
// autonomy is 'gated'.
//
// State (checkpointed per thread in the hermes schema):
//   messages  — the OpenRouter-wire conversation (system/user/assistant/tool).
//   persona   — the persona id driving this thread (e.g. 'pa').
//   actor     — audit label for AUTO tool side-effects on this thread.
//
// Flow:
//   agent node  → callModel(messages, tools). Appends the assistant reply. If it
//                 asked for tools → go to the tools node, else END.
//   tools node  → PHASE 1: for every gated call, interrupt() (NO side effects) to
//                 collect an approval decision. PHASE 2 (only once no interrupt is
//                 pending): run auto tools + approved gated tools, append the tool
//                 observations. Denied calls get a rejection observation so the
//                 model can tell the principal.
//
// Because a node that interrupts is RE-RUN from the top on resume, all tool
// side-effects happen in PHASE 2 — strictly after every interrupt has resolved —
// so nothing executes twice. The caller (runPaTurn) never sees side effects; it
// just detects the pending interrupt and raises a proposal. The Approve path
// resumes the graph, which runs PHASE 2 for real.
import 'server-only';
import {
  StateGraph,
  Annotation,
  interrupt,
  Command,
  START,
  END,
} from '@langchain/langgraph';
import { callModel, type ChatMsg, type ToolCall } from './model';
import { getPersona, autonomyFor, type Persona } from './personas';
import { getTool, toolsFor, toOpenAiTools } from './tools';
import type { ToolContext } from './tools/types';
import { getCheckpointer } from './checkpointer';
import { brainEnabled } from './flags';

// ---------- decision carried across an interrupt on resume ----------
export type ApprovalDecision = { approved: boolean; by: string; reason?: string };

// ---------- graph state ----------
const keepScalar = <T,>(prev: T | undefined, next: T | undefined): T | undefined =>
  next ?? prev;

const BrainState = Annotation.Root({
  messages: Annotation<ChatMsg[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  persona: Annotation<string | undefined>({ reducer: keepScalar, default: () => undefined }),
  actor: Annotation<string | undefined>({ reducer: keepScalar, default: () => undefined }),
});
type BrainStateT = typeof BrainState.State;

// Rebuild wire tool_calls for the assistant message so a later /chat/completions
// call has matching tool_call ids for the tool-role observations.
function wireToolCalls(calls: ToolCall[]) {
  return calls.map((c) => ({
    id: c.id,
    type: 'function' as const,
    function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
  }));
}

// ---------- agent node ----------
async function agentNode(state: BrainStateT): Promise<Partial<BrainStateT>> {
  const persona = getPersona(state.persona ?? 'pa');
  const tools = persona ? toolsFor(persona.allowedTools) : [];
  const res = await callModel({
    messages: state.messages,
    tools: toOpenAiTools(tools),
    model: persona?.model,
  });

  if (!res.ok) {
    // Surface the error as an assistant turn so the thread stays coherent.
    return { messages: [{ role: 'assistant', content: `⚠️ Brain error: ${res.error}` }] };
  }

  const assistant: ChatMsg = {
    role: 'assistant',
    content: res.content || (res.toolCalls.length ? '' : ''),
    ...(res.toolCalls.length ? { tool_calls: wireToolCalls(res.toolCalls) } : {}),
  };
  return { messages: [assistant] };
}

// Route after the agent: if it requested tools, go run them; else finish.
function routeAfterAgent(state: BrainStateT): 'tools' | typeof END {
  const last = state.messages[state.messages.length - 1];
  if (last && last.role === 'assistant' && last.tool_calls && last.tool_calls.length > 0) {
    return 'tools';
  }
  return END;
}

// ---------- tools node ----------
async function toolsNode(state: BrainStateT): Promise<Partial<BrainStateT>> {
  const persona = getPersona(state.persona ?? 'pa') as Persona | undefined;
  const last = state.messages[state.messages.length - 1];
  const calls = last && last.role === 'assistant' ? last.tool_calls ?? [] : [];

  // Parse each wire call back into {id, name, args, gated}.
  const parsed = calls.map((wc) => {
    let args: Record<string, unknown> = {};
    try {
      args = wc.function.arguments ? JSON.parse(wc.function.arguments) : {};
    } catch {
      args = {};
    }
    const tool = getTool(wc.function.name);
    const gated =
      tool && persona ? autonomyFor(persona, tool.name, tool.autonomy) === 'gated' : false;
    return { id: wc.id, name: wc.function.name, args, tool, gated };
  });

  // PHASE 1 — collect approval decisions for gated calls. interrupt() throws the
  // first time (pausing the graph) and returns the decision on resume. No tool
  // side-effects happen here, so re-running the node on resume is safe.
  const decisions = new Map<string, ApprovalDecision>();
  for (const c of parsed) {
    if (!c.gated || !c.tool) continue;
    const decision = interrupt({
      kind: 'approval',
      tool: c.name,
      args: c.args,
      describe: c.tool.describeCall ? c.tool.describeCall(c.args) : `${c.name}(${JSON.stringify(c.args)})`,
      callId: c.id,
    }) as ApprovalDecision;
    decisions.set(c.id, decision);
  }

  // PHASE 2 — execute. Only reached once every interrupt above has resolved.
  const actor = state.actor ?? 'pa';
  const persona_id = state.persona ?? 'pa';
  const threadId = ''; // not needed for run; ctx.threadId filled below per-call
  const out: ChatMsg[] = [];
  for (const c of parsed) {
    if (!c.tool) {
      out.push({ role: 'tool', tool_call_id: c.id, content: `Unknown tool: ${c.name}` });
      continue;
    }
    if (c.gated) {
      const d = decisions.get(c.id);
      if (!d || !d.approved) {
        out.push({
          role: 'tool',
          tool_call_id: c.id,
          content: `Action NOT executed — ${d?.by ?? 'operator'} declined${d?.reason ? `: ${d.reason}` : ''}. Do not retry; tell the principal it was declined.`,
        });
        continue;
      }
      const ctx: ToolContext = { threadId: threadId || 'resume', persona: persona_id, actor: d.by };
      const result = await c.tool.run(c.args, ctx);
      out.push({
        role: 'tool',
        tool_call_id: c.id,
        content: result.ok ? result.summary : `Failed: ${result.error ?? result.summary}`,
      });
    } else {
      const ctx: ToolContext = { threadId: threadId || 'auto', persona: persona_id, actor };
      const result = await c.tool.run(c.args, ctx);
      const body = result.data ? `${result.summary}\n\n${JSON.stringify(result.data)}` : result.summary;
      out.push({
        role: 'tool',
        tool_call_id: c.id,
        content: result.ok ? body : `Failed: ${result.error ?? result.summary}`,
      });
    }
  }
  return { messages: out };
}

// ---------- graph build (memoized per checkpointer) ----------
type Compiled = ReturnType<typeof compileGraph>;

declare global {
  // eslint-disable-next-line no-var
  var _brainGraph: { app: Compiled; hasCheckpointer: boolean } | undefined;
}

function compileGraph(checkpointer: Awaited<ReturnType<typeof getCheckpointer>>) {
  const g = new StateGraph(BrainState)
    .addNode('agent', agentNode)
    .addNode('tools', toolsNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', routeAfterAgent, ['tools', END])
    .addEdge('tools', 'agent');
  return g.compile(checkpointer ? { checkpointer } : undefined);
}

async function getGraph(): Promise<{ app: Compiled; hasCheckpointer: boolean }> {
  if (!global._brainGraph) {
    const checkpointer = await getCheckpointer();
    global._brainGraph = { app: compileGraph(checkpointer), hasCheckpointer: Boolean(checkpointer) };
  }
  return global._brainGraph;
}

// ---------- interrupt extraction ----------
export type PendingApproval = {
  tool: string;
  args: Record<string, unknown>;
  describe: string;
  callId: string;
};

function extractPending(snapshot: any): PendingApproval | null {
  const tasks = snapshot?.tasks ?? [];
  for (const t of tasks) {
    const interrupts = t?.interrupts ?? [];
    for (const intr of interrupts) {
      const v = intr?.value;
      if (v && v.kind === 'approval') {
        return { tool: v.tool, args: v.args ?? {}, describe: v.describe ?? '', callId: v.callId ?? '' };
      }
    }
  }
  return null;
}

function lastAssistantText(messages: ChatMsg[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) return m.content;
  }
  return '';
}

// ---------- public API ----------
export type PaTurnResult =
  | { status: 'disabled' }
  | { status: 'answered'; reply: string; model?: string }
  | { status: 'pending_approval'; pending: PendingApproval; reply: string }
  | { status: 'error'; error: string };

// Run one PA turn on a thread. Seeds the system prompt on the first message. If
// the model calls a gated tool the graph pauses and we return the pending action
// so the caller can raise a proposal.
export async function runPaTurn(opts: {
  threadId: string;
  message: string;
  persona?: string;
  actor?: string;
}): Promise<PaTurnResult> {
  if (!brainEnabled()) return { status: 'disabled' };
  const personaId = opts.persona ?? 'pa';
  const persona = getPersona(personaId);
  if (!persona) return { status: 'error', error: `unknown persona: ${personaId}` };

  try {
    const { app, hasCheckpointer } = await getGraph();
    const config = { configurable: { thread_id: opts.threadId }, recursionLimit: 25 };

    // Seed the system prompt only when the thread has no history yet. Without a
    // checkpointer (no DB) there's no persisted history, so always seed.
    const prior = hasCheckpointer ? await app.getState(config).catch(() => null) : null;
    const seeded = Boolean(prior && (prior.values as BrainStateT)?.messages?.length);
    const input: Partial<BrainStateT> = {
      messages: [
        ...(seeded ? [] : [{ role: 'system' as const, content: persona.systemPrompt }]),
        { role: 'user' as const, content: opts.message },
      ],
      ...(seeded ? {} : { persona: personaId, actor: opts.actor ?? personaId }),
    };

    const result = (await app.invoke(input, config)) as BrainStateT;

    // Detect a pending gated-tool interrupt (only possible with a checkpointer).
    if (hasCheckpointer) {
      const snapshot = await app.getState(config);
      const pending = extractPending(snapshot);
      if (pending) {
        return { status: 'pending_approval', pending, reply: lastAssistantText(result.messages) };
      }
    }
    return { status: 'answered', reply: lastAssistantText(result.messages) };
  } catch (e: any) {
    return { status: 'error', error: e?.message ?? 'brain turn failed' };
  }
}

export type ResumeResult =
  | { status: 'disabled' }
  | { status: 'answered'; reply: string; toolResult: string }
  | { status: 'error'; error: string };

// Resume a paused thread with an approval decision. On approve the gated tool
// runs for real inside the graph; we return the tool observation + the agent's
// follow-up reply so the caller can audit + notify.
export async function resumeThread(opts: {
  threadId: string;
  decision: ApprovalDecision;
}): Promise<ResumeResult> {
  if (!brainEnabled()) return { status: 'disabled' };
  try {
    const { app, hasCheckpointer } = await getGraph();
    if (!hasCheckpointer)
      return { status: 'error', error: 'no database — cannot resume a paused thread' };
    const config = { configurable: { thread_id: opts.threadId }, recursionLimit: 25 };
    const result = (await app.invoke(
      new Command({ resume: opts.decision }),
      config,
    )) as BrainStateT;

    // The most recent tool observation is the executed action's result.
    let toolResult = '';
    for (let i = result.messages.length - 1; i >= 0; i--) {
      const m = result.messages[i];
      if (m.role === 'tool') {
        toolResult = m.content;
        break;
      }
    }
    return { status: 'answered', reply: lastAssistantText(result.messages), toolResult };
  } catch (e: any) {
    return { status: 'error', error: e?.message ?? 'brain resume failed' };
  }
}
