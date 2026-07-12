import { requireSectionPage } from '@/lib/auth';
import ChurnSaveBoard from '@/components/v2/ChurnSaveBoard';
import './churn-save.css';

export const dynamic = 'force-dynamic';

export default async function ChurnSavePage() {
  await requireSectionPage('hermes');

  return (
    <div>
      <div className="v2-eyebrow">Hermes · Retention</div>
      <h1 className="v2-h1">Churn-Save Outreach</h1>
      <div className="v2-sub">
        At-risk accounts ranked from live signals — draft a tailored win-back and{' '}
        <span className="v2-cs-green">queue it for approval</span>. Never auto-sent.
      </div>

      <ChurnSaveBoard />
    </div>
  );
}
