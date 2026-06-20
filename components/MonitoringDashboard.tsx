'use client';

import dynamic from 'next/dynamic';
import { placeWidgets } from './widgets/registry';
import {
  MONITORING_WIDGETS,
  MONITORING_WIDGET_IDS,
  MONITORING_DEFAULT_LAYOUT,
} from './widgets/monitoring';

// react-grid-layout is client-only (touches window/ResizeObserver). Load the
// DashboardGrid via a dynamic import with ssr:false so `next build` never tries
// to render the grid on the server. A light skeleton holds the space.
const DashboardGrid = dynamic(() => import('./DashboardGrid').then((m) => m.DashboardGrid), {
  ssr: false,
  loading: () => <div className="sub" style={{ padding: 8 }}>Loading dashboard…</div>,
});

// The Operations → Monitoring dashboard: the reusable DashboardGrid filled with
// the four core monitoring widgets, persisted under the `ops-monitoring` key.
export function MonitoringDashboard() {
  const widgets = placeWidgets(MONITORING_WIDGETS, [...MONITORING_WIDGET_IDS]);
  return (
    <DashboardGrid
      layoutKey="ops-monitoring"
      widgets={widgets}
      defaultLayout={MONITORING_DEFAULT_LAYOUT}
    />
  );
}
