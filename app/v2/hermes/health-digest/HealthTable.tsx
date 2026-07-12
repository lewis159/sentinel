'use client';

import { useState } from 'react';
import Link from 'next/link';
import { type CustomerHealth } from '@/lib/health/digest';
import { BAND_LABEL, BAND_PILL, type HealthBand } from '@/lib/health/score';

// Client-side sortable table for the digest. Data is fully computed server-side
// (deterministic scores) and passed in as plain props; this component only
// re-orders rows. READ-ONLY — every link navigates to an existing surface.

type SortKey = 'score' | 'name' | 'openIssues';
type Dir = 'asc' | 'desc';

const TREND_GLYPH: Record<CustomerHealth['health']['usageTrend'], string> = {
  improving: '▲',
  declining: '▼',
  steady: '▬',
  unknown: '·',
};

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

export default function HealthTable({ customers }: { customers: CustomerHealth[] }) {
  // Default: worst health first (the server already sorts this way).
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: 'score', dir: 'asc' });

  const rows = [...customers].sort((a, b) => {
    let cmp = 0;
    if (sort.key === 'score') cmp = a.health.score - b.health.score;
    else if (sort.key === 'openIssues') cmp = a.health.openIssues - b.health.openIssues;
    else cmp = a.name.localeCompare(b.name);
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  function toggle(key: SortKey, defaultDir: Dir) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDir }));
  }

  function caret(key: SortKey) {
    if (sort.key !== key) return '';
    return sort.dir === 'asc' ? ' ▲' : ' ▼';
  }

  return (
    <table className="v2-table v2-hd-table">
      <thead>
        <tr>
          <th className="v2-hd-sortable" onClick={() => toggle('name', 'asc')}>
            Customer{caret('name')}
          </th>
          <th className="v2-hd-sortable" onClick={() => toggle('score', 'asc')}>
            Health{caret('score')}
          </th>
          <th>Trend</th>
          <th>Top drivers</th>
          <th className="v2-hd-sortable" onClick={() => toggle('openIssues', 'desc')}>
            Open issues{caret('openIssues')}
          </th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const band = c.health.band as HealthBand;
          const atRisk = band === 'at-risk' || band === 'critical';
          return (
            <tr key={c.id}>
              <td>
                <div className="v2-hd-cust">
                  <span className="nm">{c.name}</span>
                  <span className="sub">
                    {c.tier ?? 'no tier'}
                    {c.upsell ? <span className="v2-hd-upsell" title={c.upsell.reason}>▲ Upsell</span> : null}
                  </span>
                </div>
              </td>
              <td>
                <div className="v2-hd-health">
                  <span className={`v2-pill ${BAND_PILL[band]}`}>{BAND_LABEL[band]}</span>
                  <span className="v2-hd-score">{c.health.score}</span>
                  <span className={`v2-hd-bar b-${band}`} aria-hidden>
                    <i style={{ width: `${c.health.score}%` }} />
                  </span>
                </div>
              </td>
              <td>
                <span className={`v2-hd-trend t-${c.health.usageTrend}`} title={`${c.health.usageTrend} (proxy)`}>
                  {TREND_GLYPH[c.health.usageTrend]} {c.health.usageTrend}
                </span>
              </td>
              <td>
                <div className="v2-hd-drivers">
                  {c.health.drivers.slice(0, 3).map((d, i) => (
                    <span key={i} className={`v2-hd-driver ${d.kind}`}>
                      {d.label}
                    </span>
                  ))}
                </div>
              </td>
              <td>
                <span className={c.health.openIssues > 0 ? 'v2-hd-issues on' : 'v2-hd-issues'}>
                  {c.health.openIssues}
                </span>
              </td>
              <td>
                <div className="v2-hd-actions">
                  <Link href={`/v2/support/customers/${encodeId(c.id)}`} className="v2-link">
                    Customer 360
                  </Link>
                  {atRisk ? (
                    <Link href="/v2/hermes/floor" className="v2-link warn">
                      Churn-save
                    </Link>
                  ) : null}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
