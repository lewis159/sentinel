// Hermes Governance Console — the single control surface for "everything is a
// dial". One admin-gated page where Ben sets, per persona × action: the AUTONOMY
// dial (auto / gated / draft-only → hermes.autonomy_config), the BUDGET CAP
// (amount + window → ops.hermes_budgets), and the ESCALATION thresholds
// (hermes.autonomy_thresholds) alongside the code-enforced escalation ladder.
//
// Gated by the SAME `admin` section the P1 autonomy settings use (requireSectionPage).
// Each section is a client component that reads/writes through the admin-gated
// /api/v2/settings/hermes/* routes; nothing here holds secrets or DB handles.
import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import GovernanceAutonomyMatrix from '@/components/v2/governance/GovernanceAutonomyMatrix';
import GovernanceBudgetCaps from '@/components/v2/governance/GovernanceBudgetCaps';
import GovernanceEscalation from '@/components/v2/governance/GovernanceEscalation';
import '../../settings/settings.css';
import './governance.css';

export const dynamic = 'force-dynamic';

export default async function HermesGovernanceConsolePage() {
  await requireSectionPage('admin');

  return (
    <div>
      <Link href="/v2/settings/hermes" className="v2-set-back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Hermes settings
      </Link>

      {/* Header */}
      <div className="v2-set-head">
        <div>
          <div className="v2-eyebrow">Hermes · Governance</div>
          <h1 className="v2-h1">Governance console</h1>
          <div className="v2-sub">
            One surface for every dial — set, per persona and action, what runs alone, what needs
            you, what it may spend, and when it escalates. These are the live gates the Brain enforces.
          </div>
        </div>
      </div>

      <div className="v2-set-content">
        {/* 1 — Autonomy matrix */}
        <div className="v2-card v2-set-hcard">
          <div className="v2-card-h">
            <div className="v2-set-ch">
              <h3>Autonomy matrix</h3>
              <span className="st">
                Per persona × tool: auto, gated (needs approval), or draft-only. Each cell shows the
                effective value and whether it comes from the code default or a saved override. Saving
                persists to hermes.autonomy_config — the Brain reads it live (resolveAutonomy).
              </span>
            </div>
          </div>
          <GovernanceAutonomyMatrix />
        </div>

        {/* 2 — Budget caps */}
        <div className="v2-card v2-set-hcard">
          <div className="v2-card-h">
            <div className="v2-set-ch">
              <h3>Budget caps</h3>
              <span className="st">
                Per persona (and per tool where relevant): a spend cap over a rolling window. These are
                the caps lib/hermes/budget.ts meters tool spend against (ops.hermes_budgets). Amounts in £.
              </span>
            </div>
          </div>
          <GovernanceBudgetCaps />
        </div>

        {/* 3 — Escalation */}
        <div className="v2-card v2-set-hcard">
          <div className="v2-card-h">
            <div className="v2-set-ch">
              <h3>Escalation</h3>
              <span className="st">
                The code-enforced escalation ladder + human-gate actions, plus the editable governance
                thresholds (hermes.autonomy_thresholds) that bound what may happen automatically.
              </span>
            </div>
          </div>
          <GovernanceEscalation />
        </div>
      </div>
    </div>
  );
}
