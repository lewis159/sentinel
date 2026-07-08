import './reports.css';
import { requireSectionPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Reports & analytics. Renders inside the v2 shell
// (.v2-shell > .v2-content); this component provides page content only.
//
// All figures are static/plausible (no live warehouse behind v2 yet) so the
// page stays reliably buildable. Page-specific chrome is namespaced `v2-rep-*`
// in reports.css; shell primitives (.v2-tile, .v2-card, .v2-bars…) are reused.

// ---- Ticket volume chart geometry (inline SVG, no deps) ----------------------
// Plot box inside a 560×230 viewBox.
const PLOT = { left: 50, right: 512, top: 22, bottom: 188 };
const Y_MAX = 100; // tickets/week ceiling for the y-scale
const WEEKS = ['wk1', 'wk2', 'wk3', 'wk4'];

// received sits just above resolved every week; resolved sums to 312 (KPI tile).
const RECEIVED = [82, 89, 84, 91];
const RESOLVED = [74, 79, 78, 81];

const xAt = (i: number) =>
  PLOT.left + (i * (PLOT.right - PLOT.left)) / (WEEKS.length - 1);
const yAt = (v: number) =>
  PLOT.bottom - (v / Y_MAX) * (PLOT.bottom - PLOT.top);

const toPoints = (series: number[]) =>
  series.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');

// Horizontal gridlines at 0/25/50/75/100.
const GRID = [0, 25, 50, 75, 100];

export default async function ReportsPage() {
  await requireSectionPage('security');

  return (
    <div className="v2-rep-page">
      {/* ---------- Header ---------- */}
      <div className="v2-rep-head">
        <div>
          <div className="v2-eyebrow">Reports</div>
          <h1 className="v2-h1">Reports &amp; analytics</h1>
          <div className="v2-sub">
            Support, ops and agent performance across the estate
          </div>
        </div>
        <button className="v2-rep-range" type="button">
          Last 30 days <span aria-hidden="true">▾</span>
        </button>
      </div>

      {/* ---------- KPI tiles ---------- */}
      <div className="v2-rep-kpis">
        <div className="v2-tile t-ok">
          <div className="k">Tickets resolved</div>
          <div className="v">312</div>
          <div className="meta">
            <span className="v2-rep-delta up">▲ 18%</span> vs previous 30 days
          </div>
        </div>

        <div className="v2-tile t-sky">
          <div className="k">Avg first response</div>
          <div className="v">4m</div>
          <div className="meta">
            <span className="v2-rep-delta down">▼</span> down from 22m
          </div>
        </div>

        <div className="v2-tile t-high">
          <div className="k">MTTR</div>
          <div className="v">2.4d</div>
          <div className="meta">
            <span className="v2-rep-delta down">▼ 0.6d</span> faster to resolve
          </div>
        </div>

        <div className="v2-tile t-ok">
          <div className="k">SLA met</div>
          <div className="v">96%</div>
          <div className="meta">
            <span className="v2-rep-delta up">▲ 2 pts</span> of 328 tracked
          </div>
        </div>
      </div>

      {/* ---------- Two-column body ---------- */}
      <div className="v2-rep-cols">
        {/* LEFT — ticket volume & resolution line chart */}
        <div className="v2-card">
          <div className="v2-card-h">
            <h3>Ticket volume &amp; resolution</h3>
            <span className="v2-pill info">4 weeks</span>
          </div>
          <div className="v2-rep-body">
            <svg
              className="v2-rep-chart"
              viewBox="0 0 560 230"
              role="img"
              aria-label="Line chart of tickets received versus resolved over four weeks"
            >
              {/* faint gridlines */}
              {GRID.map((g) => {
                const y = yAt(g).toFixed(1);
                return (
                  <line
                    key={g}
                    className="v2-rep-grid-line"
                    x1={PLOT.left}
                    y1={y}
                    x2={PLOT.right}
                    y2={y}
                  />
                );
              })}

              {/* baseline axis */}
              <line
                className="v2-rep-axis"
                x1={PLOT.left}
                y1={PLOT.bottom}
                x2={PLOT.right}
                y2={PLOT.bottom}
              />

              {/* received (accent) */}
              <polyline className="v2-rep-line-recv" points={toPoints(RECEIVED)} />
              {RECEIVED.map((v, i) => (
                <circle
                  key={`r-${i}`}
                  className="v2-rep-dot-recv"
                  cx={xAt(i).toFixed(1)}
                  cy={yAt(v).toFixed(1)}
                  r={3}
                />
              ))}

              {/* resolved (ok) */}
              <polyline className="v2-rep-line-res" points={toPoints(RESOLVED)} />
              {RESOLVED.map((v, i) => (
                <circle
                  key={`s-${i}`}
                  className="v2-rep-dot-res"
                  cx={xAt(i).toFixed(1)}
                  cy={yAt(v).toFixed(1)}
                  r={3}
                />
              ))}

              {/* x labels */}
              {WEEKS.map((w, i) => (
                <text
                  key={w}
                  className="v2-rep-xlab"
                  x={xAt(i).toFixed(1)}
                  y={PLOT.bottom + 18}
                  textAnchor="middle"
                >
                  {w}
                </text>
              ))}
            </svg>

            <div className="v2-rep-legend">
              <span>
                <span className="v2-rep-swatch recv" /> Received
              </span>
              <span>
                <span className="v2-rep-swatch res" /> Resolved
              </span>
            </div>
          </div>
        </div>

        {/* RIGHT — Hermes agent performance */}
        <div className="v2-card">
          <div className="v2-card-h">
            <h3>Hermes agent performance</h3>
            <span className="v2-pill ok">Live</span>
          </div>
          <div className="v2-rep-body">
            <div className="v2-bars">
              <div className="v2-bar-row">
                <span className="lab">Auto-resolved</span>
                <span className="v2-track">
                  <span
                    className="v2-fill"
                    style={{ width: '58%', background: 'var(--ok)' }}
                  />
                </span>
                <span className="n">58%</span>
              </div>
              <div className="v2-bar-row">
                <span className="lab">Drafted → sent</span>
                <span className="v2-track">
                  <span
                    className="v2-fill"
                    style={{ width: '27%', background: 'var(--accent)' }}
                  />
                </span>
                <span className="n">27%</span>
              </div>
              <div className="v2-bar-row">
                <span className="lab">Escalated</span>
                <span className="v2-track">
                  <span
                    className="v2-fill"
                    style={{ width: '15%', background: 'var(--high)' }}
                  />
                </span>
                <span className="n">15%</span>
              </div>
            </div>

            <div className="v2-rep-divider" />

            <div className="v2-rep-kv">
              <div className="v2-rep-kv-row">
                <span className="kl">Deflection rate</span>
                <span className="kv-v">71%</span>
              </div>
              <div className="v2-rep-kv-row">
                <span className="kl">Agent CSAT</span>
                <span className="kv-v">
                  4.6<small> / 5</small>
                </span>
              </div>
              <div className="v2-rep-kv-row">
                <span className="kl">KB articles written</span>
                <span className="kv-v">9</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- By section (full-width) ---------- */}
      <div className="v2-card">
        <div className="v2-card-h">
          <h3>By section</h3>
          <span className="v2-link">Open breakdown</span>
        </div>
        <div className="v2-rep-sections">
          <div className="v2-rep-srow">
            <div className="sname">
              <b>Support</b>
              <span>18 open tickets</span>
            </div>
            <div className="v2-rep-mini">
              <i style={{ width: '72%', background: 'var(--accent)' }} />
            </div>
            <span className="v2-rep-trend up">▲ 9%</span>
          </div>

          <div className="v2-rep-srow">
            <div className="sname">
              <b>Operations</b>
              <span>3 open incidents</span>
            </div>
            <div className="v2-rep-mini">
              <i style={{ width: '24%', background: 'var(--sky)' }} />
            </div>
            <span className="v2-rep-trend down">▼ 2</span>
          </div>

          <div className="v2-rep-srow">
            <div className="sname">
              <b>Security</b>
              <span>7 open findings</span>
            </div>
            <div className="v2-rep-mini">
              <i style={{ width: '44%', background: 'var(--crit)' }} />
            </div>
            <span className="v2-rep-trend flat">— 0</span>
          </div>
        </div>
      </div>
    </div>
  );
}
