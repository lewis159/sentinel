import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import IntegrationsManager from '@/components/v2/IntegrationsManager';
import '../../settings/settings.css';

export const dynamic = 'force-dynamic';

// Admin-gated (manages estate secrets + feature flags). The page shell renders
// static copy; the client component fetches status and drives set/rotate/test/
// toggle actions — none of which ever expose a stored key value.
export default async function V2HermesIntegrationsPage() {
  await requireSectionPage('admin');

  return (
    <div>
      <Link href="/v2/hermes/floor" className="v2-set-back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Hermes
      </Link>

      <div className="v2-set-head">
        <div>
          <div className="v2-eyebrow">Hermes · Admin</div>
          <h1 className="v2-h1">Third-party integrations</h1>
          <div className="v2-sub">
            Estate API keys in one place — set or rotate each provider&apos;s key (stored in
            Infisical <code>hermes/prod</code>), test the live connection, and toggle the feature it
            drives. Keys are write-only: this page shows only whether a key is set and when it changed,
            never its value.
          </div>
        </div>
      </div>

      <div className="v2-set-content">
        <IntegrationsManager />
      </div>
    </div>
  );
}
