'use client';

import useSWR from 'swr';
import Link from 'next/link';
import type { SupportData, SupportTicketRow } from '@/lib/v2/api-types';

const fetcher = (u: string) => fetch(u).then((r) => r.json());

// Customer string → URL slug (lowercase, non-alphanumerics → '-'), e.g.
// "northwind.io" → "northwind-io", "Acme Co" → "acme-co". Kept in sync with
// the same helper in app/v2/support/[ref]/page.tsx so links resolve identically.
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Two-letter initials for an avatar circle.
function initials(name: string): string {
  const parts = name.trim().split(/[\s.]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const COLS = 6;

export default function SupportTable() {
  // Global refreshInterval is provided by an ancestor <SWRConfig> (RefreshProvider),
  // so polling is automatic — do not set an interval here.
  const { data, error } = useSWR<SupportData>('/api/v2/support', fetcher);

  const tickets: SupportTicketRow[] = data?.tickets ?? [];

  let body: React.ReactNode;
  if (!data && !error) {
    body = (
      <tr>
        <td colSpan={COLS} className="v2-sup-state">Loading tickets…</td>
      </tr>
    );
  } else if (error) {
    body = (
      <tr>
        <td colSpan={COLS} className="v2-sup-state">Couldn&apos;t load tickets.</td>
      </tr>
    );
  } else if (tickets.length === 0) {
    body = (
      <tr>
        <td colSpan={COLS} className="v2-sup-state">No open tickets.</td>
      </tr>
    );
  } else {
    body = tickets.map((t) => (
      <tr key={t.ref}>
        <td>
          <Link href={`/v2/support/${t.ref}`} className="v2-sup-open">
            <span className="v2-sup-ref">{t.ref}</span>
          </Link>
        </td>
        <td>
          <Link href={`/v2/support/${t.ref}`} className="v2-sup-open">
            <div className="v2-sup-subj">{t.title}</div>
            {t.linked && <div className="v2-sup-link">{t.linked}</div>}
          </Link>
        </td>
        <td>
          <span className="v2-sup-who">
            <span className="v2-sup-av">{initials(t.customer)}</span>
            <Link href={`/v2/support/customers/${slugify(t.customer)}`} className="v2-sup-custlink">
              {t.customer}
            </Link>
            {t.plan && <span className="v2-sup-plan">{t.plan}</span>}
          </span>
        </td>
        <td><span className={`v2-pill ${t.priorityPill}`}>{t.priority}</span></td>
        <td><span className={`v2-sup-sla ${t.slaState}`}>{t.sla}</span></td>
        <td>
          {t.owner ? (
            <span className="v2-sup-who">
              <span className="v2-sup-av">{initials(t.owner)}</span>
              <span className="nm">{t.owner}</span>
            </span>
          ) : (
            <span className="v2-sup-who">
              <span className="v2-sup-av muted">?</span>
              <span className="nm faint">Unassigned</span>
            </span>
          )}
        </td>
      </tr>
    ));
  }

  return (
    <div className="v2-card" style={{ overflow: 'hidden' }}>
      <div className="v2-sup-tablebar">
        <span
          className={`v2-sup-live ${data?.live ? 'on' : 'off'}`}
          title={data?.live ? 'Live data' : 'Mock data'}
        >
          {data?.live ? 'Live' : 'Mock'}
        </span>
      </div>
      <table className="v2-table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Subject</th>
            <th>Customer</th>
            <th>Priority</th>
            <th>SLA</th>
            <th>Owner</th>
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}
