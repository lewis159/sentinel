// Hermes · Feature Requests — clustered, ranked feature-request themes for the
// CTO/roadmap. Deterministic keyword clustering always runs (useful even when the
// Brain is dormant); when HERMES_BRAIN_ENABLED the labels/summaries + a suggested
// roadmap title are refined by the model as a DRAFT. Read-only re: the roadmap —
// the only write path is a gated DRAFT proposal (DraftToRoadmapButton → Approvals).
//
// Gated on the `hermes` section (requireSectionPage). Renders inside the v2 shell.

import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import { getFeatureRequestClusters } from '@/lib/feature-requests/service';
import DraftToRoadmapButton from '@/components/v2/feature-requests/DraftToRoadmapButton';
import './feature-requests.css';

export const dynamic = 'force-dynamic';

const TREND_META: Record<string, { label: string; cls: string; glyph: string }> = {
  rising: { label: 'Rising', cls: 'rising', glyph: '▲' },
  steady: { label: 'Steady', cls: 'steady', glyph: '▶' },
  cooling: { label: 'Cooling', cls: 'cooling', glyph: '▼' },
};

function sourceLabel(source: string): string {
  return source === 'feedback' ? 'Feedback' : 'Request';
}

export default async function HermesFeatureRequestsPage() {
  await requireSectionPage('hermes');

  const { clusters, live, brainRefined, candidateCount } = await getFeatureRequestClusters();

  return (
    <div className="v2-fr">
      {/* Header */}
      <div className="v2-fr-head">
        <div>
          <div className="v2-eyebrow">Hermes · Product</div>
          <h1 className="v2-h1">Feature requests</h1>
          <div className="v2-sub">
            Incoming requests &amp; feedback, clustered into ranked themes for the roadmap.
            Read-only — drafting a theme queues it for human approval, never writes the roadmap.
          </div>
        </div>
        <div className="v2-fr-badges">
          <span className={`v2-fr-live${live ? ' on' : ''}`}>
            <span className="dot" />
            {live ? 'Live' : 'Sample data'}
          </span>
          <span className={`v2-fr-brain${brainRefined ? ' on' : ''}`}>
            {brainRefined ? 'AI-refined' : 'Keyword clustering'}
          </span>
        </div>
      </div>

      {/* Summary strip */}
      <div className="v2-fr-strip">
        <div className="v2-fr-stat">
          <span className="n">{clusters.length}</span>
          <span className="l">themes</span>
        </div>
        <div className="v2-fr-stat">
          <span className="n">{candidateCount}</span>
          <span className="l">signals</span>
        </div>
        <div className="v2-fr-stat">
          <span className="n">{clusters.reduce((s, c) => s + c.recentCount, 0)}</span>
          <span className="l">recent</span>
        </div>
        {!brainRefined && (
          <div className="v2-fr-hint">
            Enable the Hermes Brain to refine theme labels and suggest roadmap titles.
          </div>
        )}
      </div>

      {/* Ranked themes */}
      {clusters.length === 0 ? (
        <div className="v2-card v2-fr-empty">
          No feature-request signals yet. New requests and product feedback will cluster here.
        </div>
      ) : (
        <ol className="v2-fr-list">
          {clusters.map((c, i) => {
            const trend = TREND_META[c.trend] ?? TREND_META.steady;
            return (
              <li className="v2-card v2-fr-card" key={c.key}>
                <div className="v2-fr-rank">#{i + 1}</div>

                <div className="v2-fr-main">
                  <div className="v2-fr-top">
                    <h3 className="v2-fr-title">{c.label}</h3>
                    <span className={`v2-fr-trend ${trend.cls}`}>
                      <span className="g">{trend.glyph}</span> {trend.label}
                    </span>
                    <span className="v2-fr-count">{c.count} req</span>
                    <span className="v2-fr-recent">· freshest {c.mostRecent}</span>
                  </div>

                  {c.summary && <div className="v2-fr-summary">{c.summary}</div>}

                  {c.keywords.length > 0 && (
                    <div className="v2-fr-keys">
                      {c.keywords.map((k) => (
                        <span className="v2-fr-key" key={k}>
                          {k}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="v2-fr-examples">
                    {c.examples.map((e) => (
                      <Link
                        href={e.href}
                        key={e.ref}
                        className="v2-fr-ex"
                        title={e.title}
                      >
                        <span className={`v2-fr-ex-src ${e.source}`}>{sourceLabel(e.source)}</span>
                        <span className="v2-fr-ex-ref">{e.ref}</span>
                        <span className="v2-fr-ex-title">{e.title}</span>
                      </Link>
                    ))}
                  </div>

                  {c.suggestedRoadmapTitle && (
                    <div className="v2-fr-suggest">
                      <span className="v2-fr-suggest-lbl">Suggested roadmap item</span>
                      <span className="v2-fr-suggest-title">{c.suggestedRoadmapTitle}</span>
                    </div>
                  )}
                </div>

                <div className="v2-fr-actions">
                  <div className="v2-fr-score" title="Priority score (volume + recency)">
                    <span className="n">{c.score}</span>
                    <span className="l">score</span>
                  </div>
                  {c.suggestedRoadmapTitle ? (
                    <DraftToRoadmapButton
                      payload={{
                        label: c.label,
                        suggestedRoadmapTitle: c.suggestedRoadmapTitle,
                        summary: c.summary,
                        keywords: c.keywords,
                        count: c.count,
                        exampleRefs: c.examples.map((e) => e.ref),
                      }}
                    />
                  ) : (
                    <span className="v2-fr-draft-off" title="Enable the Hermes Brain to draft a roadmap item">
                      Brain off
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
