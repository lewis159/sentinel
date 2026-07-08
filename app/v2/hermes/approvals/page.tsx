import { requireSectionPage } from '@/lib/auth';
import ApprovalsQueue from '@/components/v2/ApprovalsQueue';
import './approvals.css';

export const dynamic = 'force-dynamic';

// Filter chips are presentational only for now — the live queue below is driven
// by real persisted proposals via <ApprovalsQueue/>.
const FILTERS: { label: string; count: number; on?: boolean }[] = [
  { label: 'All', count: 6, on: true },
  { label: 'Support', count: 2 },
  { label: 'Billing', count: 1 },
  { label: 'Access', count: 1 },
  { label: 'Security', count: 1 },
  { label: 'KB', count: 1 },
];

function LockIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export default async function HermesApprovalsPage() {
  await requireSectionPage('hermes');

  return (
    <div>
      {/* Header */}
      <div className="v2-eyebrow">Hermes · Oversight</div>
      <h1 className="v2-h1">Approval queue</h1>
      <div className="v2-sub">
        Actions Hermes has drafted are waiting on your review · handled{' '}
        <span className="v2-apq-green">autonomously</span> where guardrails allow
      </div>

      {/* Filter chips */}
      <div className="v2-apq-chips">
        {FILTERS.map((f) => (
          <button key={f.label} className={`v2-apq-chip${f.on ? ' on' : ''}`}>
            {f.label} <span className="ct">· {f.count}</span>
          </button>
        ))}
      </div>

      {/* Live queue — real persisted proposals */}
      <ApprovalsQueue />

      {/* Footer note */}
      <div className="v2-apq-foot">
        <LockIcon />
        Approve/deny in batch, or open the chat bubble to talk to the agent
        first. All logged &amp; reversible.
      </div>
    </div>
  );
}
