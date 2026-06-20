'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';

// ---------------------------------------------------------------------------
// GraphCanvas — the force-directed global graph (Cytoscape.js).
//
// MUST be loaded via `dynamic(..., { ssr: false })` from app/graph/page.tsx —
// cytoscape touches `window`/`document` and is not SSR-safe.
//
// Fetches /api/graph (nodes + edges from ops.links with live container state),
// renders a cose force-directed layout, supports:
//   - ?node=finding:SEC-0001 focus (centres + highlights that node)
//   - node-type + severity filters (severity reuses the sev-* palette)
//   - single click → navigate to the node's detail page
//   - double click → expand/centre that node's neighbourhood
// Degrades gracefully: empty graph (pre-migration) → an explanatory empty state.
// ---------------------------------------------------------------------------

type GraphNode = {
  id: string; type: string; ref: string; label: string;
  severity?: string; status?: string; href: string;
};
type GraphEdge = { source: string; target: string; relation: string };

const NODE_TYPES = ['finding', 'ticket', 'component', 'container', 'kb', 'user', 'scan', 'alert'] as const;
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

// Colours — brand blue spine + the severity palette (mirrors the sev-* CSS).
const SEV_COLOR: Record<string, string> = {
  critical: '#ff5d5d', high: '#ff8b4d', medium: '#ffce4d', low: '#5dc2ff', info: '#8a93a6',
};
const TYPE_COLOR: Record<string, string> = {
  finding: '#2D6CFF', ticket: '#7fa8ff', component: '#36c98f', container: '#9b8cff',
  kb: '#4dd0e1', user: '#c792ea', scan: '#8a93a6', alert: '#ff8b4d',
};

function nodeColor(n: GraphNode): string {
  if ((n.type === 'finding' || n.type === 'ticket') && n.severity && SEV_COLOR[n.severity]) {
    return SEV_COLOR[n.severity];
  }
  return TYPE_COLOR[n.type] ?? '#7fa8ff';
}

export default function GraphCanvas({ focus }: { focus?: string }) {
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [live, setLive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set(NODE_TYPES));
  const [sevFilter, setSevFilter] = useState<Set<string>>(new Set(SEVERITIES));

  // Fetch graph data once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/graph', { cache: 'no-store' });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.ok) { setError(json?.error ?? `HTTP ${res.status}`); return; }
        setNodes(json.nodes ?? []);
        setEdges(json.edges ?? []);
        setLive(Boolean(json.live));
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'failed to load graph');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Apply filters → the visible element set.
  const elements = useMemo<ElementDefinition[]>(() => {
    const visible = new Set<string>();
    const nodeEls: ElementDefinition[] = [];
    for (const n of nodes) {
      if (!typeFilter.has(n.type)) continue;
      // Severity filter only constrains findings/tickets that carry severity.
      if ((n.type === 'finding' || n.type === 'ticket') && n.severity && !sevFilter.has(n.severity)) continue;
      visible.add(n.id);
      nodeEls.push({
        data: { id: n.id, label: n.label, type: n.type, href: n.href, color: nodeColor(n), ref: n.ref },
      });
    }
    const edgeEls: ElementDefinition[] = edges
      .filter((e) => visible.has(e.source) && visible.has(e.target))
      .map((e, i) => ({ data: { id: `e${i}`, source: e.source, target: e.target, label: e.relation } }));
    return [...nodeEls, ...edgeEls];
  }, [nodes, edges, typeFilter, sevFilter]);

  // (Re)build the cytoscape instance when the visible elements change.
  useEffect(() => {
    if (!boxRef.current || loading) return;
    if (elements.length === 0) {
      cyRef.current?.destroy();
      cyRef.current = null;
      return;
    }

    const cy = cytoscape({
      container: boxRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            color: '#e7ecf5',
            'font-size': 9,
            'text-wrap': 'ellipsis',
            'text-max-width': '90px',
            'text-valign': 'bottom',
            'text-margin-y': 4,
            width: 16,
            height: 16,
            'border-width': 1,
            'border-color': '#0c0f16',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.2,
            'line-color': '#2b3344',
            'target-arrow-color': '#2b3344',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.7,
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': 7,
            color: '#8a93a6',
            'text-rotation': 'autorotate',
          },
        },
        { selector: 'node.focused', style: { 'border-width': 3, 'border-color': '#fff', width: 24, height: 24 } },
        { selector: '.dim', style: { opacity: 0.25 } },
      ],
      layout: { name: 'cose', animate: false, padding: 40, nodeRepulsion: () => 9000 } as any,
      minZoom: 0.2,
      maxZoom: 3,
      wheelSensitivity: 0.2,
    });

    // Single click → navigate to the detail page.
    cy.on('tap', 'node', (evt) => {
      const href = evt.target.data('href');
      if (href && href !== '#') router.push(href);
    });

    // Double click → centre + highlight the node's 1-hop neighbourhood.
    cy.on('dbltap', 'node', (evt) => {
      const node = evt.target;
      const hood = node.closedNeighborhood();
      cy.elements().addClass('dim');
      hood.removeClass('dim');
      cy.animate({ center: { eles: node }, zoom: 1.3 }, { duration: 300 });
    });
    cy.on('tap', (evt) => { if (evt.target === cy) cy.elements().removeClass('dim'); });

    // Focus a specific node from ?node=type:ref.
    if (focus) {
      const target = cy.getElementById(focus);
      if (target.nonempty()) {
        target.addClass('focused');
        const hood = target.closedNeighborhood();
        cy.elements().addClass('dim');
        hood.removeClass('dim');
        cy.ready(() => cy.animate({ center: { eles: target }, zoom: 1.3 }, { duration: 400 }));
      }
    }

    cyRef.current = cy;
    return () => { cy.destroy(); cyRef.current = null; };
  }, [elements, loading, focus, router]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  return (
    <div>
      <div className="row wrap mb" style={{ gap: 16, alignItems: 'center' }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="sub" style={{ marginRight: 4 }}>Types</span>
          {NODE_TYPES.map((t) => (
            <button
              key={t}
              className={`chip${typeFilter.has(t) ? ' on' : ''}`}
              style={{ padding: '4px 10px', textTransform: 'capitalize' }}
              onClick={() => toggle(typeFilter, setTypeFilter, t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="sub" style={{ marginRight: 4 }}>Severity</span>
          {SEVERITIES.map((s) => (
            <button
              key={s}
              className={`chip${sevFilter.has(s) ? ' on' : ''}`}
              style={{ padding: '4px 10px', textTransform: 'capitalize' }}
              onClick={() => toggle(sevFilter, setSevFilter, s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="card pad0" style={{ position: 'relative', overflow: 'hidden' }}>
        <div ref={boxRef} style={{ width: '100%', height: 560 }} />
        {(loading || error || elements.length === 0) && (
          <div
            style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexDirection: 'column', gap: 8, pointerEvents: 'none',
              color: 'var(--muted)', textAlign: 'center', padding: 24,
            }}
          >
            {loading && <div>Loading graph…</div>}
            {!loading && error && <div>Couldn’t load the graph: {error}</div>}
            {!loading && !error && elements.length === 0 && (
              <>
                <div style={{ fontSize: 28 }}>⬡</div>
                <div>No links yet.</div>
                <div className="sub" style={{ maxWidth: 420 }}>
                  {live === false
                    ? 'The graph is empty or the DB isn’t reachable. Once migration 08 is applied and findings are ingested, the finding→component→container spine appears here automatically.'
                    : 'Edges appear as findings are ingested and records are linked.'}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="sub mt" style={{ marginTop: 10 }}>
        Click a node to open it · double-click to focus its neighbourhood · drag to pan, scroll to zoom.
        {live === false && ' · (data layer offline — showing empty graph)'}
      </div>
    </div>
  );
}
