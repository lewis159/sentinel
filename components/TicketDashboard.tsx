'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { sevLabel, type ServiceTicket } from '@/lib/mock';
import { AppTag } from './AppTag';
import { TicketControls } from './TicketControls';
import { ActivityFeed } from './ActivityFeed';
import { statusColor } from './TicketDetail';

const ResponsiveGridLayout = WidthProvider(Responsive);

const LAYOUT_KEY = 'ticket-detail';
const LS_KEY = `sentinel:layout:${LAYOUT_KEY}`;
const BREAKPOINTS = { lg: 1200, md: 900, sm: 0 };
const COLS = { lg: 12, md: 12, sm: 1 };
const ROW_HEIGHT = 30;

// Panel id → which panels exist. Kind-specific panel only renders for change /
// problem / release; it's still in the layout (harmless if it renders nothing).
type PanelId = 'summary' | 'details' | 'activity' | 'metadata' | 'controls' | 'kind' | 'links';

// Default 12-col layout for wide screens. Left rail (details/activity) is wide;
// right rail (metadata/controls/kind/links) is narrow. Heights are in ROW_HEIGHT
// units. md mirrors lg; sm is a single column (handled by COLS.sm = 1).
const DEFAULT_LG: Layout[] = [
  { i: 'summary',  x: 0, y: 0,  w: 12, h: 3,  minW: 3, minH: 2 },
  { i: 'details',  x: 0, y: 3,  w: 8,  h: 7,  minW: 3, minH: 3 },
  { i: 'metadata', x: 8, y: 3,  w: 4,  h: 9,  minW: 3, minH: 4 },
  { i: 'controls', x: 8, y: 12, w: 4,  h: 7,  minW: 3, minH: 4 },
  { i: 'activity', x: 0, y: 10, w: 8,  h: 12, minW: 3, minH: 5 },
  { i: 'kind',     x: 8, y: 19, w: 4,  h: 7,  minW: 3, minH: 3 },
  { i: 'links',    x: 0, y: 22, w: 8,  h: 6,  minW: 3, minH: 3 },
];

function defaultLayouts(): Layouts {
  return {
    lg: DEFAULT_LG,
    md: DEFAULT_LG.map((l) => ({ ...l })),
    sm: DEFAULT_LG.map((l, idx) => ({ ...l, x: 0, y: idx * 6, w: 1 })),
  };
}

// A draggable/resizable tile. The header is the drag handle (`.td-panel-h`);
// everything below scrolls independently so resize actually constrains content.
function Panel({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="td-panel">
      <div className="td-panel-h td-drag-handle">
        <h3>{title}</h3>
        <div className="row" style={{ gap: 8 }}>
          {actions}
          <span className="td-grip" aria-hidden>⠿</span>
        </div>
      </div>
      <div className="td-panel-body">{children}</div>
    </div>
  );
}

type Edge = { rel: string; type: string; id: string; label: string; href: string };

function LinkedRecords({ ref_ }: { ref_: string }) {
  const [links, setLinks] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tickets/${encodeURIComponent(ref_)}/links`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => { if (!cancelled) setLinks(Array.isArray(d?.links) ? d.links : []); })
      .catch(() => { if (!cancelled) setLinks([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ref_]);

  if (loading) return <div className="sub">Loading links…</div>;
  if (links.length === 0) {
    return <div className="placeholder" style={{ padding: 22 }}><div className="big">∅</div>No linked records</div>;
  }
  return (
    <div className="links-panel">
      {links.map((e, i) => (
        <a className="edge" key={`${e.type}:${e.id}:${e.rel}:${i}`} href={e.href}>
          <span className="rel">{e.rel}</span>
          <span className="mono">{e.label}</span>
          <span className="tag st-blue" style={{ fontSize: 10 }}>{e.type}</span>
        </a>
      ))}
    </div>
  );
}

function KindAttrs({ t }: { t: ServiceTicket }) {
  const a = t.attrs ?? {};
  if (t.kind === 'change') {
    return (
      <div className="kv">
        <div className="r"><span className="k2">Change type</span><span>{a.change_type ?? '—'}</span></div>
        <div className="r"><span className="k2">Risk</span><span>{a.risk ?? '—'}</span></div>
        <div className="r"><span className="k2">CAB status</span><span>{a.cab_status ?? '—'}</span></div>
        <div className="r"><span className="k2">Window</span><span>{a.window ?? '—'}</span></div>
        <div className="r"><span className="k2">Backout plan</span><span>{a.backout ?? '—'}</span></div>
      </div>
    );
  }
  if (t.kind === 'problem') {
    return (
      <div className="kv">
        <div className="r"><span className="k2">Root cause</span><span>{a.root_cause ?? '—'}</span></div>
        <div className="r"><span className="k2">Known error</span><span>{a.known_error ? 'Yes' : 'No'}</span></div>
        <div className="r"><span className="k2">Workaround</span><span>{a.workaround ?? '—'}</span></div>
      </div>
    );
  }
  if (t.kind === 'release') {
    const changes: string[] = Array.isArray(a.linked_changes) ? a.linked_changes : [];
    return (
      <div className="kv">
        <div className="r"><span className="k2">Version</span><span className="mono">{a.version ?? '—'}</span></div>
        <div className="r"><span className="k2">Window</span><span>{a.window ?? '—'}</span></div>
        <div className="r"><span className="k2">Linked changes</span><span>{changes.length ? changes.join(', ') : '—'}</span></div>
      </div>
    );
  }
  return <div className="sub">No kind-specific attributes for this record type.</div>;
}

const KIND_TITLE: Record<string, string> = {
  change: 'Change details', problem: 'Problem details', release: 'Release details',
};

export function TicketDashboard({ t }: { t: ServiceTicket }) {
  const [layouts, setLayouts] = useState<Layouts>(() => defaultLayouts());
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount: hydrate from localStorage instantly, then reconcile with the DB.
  useEffect(() => {
    let cancelled = false;
    try {
      const cached = localStorage.getItem(LS_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') setLayouts(parsed);
      }
    } catch { /* ignore bad cache */ }

    fetch(`/api/layouts/${LAYOUT_KEY}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        if (cancelled) return;
        const saved = d?.layout;
        if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
          setLayouts(saved);
          try { localStorage.setItem(LS_KEY, JSON.stringify(saved)); } catch {}
        }
      })
      .catch(() => { /* keep cache/default */ })
      .finally(() => { if (!cancelled) setLoaded(true); });

    return () => { cancelled = true; };
  }, []);

  const persist = useCallback((next: Layouts) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/layouts/${LAYOUT_KEY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => { /* localStorage already holds it */ });
    }, 600);
  }, []);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // Only persist user-driven drag/resize, not the initial mount/hydrate.
  const onLayoutChange = useCallback((_current: Layout[], all: Layouts) => {
    if (!loaded) return;
    setLayouts(all);
    persist(all);
  }, [loaded, persist]);

  const resetLayout = useCallback(() => {
    const def = defaultLayouts();
    setLayouts(def);
    persist(def);
  }, [persist]);

  const showKind = t.kind === 'change' || t.kind === 'problem' || t.kind === 'release';

  return (
    <div>
      <div className="row spread mb">
        <span className="sub">Drag panel headers to rearrange · drag corners to resize</span>
        <button className="btn ghost sm" onClick={resetLayout}>Reset layout</button>
      </div>

      <ResponsiveGridLayout
        className="td-rgl"
        layouts={layouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        margin={[16, 16]}
        containerPadding={[0, 0]}
        draggableHandle=".td-drag-handle"
        onLayoutChange={onLayoutChange}
        isBounded={false}
        useCSSTransforms
      >
        <div key="summary">
          <Panel title="Summary">
            <div className="kv">
              <div className="r"><span className="k2">Title</span><span style={{ fontWeight: 600 }}>{t.title}</span></div>
              <div className="r"><span className="k2">Ref</span><span className="mono">{t.ref}</span></div>
              <div className="r"><span className="k2">Priority</span><span><b>{sevLabel[t.priority]}</b></span></div>
            </div>
          </Panel>
        </div>

        <div key="details">
          <Panel title="Details">
            <p style={{ color: '#c8cedb', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {t.description || '—'}
            </p>
          </Panel>
        </div>

        <div key="activity">
          <Panel title="Activity">
            <ActivityFeed ref_={t.ref} />
          </Panel>
        </div>

        <div key="metadata">
          <Panel title="Metadata">
            <div className="kv">
              <div className="r"><span className="k2">Ref</span><span className="mono">{t.ref}</span></div>
              <div className="r"><span className="k2">Status</span><span style={{ fontWeight: 600, color: statusColor[t.status] ?? 'var(--text)' }}>{t.status}</span></div>
              <div className="r"><span className="k2">Impact × Urgency → Priority</span><span>{t.impact} × {t.urgency} → <b>{sevLabel[t.priority]}</b></span></div>
              <div className="r"><span className="k2">App</span><span><AppTag app={t.app} /></span></div>
              <div className="r"><span className="k2">Assignee</span><span>{t.assignee}</span></div>
              <div className="r"><span className="k2">Source</span><span>{t.source}</span></div>
              <div className="r"><span className="k2">SLA due</span><span style={{ color: t.slaDue ? '#ffc05a' : 'var(--muted)' }}>{t.slaDue ? new Date(t.slaDue).toLocaleString() : '—'}</span></div>
            </div>
          </Panel>
        </div>

        <div key="controls">
          <Panel title="Controls">
            <TicketControls ref_={t.ref} kind={t.kind} status={t.status} assignee={t.assignee} embedded />
          </Panel>
        </div>

        <div key="kind">
          <Panel title={showKind ? (KIND_TITLE[t.kind] ?? 'Kind details') : 'Kind details'}>
            <KindAttrs t={t} />
          </Panel>
        </div>

        <div key="links">
          <Panel title="Linked records">
            <LinkedRecords ref_={t.ref} />
          </Panel>
        </div>
      </ResponsiveGridLayout>
    </div>
  );
}
