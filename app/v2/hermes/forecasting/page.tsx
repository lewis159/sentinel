import { requireSectionPage } from '@/lib/auth';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import { baselineInputs } from '@/lib/forecasting/scenarios';
import { ForecastingCalculator } from '@/components/v2/ForecastingCalculator';
import './forecasting.css';

export const dynamic = 'force-dynamic';

// Financial forecasting / scenarios — an interactive what-if calculator for
// price rises, churn spikes, new tiers and infra cost. Read-only/advisory: the
// projection is deterministic math and the optional Hermes narrative only
// interprets it. Gated on the Hermes section (matches the nav placement).
export default async function ForecastingPage() {
  await requireSectionPage('hermes');

  return (
    <div>
      <div className="v2-eyebrow">Hermes · CFO</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="v2-h1">Financial forecasting</h1>
        <span className="v2-pill info">advisory · read-only</span>
      </div>
      <div className="v2-sub">
        Model what-ifs on price, churn, growth, tiers and infra cost — see projected MRR, runway and
        break-even. Baseline figures are placeholders pending real numbers.
      </div>

      <div style={{ height: 16 }} />

      <ForecastingCalculator initial={baselineInputs()} brainEnabled={brainEnabled()} />
    </div>
  );
}
