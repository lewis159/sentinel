import { requireSectionPage } from '@/lib/auth';
import ConsoleSettings from '@/components/v2/ConsoleSettings';
import './settings.css';

export const dynamic = 'force-dynamic';

export default async function V2SettingsPage() {
  await requireSectionPage('admin');

  return (
    <div>
      {/* Header */}
      <div className="v2-set-head">
        <div>
          <div className="v2-eyebrow">Console</div>
          <h1 className="v2-h1">Settings</h1>
          <div className="v2-sub">One place for everything that configures the console.</div>
        </div>
      </div>

      <ConsoleSettings />

      <div className="v2-set-foot">
        Every section&apos;s gear icon links here — the single place all settings live.
      </div>
    </div>
  );
}
