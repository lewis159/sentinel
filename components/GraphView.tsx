'use client';

import dynamic from 'next/dynamic';

// Cytoscape is client-only (touches window/document). Load the canvas via a
// dynamic import with ssr:false so `next build` never renders it on the server.
// This wrapper is the client boundary the server page imports — mirrors the
// MonitoringDashboard → DashboardGrid pattern.
const GraphCanvas = dynamic(() => import('./GraphCanvas'), {
  ssr: false,
  loading: () => <div className="card" style={{ height: 560 }} />,
});

export function GraphView({ focus }: { focus?: string }) {
  return <GraphCanvas focus={focus} />;
}
