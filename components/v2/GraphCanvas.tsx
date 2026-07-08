'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import cytoscape from 'cytoscape';

type GraphNode = {
  id: string;
  type: string;
  ref: string;
  label: string;
  severity?: string;
  status?: string;
  href?: string;
};
type GraphEdge = { source: string; target: string; relation: string };
type GraphResp = { ok: boolean; live: boolean; nodes: GraphNode[]; edges: GraphEdge[] };

const fetcher = (u: string) => fetch(u).then((r) => r.json());

// Node fill by type. Hexes are baked in (not CSS vars) because cytoscape paints to
// a canvas and cannot read the v2 design tokens.
const TYPE_COLOR: Record<string, string> = {
  finding: '#F0616D',   // crit
  incident: '#F5A524',  // high
  ticket: '#38BDF8',    // sky
  component: '#4C8DFF',  // accent
  kb: '#8E86E6',        // purple
  container: '#838EA3',  // muted
};
const DEFAULT_COLOR = '#838EA3';
const colorFor = (type: string) => TYPE_COLOR[type] ?? DEFAULT_COLOR;

// Signature of the graph's shape — used to avoid re-running layout on every poll
// when nothing structural changed.
function signature(nodes: GraphNode[], edges: GraphEdge[]): string {
  return (
    nodes.map((n) => n.id).sort().join(',') +
    '|' +
    edges.map((e) => `${e.source}>${e.target}`).sort().join(',')
  );
}

export default function GraphCanvas() {
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const sigRef = useRef<string>('');
  const routerRef = useRef(router);
  routerRef.current = router;

  // Global refreshInterval comes from an ancestor <SWRConfig> (RefreshProvider) —
  // do NOT set an interval here.
  const { data, error } = useSWR<GraphResp>('/api/graph', fetcher);

  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  const loading = !data && !error;
  const isEmpty = !!data && nodes.length === 0;

  // Sync the cytoscape instance with the fetched graph.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    // Nothing to draw — tear down any existing instance so the empty-state overlay
    // shows through cleanly.
    if (nodes.length === 0) {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
        sigRef.current = '';
      }
      return;
    }

    const sig = signature(nodes, edges);

    const elements = [
      ...nodes.map((n) => ({
        data: { id: n.id, label: n.label || n.ref, type: n.type, href: n.href ?? '' },
      })),
      ...edges.map((e) => ({
        data: {
          id: `${e.source}__${e.target}__${e.relation}`,
          source: e.source,
          target: e.target,
          relation: e.relation,
        },
      })),
    ];

    if (!cyRef.current) {
      const cy = cytoscape({
        container: box,
        elements,
        minZoom: 0.2,
        maxZoom: 3,
        wheelSensitivity: 0.2,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': (ele: any) => colorFor(ele.data('type')),
              label: 'data(label)',
              color: '#E7EBF3',
              'font-size': 10,
              'font-family': "-apple-system, 'Segoe UI', Roboto, sans-serif",
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 4,
              'text-max-width': '120px',
              'text-wrap': 'ellipsis',
              width: 22,
              height: 22,
              'border-width': 2,
              'border-color': '#0A0D13',
            },
          },
          {
            selector: 'edge',
            style: {
              width: 1.5,
              'line-color': '#3B4353',
              'curve-style': 'bezier',
              'target-arrow-shape': 'triangle',
              'target-arrow-color': '#3B4353',
              'arrow-scale': 0.8,
            },
          },
        ] as any,
        layout: { name: 'cose', animate: false, padding: 24 },
      });

      cy.on('tap', 'node', (evt) => {
        const href = evt.target.data('href');
        if (href) routerRef.current.push(href);
      });

      cyRef.current = cy;
      sigRef.current = sig;
      return;
    }

    // Instance exists — only rebuild + relayout when the shape actually changed.
    if (sig !== sigRef.current) {
      const cy = cyRef.current;
      cy.batch(() => {
        cy.elements().remove();
        cy.add(elements as any);
      });
      cy.layout({ name: 'cose', animate: false, padding: 24 }).run();
      sigRef.current = sig;
    }
  }, [nodes, edges]);

  // Destroy on unmount.
  useEffect(() => {
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, []);

  return (
    <div className="v2-gr-wrap">
      <div ref={boxRef} className="v2-gr-canvas" />

      {loading && (
        <div className="v2-gr-state">Loading graph…</div>
      )}

      {error && !data && (
        <div className="v2-gr-state">Couldn&apos;t load the graph.</div>
      )}

      {isEmpty && (
        <div className="v2-gr-state">
          <div className="v2-gr-empty-t">No links yet</div>
          <div className="v2-gr-empty-d">
            The graph populates as findings, tickets and incidents get linked.
          </div>
        </div>
      )}
    </div>
  );
}
