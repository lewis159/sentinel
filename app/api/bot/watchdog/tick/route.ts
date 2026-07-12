// PA delivery-watchdog — one sweep of estate CI/PR health, posted to #pa-status.
//
//   POST /api/bot/watchdog/tick
//   body: { force?: boolean }        (force bypasses the change-dedup below)
//   → 200 { status, checked, alerted, signature?, posted?, summary?, error? }
//
// Token-gated (BOT tier, OPS_BOT_TOKEN) so an EXTERNAL scheduler can hit it on an
// interval — Sentinel has no in-process job runner, so the cron lives outside
// (systemd timer / Portainer cron / GitHub Actions schedule / cron-job.org) and
// pokes this endpoint. Example: `*/15 * * * *  curl -fsS -X POST \
//   -H "x-ingest-token: $OPS_BOT_TOKEN" https://ops.scribuo.com/api/bot/watchdog/tick`.
//
// One sweep = call getDeployStatus (read-only) → if any workflow FAILED or any PR
// is STALE (≥2d), call broadcastStatus to post a headline to #pa-status. Idempotent
// across ticks: we remember the last alerted signature in-memory and only re-post
// when the failing/stale set CHANGES (or when `force` is set), so an external cron
// on a tight interval never spams the channel while the same build stays red.
//
// Behind HERMES_BRAIN_ENABLED — returns { status:'disabled' } when off.
import { brainEnabled } from '@/lib/hermes/brain/flags';
import { getDeployStatusTool } from '@/lib/hermes/brain/tools/deploy';
import { broadcastStatusTool } from '@/lib/hermes/brain/tools/broadcast';
import type { ToolContext } from '@/lib/hermes/brain/tools/types';
import { authBot, botJson, botOptions } from '@/lib/bot-http';

export const dynamic = 'force-dynamic';

// Shape returned by getDeployStatus in its `data` payload (see tools/deploy.ts).
type RepoStatus = {
  repo: string;
  latestRun?: { name: string; branch: string; status: string; conclusion: string | null; url: string };
  openPRs: { number: number; title: string; ageDays: number; url: string }[];
  error?: string;
};

// Last alerted signature — in-memory dedup so repeated ticks with the same red
// state don't repost. Non-persistent by design (mirrors the bot's in-memory
// state); a restart re-alerts once, which is harmless and arguably desirable.
declare global {
  // eslint-disable-next-line no-var
  var _paWatchdogSig: string | undefined;
}

// Reduce the raw status rows to the set of things worth shouting about, and a
// stable signature for that set so we can tell "same failure" from "new failure".
function findProblems(rows: RepoStatus[]): { lines: string[]; signature: string } {
  const lines: string[] = [];
  const sigParts: string[] = [];
  for (const r of rows) {
    const run = r.latestRun;
    // A run is "bad" if it completed with a non-success conclusion, or is stuck.
    if (run && run.status === 'completed' && run.conclusion && run.conclusion !== 'success') {
      lines.push(`🔴 ${r.repo}: ${run.name} on ${run.branch} → ${run.conclusion}`);
      sigParts.push(`${r.repo}#run:${run.name}:${run.branch}:${run.conclusion}`);
    }
    const stale = r.openPRs.filter((p) => p.ageDays >= 2);
    for (const p of stale) {
      lines.push(`🕒 ${r.repo}: PR #${p.number} open ${p.ageDays}d — ${p.title}`);
      // Bucket the age so day-by-day drift doesn't count as a "new" problem until
      // it materially changes; the presence of the stale PR is the signal.
      sigParts.push(`${r.repo}#pr:${p.number}`);
    }
  }
  return { lines, signature: sigParts.sort().join('|') };
}

export async function OPTIONS() {
  return botOptions();
}

export async function POST(req: Request) {
  const auth = await authBot(req);
  if (!auth.ok) return auth.res;

  if (!brainEnabled()) {
    return botJson({
      status: 'disabled',
      error: 'Hermes Brain is disabled — set HERMES_BRAIN_ENABLED=1 to enable.',
    });
  }

  let force = false;
  try {
    const body: any = JSON.parse(auth.raw || '{}');
    force = body?.force === true;
  } catch {
    /* body optional */
  }

  const ctx: ToolContext = { threadId: 'watchdog', persona: 'pa', actor: 'pa:watchdog' };

  // 1) Read estate CI/PR status (read-only, autonomy 'auto').
  const status = await getDeployStatusTool.run({}, ctx);
  if (!status.ok) {
    // Not configured / transient — report but don't treat as an alert.
    return botJson({
      status: 'skipped',
      checked: false,
      alerted: false,
      summary: status.summary,
      error: status.error,
    });
  }

  const rows = (Array.isArray(status.data) ? status.data : []) as RepoStatus[];
  const { lines, signature } = findProblems(rows);

  // 2) Nothing wrong → clear the dedup memory so the next failure re-alerts.
  if (lines.length === 0) {
    global._paWatchdogSig = '';
    return botJson({ status: 'ok', checked: true, alerted: false, summary: 'All green.' });
  }

  // 3) Same failing set as last alert → stay quiet (idempotent on an interval).
  if (!force && signature === global._paWatchdogSig) {
    return botJson({
      status: 'ok',
      checked: true,
      alerted: false,
      signature,
      summary: 'Unchanged since last alert — not reposting.',
    });
  }

  // 4) New/changed problem set → broadcast the headline to #pa-status.
  const text = `⚠️ Watchdog: ${lines.length} issue(s)\n${lines.join('\n')}`;
  const posted = await broadcastStatusTool.run({ text }, ctx);
  global._paWatchdogSig = signature;

  return botJson({
    status: 'ok',
    checked: true,
    alerted: true,
    signature,
    posted: posted.ok,
    summary: posted.ok ? text : `broadcast failed: ${posted.error ?? posted.summary}`,
  });
}
