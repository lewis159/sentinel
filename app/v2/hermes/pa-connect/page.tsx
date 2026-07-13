import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import PaConnectManager from '@/components/v2/PaConnectManager';
import '../../settings/settings.css';

export const dynamic = 'force-dynamic';

// Admin-gated. Shows the PA's Google (Calendar + Gmail) connection status and lets
// an admin store/rotate the access token. The token is write-only — this page
// never displays a stored value, only whether one is set and when it changed.
export default async function V2HermesPaConnectPage() {
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
          <div className="v2-eyebrow">Hermes · PA</div>
          <h1 className="v2-h1">PA connect — Google Calendar &amp; Gmail</h1>
          <div className="v2-sub">
            Connect Ben&apos;s Google account so the PA can read upcoming calendar events and recent email,
            and draft events / replies for approval. Reads are automatic; every write (create an event,
            draft or send mail) is gated through the Sentinel Approvals queue. The token is stored write-only
            (Infisical <code>PA_GOOGLE_ACCESS_TOKEN</code>) and is never shown back.
          </div>
        </div>
      </div>

      <div className="v2-set-content">
        <PaConnectManager />
      </div>
    </div>
  );
}
