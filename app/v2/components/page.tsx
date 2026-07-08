import './infra.css';
import { requireSectionPage } from '@/lib/auth';
import { getComponents } from '@/lib/data';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Operations · Infrastructure · Components. Renders inside the v2
// shell (.v2-shell > .v2-content); this file provides page content only. The
// spine that links findings to the containers they run on: one row per component
// with its live open-finding + container counts (getComponents(), DB-first with
// a mock fallback so the page always renders). Shell classes from ../v2.css;
// page primitives from ./infra.css (namespaced v2-inf-).

const KIND_CLASS: Record<string, string> = {
  service: 'k-service', infra: 'k-infra', route: 'k-route',
};

export default async function V2ComponentsPage() {
  await requireSectionPage('operations');
  const { rows: components, live } = await getComponents();

  return (
    <div>
      {/* Header */}
      <div className="v2-inf-head">
        <div>
          <div className="v2-eyebrow">Operations · Infrastructure</div>
          <div className="v2-inf-title">
            <h1 className="v2-h1">Components</h1>
            <span className={`v2-inf-badge${live ? ' live' : ''}`}>
              <span className="dot" />
              {live ? 'Live · ops.components' : 'Mock'}
            </span>
          </div>
          <div className="v2-sub">
            {components.length} components · services, infra and routes across the estate
          </div>
        </div>
      </div>

      {/* Components table */}
      <div className="v2-card" style={{ overflow: 'hidden' }}>
        <table className="v2-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Open findings</th>
              <th>Containers</th>
            </tr>
          </thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.key}>
                <td>
                  <a href="#">
                    <div className="v2-inf-name">{c.name}</div>
                    <div className="v2-inf-mono v2-inf-dim">{c.key}</div>
                  </a>
                </td>
                <td>
                  <span className={`v2-inf-tag ${KIND_CLASS[c.kind] ?? ''}`}>{c.kind}</span>
                </td>
                <td>
                  <span className={`v2-pill ${c.findings > 0 ? 'crit' : 'info'}`}>
                    {c.findings}
                  </span>
                </td>
                <td><span className="v2-inf-num">{c.containers}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
