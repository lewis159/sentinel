'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

// Entity detail routes the trail tracks. The id lives in the URL, so the trail
// can record your path through links with no per-page wiring.
const ENTITY: { re: RegExp; icon: string }[] = [
  { re: /^\/findings\/(.+)$/, icon: '⚠' },
  { re: /^\/tickets\/(.+)$/, icon: '🎫' },
  { re: /^\/components\/(.+)$/, icon: '⬡' },
  { re: /^\/infra\/(.+)$/, icon: '◷' },
  { re: /^\/users\/(.+)$/, icon: '◰' },
  { re: /^\/scans\/runs\/(.+)$/, icon: '◎' },
  { re: /^\/kb\/(.+)$/, icon: '📘' },
];

type Crumb = { label: string; href: string; icon: string };
const KEY = 'sentinel-trail';

export function Trail() {
  const path = usePathname();
  const [trail, setTrail] = useState<Crumb[]>([]);

  useEffect(() => {
    let cur: Crumb[] = [];
    try { cur = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch {}

    const hit = ENTITY.map((e) => ({ e, m: path.match(e.re) })).find((x) => x.m);
    let next: Crumb[];
    if (!hit) {
      // Left the graph (a list/root page) — start a fresh trail.
      next = [];
    } else {
      const crumb: Crumb = { label: decodeURIComponent(hit.m![1]), href: path, icon: hit.e.icon };
      const idx = cur.findIndex((c) => c.href === crumb.href);
      next = idx >= 0 ? cur.slice(0, idx + 1) : [...cur, crumb]; // truncate if going back, else append
    }
    sessionStorage.setItem(KEY, JSON.stringify(next));
    setTrail(next);
  }, [path]);

  if (trail.length === 0) return null;

  const clear = () => { sessionStorage.setItem(KEY, '[]'); setTrail([]); };

  return (
    <div className="trail">
      <span className="trail-tag">trail</span>
      {trail.map((c, i) => (
        <span key={c.href} className="row" style={{ gap: 6 }}>
          {i > 0 && <span className="trail-sep">›</span>}
          <Link href={c.href} className={i === trail.length - 1 ? 'trail-cur' : 'trail-link'}>
            <span>{c.icon}</span> <span className="mono">{c.label}</span>
          </Link>
        </span>
      ))}
      <button className="trail-clear" onClick={clear}>clear</button>
    </div>
  );
}
