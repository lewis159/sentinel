import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import HermesProviderSettings from '@/components/v2/HermesProviderSettings';
import HermesAutonomyDials from '@/components/v2/HermesAutonomyDials';
import '../settings.css';

export const dynamic = 'force-dynamic';

const PURPLE = '#8E86E6';

const AGENTS: { name: string; color: string }[] = [
  { name: 'Support', color: 'var(--accent)' },
  { name: 'Escalations', color: 'var(--high)' },
  { name: 'Security', color: 'var(--crit)' },
  { name: 'CFO/Billing', color: 'var(--ok)' },
  { name: 'Risk', color: PURPLE },
  { name: 'CTO', color: PURPLE },
  { name: 'Orchestrator', color: 'var(--sky)' },
];

const RULES: { cond: string; who: string[] }[] = [
  { cond: 'Recurring credit / cost request', who: ['Risk', 'You'] },
  { cond: 'Security vulnerability found', who: ['Security', 'Notify you'] },
  { cond: 'Any refund / money movement', who: ['You approve'] },
  { cond: 'Angry / churn-risk sentiment', who: ['Escalations'] },
];

export default async function V2HermesGovernancePage() {
  await requireSectionPage('admin');

  return (
    <div>
      <Link href="/v2/settings" className="v2-set-back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Settings
      </Link>

      {/* Header */}
      <div className="v2-set-head">
        <div>
          <div className="v2-eyebrow">Settings · Hermes</div>
          <h1 className="v2-h1">Hermes governance</h1>
          <div className="v2-sub">
            You hold the dials — set what each agent may do alone, what needs you, and when to escalate.
          </div>
        </div>
      </div>

      <div className="v2-set-content">
        {/* 0 — Provider · OpenRouter */}
        <div className="v2-card v2-set-hcard">
          <div className="v2-card-h">
            <div className="v2-set-ch">
              <h3>Provider · OpenRouter</h3>
              <span className="st">The model and API key Hermes agents run on.</span>
            </div>
          </div>
          <HermesProviderSettings />
        </div>

        {/* 1 — Agents */}
        <div className="v2-card v2-set-hcard">
          <div className="v2-card-h">
            <h3>Agents</h3>
            <span className="v2-pill ok">7 live</span>
          </div>
          <div className="v2-set-hbody">
            <div className="v2-set-agents">
              {AGENTS.map((a) => (
                <div key={a.name} className="v2-set-agent">
                  <span className="swatch" style={{ ['--ag' as string]: a.color }} />
                  {a.name}
                  <span className="v2-set-mini" aria-hidden />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 2 — Autonomy dials (live) — persona × tool modes + thresholds. These
            are the REAL gates the Brain reads (resolveAutonomy); saving persists
            to hermes.autonomy_config and changes gate behaviour with no redeploy. */}
        <div className="v2-card v2-set-hcard">
          <div className="v2-card-h">
            <div className="v2-set-ch">
              <h3>Autonomy dials</h3>
              <span className="st">
                What each persona may do per tool — auto, gated (needs approval), or draft-only.
                These are the live gates the Brain enforces.
              </span>
            </div>
          </div>
          <HermesAutonomyDials />
        </div>

        {/* 4 — Escalation routing */}
        <div className="v2-card v2-set-hcard">
          <div className="v2-card-h">
            <div className="v2-set-ch">
              <h3>Escalation routing</h3>
              <span className="st">Condition → who gets pulled in.</span>
            </div>
          </div>
          <div className="v2-set-hbody">
            <div className="v2-set-rules">
              {RULES.map((r) => (
                <div key={r.cond} className="v2-set-rule">
                  <span className="cond">{r.cond}</span>
                  <span className="arr">→</span>
                  <span className="who">
                    {r.who.map((w) => (
                      <span key={w} className="v2-pill info">
                        {w}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
            <div className="v2-set-add">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add rule
            </div>
          </div>
        </div>

        {/* 5 — Customer-facing */}
        <div className="v2-card v2-set-hcard">
          <div className="v2-card-h">
            <div className="v2-set-ch">
              <h3>Customer-facing</h3>
              <span className="st">What Hermes may say directly to customers today.</span>
            </div>
            <span className="v2-pill info">Phase 1 · copilot</span>
          </div>
          <div className="v2-set-hbody">
            <div className="v2-set-cfchips">
              <span className="v2-set-cfchip">
                FAQ · direct
                <span className="v2-set-mini" aria-hidden />
              </span>
              <span className="v2-set-cfchip">
                Status · direct
                <span className="v2-set-mini" aria-hidden />
              </span>
              <span className="v2-set-cfchip off">
                Account basics
                <span className="v2-set-switch" aria-hidden />
              </span>
              <span className="v2-set-cfchip locked">
                Refund · never
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
              </span>
              <span className="v2-set-cfchip locked">
                Cancellation · never
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
              </span>
            </div>

            <div className="v2-set-checks">
              <div className="v2-set-check">
                <span className="box">✓</span>
                Disclose &apos;AI&apos; in first message
              </div>
              <div className="v2-set-check">
                <span className="box">✓</span>
                Supervisor fact/policy check before any send
              </div>
              <div className="v2-set-check">
                <span className="box">✓</span>
                Enterprise plan → always human-reviewed
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
