'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { sevClass, type Severity } from '@/lib/mock';

// Open incidents from Sentinel's own `ops` schema (via the Clerk-gated
// /api/metrics/incidents → getTicketsByKind('incident')). Shows the open count +
// a short list; the header count and each row link through to /incidents.

type Item = { ref: string; title: string; priority: Severity; status: string; app: string; age: string };

export function OpenIncidentsWidget() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [count, setCount] = useState(0);
  const [live, setLive] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/metrics/incidents', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (!d?.ok) { setErr(true); return; }
          setItems(Array.isArray(d.items) ? d.items : []);
          setCount(Number(d.openCount) || 0);
          setLive(Boolean(d.live));
        })
        .catch(() => { if (!cancelled) setErr(true); });
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (err) return <div className="mon-state">Incidents unavailable</div>;
  if (items === null) return <div className="mon-state">Loading incidents…</div>;

  return (
    <div className="mon-inc">
      <div className="mon-inc-head">
        <div className="mon-metric">
          <div className="mon-metric-v" style={{ color: count > 0 ? 'var(--high)' : 'var(--ok)' }}>{count}</div>
          <div className="mon-metric-l">open incidents{live ? '' : ' · mock'}</div>
        </div>
        <Link className="btn ghost sm" href="/incidents">View all</Link>
      </div>
      {items.length === 0 ? (
        <div className="mon-note">No open incidents 🎉</div>
      ) : (
        <ul className="mon-inc-list">
          {items.map((t) => (
            <li key={t.ref}>
              <Link href="/incidents" className="mon-inc-row">
                <span className={`pill ${sevClass[t.priority] ?? 'sev-med'}`} style={{ fontSize: 10 }}>●</span>
                <span className="mono mon-inc-ref">{t.ref}</span>
                <span className="mon-inc-title">{t.title}</span>
                <span className="sub mon-inc-age">{t.age}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
