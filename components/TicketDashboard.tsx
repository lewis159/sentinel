'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { sevClass, sevLabel, KIND_LABEL, type ServiceTicket } from '@/lib/mock';
import { AppTag } from './AppTag';
import { TicketControls } from './TicketControls';
import { ActivityFeed } from './ActivityFeed';
import { statusColor } from './TicketDetail';

const ResponsiveGridLayout = WidthProvider(Responsive);

const LAYOUT_KEY = 'ticket-detail';
const LS_KEY = `sentinel:layout:${LAYOUT_KEY}`;
const ROW_HEIGHT = 30;

// Selectable grid densities. We drive RGL with a SINGLE active breakpoint whose
// `cols` is the user's choice, plus a narrow-screen collapse to one column. The
// chosen column count is persisted alongside a per-density layout map so that
// switching density doesn't destroy the arrangement built for another density.
const DENSITIES = [5, 9, 12] as const;
type Density = (typeof DENSITIES)[number];
const NARROW_BP = 700; // below this width → single column

type PanelId = 'summary' | 'details' | 'activity' | 'metadata' | 'controls' | 'kind' | 'links';

// Persisted shape: the active column count + one Layout[] per density we've
// generated so far. Lazily filled as the user visits a density.
type StoredLayout = { cols: Density; byCols: Partial<Record<Density, Layout[]>> };

// Base 12-col arrangement. Summary is a full-width tile at the top.
const DEFAULT_12: Layout[] = [
  { i: 'summary',  x: 0, y: 0,  w: 12, h: 4,  minW: 3, minH: 3 },
  { i: 'details',  x: 0, y: 4,  w: 8,  h: 7,  minW: 3, minH: 3 },
  { i: 'metadata', x: 8, y: 4,  w: 4,  h: 9,  minW: 3, minH: 4 },
  { i: 'controls', x: 8, y: 13, w: 4,  h: 7,  minW: 3, minH: 4 },
  { i: 'activity', x: 0, y: 11, w: 8,  h: 12, minW: 3, minH: 5 },
  { i: 'kind',     x: 8, y: 20, w: 4,  h: 7,  minW: 3, minH: 3 },
  { i: 'links',    x: 0, y: 23, w: 8,  h: 6,  minW: 3, minH: 3 },
];

// Produce a sensible default layout for a given column count. For 12 we use the
// hand-tuned arrangement; for narrower densities we derive two-column (or single
// for very small `cols`) stacks that keep Summary full-width on top.
function defaultLayoutFor(cols: Density): Layout[] {
  if (cols === 12) return DEFAULT_12.map((l) => ({ ...l }));

  // Two-column split: a wider left rail and a narrower right rail.
  const left = Math.max(1, Math.ceil(cols * 0.62));
  const right = Math.max(1, cols - left);
  if (right < 1 || cols < 4) {
    // Single-column stack for tiny densities.
    const order: PanelId[] = ['summary', 'details', 'metadata', 'controls', 'activity', 'kind', 'links'];
    let y = 0;
    return order.map((i) => {
      const h = i === 'summary' ? 4 : i === 'activity' ? 12 : i === 'metadata' ? 9 : 7;
      const row = { i, x: 0, y, w: cols, h, minW: 1, minH: i === 'summary' ? 3 : 3 };
      y += h;
      return row;
    });
  }

  return [
    { i: 'summary',  x: 0,    y: 0,  w: cols,  h: 4,  minW: 2, minH: 3 },
    { i: 'details',  x: 0,    y: 4,  w: left,  h: 7,  minW: 2, minH: 3 },
    { i: 'metadata', x: left, y: 4,  w: right, h: 9,  minW: 2, minH: 4 },
    { i: 'controls', x: left, y: 13, w: right, h: 7,  minW: 2, minH: 4 },
    { i: 'activity', x: 0,    y: 11, w: left,  h: 12, minW: 2, minH: 5 },
    { i: 'kind',     x: left, y: 20, w: right, h: 7,  minW: 2, minH: 3 },
    { i: 'links',    x: 0,    y: 23, w: left,  h: 6,  minW: 2, minH: 3 },
  ];
}

function defaultStored(): StoredLayout {
  return { cols: 12, byCols: { 12: defaultLayoutFor(12) } };
}

// Tolerant migration: accepts the new StoredLayout shape, the old `Layouts`
// (breakpoint map) shape, or junk → default. Old layouts that had a `lg` array
// are adopted as the 12-col layout so existing users don't lose their work.
function coerceStored(raw: any): StoredLayout {
  if (raw && typeof raw === 'object' && raw.byCols && typeof raw.byCols === 'object') {
    const cols: Density = (DENSITIES as readonly number[]).includes(raw.cols) ? raw.cols : 12;
    const byCols: Partial<Record<Density, Layout[]>> = {};
    for (const d of DENSITIES) {
      if (Array.isArray(raw.byCols[d])) byCols[d] = raw.byCols[d];
    }
    if (!byCols[cols]) byCols[cols] = defaultLayoutFor(cols);
    return { cols, byCols };
  }
  // Legacy Layouts map { lg, md, sm }
  if (raw && typeof raw === 'object' && Array.isArray(raw.lg)) {
    return { cols: 12, byCols: { 12: raw.lg as Layout[] } };
  }
  return defaultStored();
}

// A draggable/resizable tile. The header is the drag handle (`.td-panel-h`);
// everything below scrolls independently so resize actually constrains content.
function Panel({ title, children, actions, editMode }: { title: string; children: React.ReactNode; actions?: React.ReactNode; editMode: boolean }) {
  return (
    <div className="td-panel">
      <div className={`td-panel-h${editMode ? ' td-drag-handle' : ''}`}>
        <h3>{title}</h3>
        <div className="row" style={{ gap: 8 }}>
          {actions}
          {editMode && <span className="td-grip" aria-hidden>⠿</span>}
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
  const [stored, setStored] = useState<StoredLayout>(() => defaultStored());
  const [loaded, setLoaded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount: hydrate from localStorage instantly, then reconcile with the DB.
  useEffect(() => {
    let cancelled = false;
    try {
      const cached = localStorage.getItem(LS_KEY);
      if (cached) setStored(coerceStored(JSON.parse(cached)));
    } catch { /* ignore bad cache */ }

    fetch(`/api/layouts/${LAYOUT_KEY}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        if (cancelled) return;
        const saved = d?.layout;
        if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
          const next = coerceStored(saved);
          setStored(next);
          try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
        }
      })
      .catch(() => { /* keep cache/default */ })
      .finally(() => { if (!cancelled) setLoaded(true); });

    return () => { cancelled = true; };
  }, []);

  const persist = useCallback((next: StoredLayout, immediate = false) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const put = () => {
      fetch(`/api/layouts/${LAYOUT_KEY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => { /* localStorage already holds it */ });
    };
    if (immediate) put();
    else saveTimer.current = setTimeout(put, 600);
  }, []);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const cols = stored.cols;
  // Active layout for the current density; lazily defaulted if missing.
  const activeLayout = useMemo(
    () => stored.byCols[cols] ?? defaultLayoutFor(cols),
    [stored, cols]
  );

  // RGL is driven by a single breakpoint whose cols = the user's density, plus a
  // narrow-screen collapse to one column. Keying by `cols` forces RGL to re-read
  // the layout when density changes.
  const breakpoints = useMemo(() => ({ active: NARROW_BP, narrow: 0 }), []);
  const colsMap = useMemo(() => ({ active: cols, narrow: 1 }), [cols]);
  const layouts: Layouts = useMemo(() => ({
    active: activeLayout,
    narrow: activeLayout.map((l, idx) => ({ ...l, x: 0, y: idx * 6, w: 1 })),
  }), [activeLayout]);

  // Persist user-driven drag/resize on the ACTIVE breakpoint only (ignore the
  // narrow collapse, and ignore the initial mount/hydrate).
  const onLayoutChange = useCallback((current: Layout[], all: Layouts) => {
    if (!loaded || !editMode) return;
    const next: StoredLayout = {
      cols,
      byCols: { ...stored.byCols, [cols]: all.active ?? current },
    };
    setStored(next);
    persist(next);
  }, [loaded, editMode, cols, stored.byCols, persist]);

  const setDensity = useCallback((d: Density) => {
    setStored((prev) => {
      const byCols = { ...prev.byCols };
      if (!byCols[d]) byCols[d] = defaultLayoutFor(d); // lazily generate
      const next: StoredLayout = { cols: d, byCols };
      persist(next);
      return next;
    });
  }, [persist]);

  const resetLayout = useCallback(() => {
    // Reset only the current density's arrangement.
    setStored((prev) => {
      const next: StoredLayout = {
        cols: prev.cols,
        byCols: { ...prev.byCols, [prev.cols]: defaultLayoutFor(prev.cols) },
      };
      persist(next);
      return next;
    });
  }, [persist]);

  const toggleEdit = useCallback(() => {
    setEditMode((on) => {
      // Leaving edit mode → flush the current layout immediately.
      if (on) persist(stored, true);
      return !on;
    });
  }, [persist, stored]);

  const saveNow = useCallback(() => persist(stored, true), [persist, stored]);

  const showKind = t.kind === 'change' || t.kind === 'problem' || t.kind === 'release';

  return (
    <div>
      <div className="row spread mb td-toolbar">
        <span className="sub">
          {editMode
            ? 'Drag panel headers to rearrange · drag corners to resize'
            : 'Layout locked — switch on Edit layout to rearrange'}
        </span>
        <div className="row" style={{ gap: 8 }}>
          {editMode && (
            <div className="td-density" role="group" aria-label="Grid density">
              <span className="td-density-l">Density</span>
              {DENSITIES.map((d) => (
                <button
                  key={d}
                  className={`td-density-b${cols === d ? ' on' : ''}`}
                  onClick={() => setDensity(d)}
                  aria-pressed={cols === d}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
          {editMode && <button className="btn ghost sm" onClick={resetLayout}>Reset layout</button>}
          {editMode && <button className="btn sm" onClick={saveNow}>Save</button>}
          <button
            className={`btn sm${editMode ? '' : ' ghost'}`}
            onClick={toggleEdit}
            aria-pressed={editMode}
          >
            {editMode ? 'Done' : 'Edit layout'}
          </button>
        </div>
      </div>

      <ResponsiveGridLayout
        className={`td-rgl${editMode ? ' td-editing' : ''}`}
        layouts={layouts}
        breakpoints={breakpoints}
        cols={colsMap}
        rowHeight={ROW_HEIGHT}
        margin={[16, 16]}
        containerPadding={[0, 0]}
        draggableHandle=".td-drag-handle"
        onLayoutChange={onLayoutChange}
        isDraggable={editMode}
        isResizable={editMode}
        isBounded={false}
        useCSSTransforms
      >
        <div key="summary">
          <Panel title="Summary" editMode={editMode}>
            <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <span className="tag st-blue">{KIND_LABEL[t.kind] ?? t.kind}</span>
              <AppTag app={t.app} />
              <span className={`pill ${sevClass[t.priority]}`}>● {sevLabel[t.priority]} priority</span>
            </div>
            <div className="h1" style={{ margin: '4px 0 8px', fontSize: 20 }}>{t.title}</div>
            <div className="kv">
              <div className="r"><span className="k2">Ref</span><span className="mono">{t.ref}</span></div>
              <div className="r"><span className="k2">Priority</span><span><b>{sevLabel[t.priority]}</b></span></div>
            </div>
          </Panel>
        </div>

        <div key="details">
          <Panel title="Details" editMode={editMode}>
            <p style={{ color: '#c8cedb', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {t.description || '—'}
            </p>
          </Panel>
        </div>

        <div key="activity">
          <Panel title="Activity" editMode={editMode}>
            <ActivityFeed ref_={t.ref} />
          </Panel>
        </div>

        <div key="metadata">
          <Panel title="Metadata" editMode={editMode}>
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
          <Panel title="Controls" editMode={editMode}>
            <TicketControls ref_={t.ref} kind={t.kind} status={t.status} assignee={t.assignee} embedded />
          </Panel>
        </div>

        <div key="kind">
          <Panel title={showKind ? (KIND_TITLE[t.kind] ?? 'Kind details') : 'Kind details'} editMode={editMode}>
            <KindAttrs t={t} />
          </Panel>
        </div>

        <div key="links">
          <Panel title="Linked records" editMode={editMode}>
            <LinkedRecords ref_={t.ref} />
          </Panel>
        </div>
      </ResponsiveGridLayout>
    </div>
  );
}
