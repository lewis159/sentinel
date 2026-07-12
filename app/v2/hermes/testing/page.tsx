// Hermes · Admin Testing hub — a single admin-gated surface with two sections:
//
//   A. Live smoke (in-process)   — the "Run smoke test" button hits
//      POST /api/v2/admin/smoke, which runs the live health/smoke suite against the
//      RUNNING app (process + DB + config) and returns per-check pass/fail/skip.
//   B. CI test suite (Actions)   — the "Run CI suite" button dispatches the test.yml
//      GitHub Actions workflow and shows recent runs.
//
// Gated by the SAME `admin` section the Hermes governance / autonomy settings use
// (requireSectionPage). Prod-safe: the smoke suite is read-mostly + self-cleaning,
// and the CI trigger only dispatches a workflow (no destructive local action). The
// interactive work lives in the <TestingHub/> client component; nothing here holds
// secrets or DB handles.
import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import TestingHub from '@/components/v2/hermes/TestingHub';
import '../../settings/settings.css';
import './testing.css';

export const dynamic = 'force-dynamic';

export default async function HermesTestingPage() {
  await requireSectionPage('admin');

  return (
    <div>
      <Link href="/v2/hermes/governance" className="v2-set-back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Hermes governance
      </Link>

      {/* Header */}
      <div className="v2-set-head">
        <div>
          <div className="v2-eyebrow">Hermes · Admin</div>
          <h1 className="v2-h1">Testing</h1>
          <div className="v2-sub">
            Prove the deployed platform actually works. Run the live smoke suite against this running
            instance, or trigger the full CI test suite on GitHub Actions.
          </div>
        </div>
      </div>

      <TestingHub />
    </div>
  );
}
