import './graph.css';
import GraphCanvas from '@/components/v2/GraphCanvas';
import { requireSectionPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Node-type legend — mirrors the colour map inside GraphCanvas.
const legend: { label: string; cls: string }[] = [
  { label: 'Finding', cls: 'crit' },
  { label: 'Incident', cls: 'high' },
  { label: 'Ticket', cls: 'sky' },
  { label: 'Component', cls: 'accent' },
  { label: 'KB article', cls: 'purple' },
  { label: 'Container', cls: 'muted' },
];

export default async function V2GraphPage() {
  await requireSectionPage('overview');

  return (
    <div className="v2-gr-page">
      {/* Header */}
      <div>
        <div className="v2-eyebrow">Graph</div>
        <h1 className="v2-h1">Estate graph</h1>
        <div className="v2-sub">Everything connected — trace a fault from cause to customer.</div>
      </div>

      {/* Canvas */}
      <div className="v2-card v2-gr-card">
        <GraphCanvas />
      </div>

      {/* Legend */}
      <div className="v2-gr-legend">
        {legend.map((l) => (
          <span key={l.label} className="v2-gr-leg">
            <span className={`v2-gr-dot ${l.cls}`} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
