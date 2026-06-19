import Link from 'next/link';

// Page-level breadcrumb trail, e.g. Operations › Service management › Incidents.
// Each crumb may carry an href (rendered as a link); the last/current crumb is
// emphasised and never a link. Pure presentational, server-safe.
export type Crumb = { label: string; href?: string };

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="bc" aria-label="Breadcrumb">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${c.label}-${i}`} className="bc-item">
            {c.href && !last
              ? <Link className="bc-link" href={c.href}>{c.label}</Link>
              : <span className={last ? 'bc-cur' : undefined} aria-current={last ? 'page' : undefined}>{c.label}</span>}
            {!last && <span className="bc-sep" aria-hidden="true">›</span>}
          </span>
        );
      })}
    </nav>
  );
}
