// The monitoring widget registry + default layout for the Operations →
// Monitoring dashboard. Imported by the client MonitoringDashboard wrapper.

import type { Layout } from 'react-grid-layout';
import type { WidgetRegistry } from './registry';
import { TopologyWidget } from './TopologyWidget';
import { CpuWidget } from './CpuWidget';
import { UptimeWidget } from './UptimeWidget';
import { OpenIncidentsWidget } from './OpenIncidentsWidget';
import { MemoryWidget } from './MemoryWidget';
import { DiskWidget } from './DiskWidget';
import { AlertsWidget } from './AlertsWidget';
import { LogTailWidget } from './LogTailWidget';
import { GrafanaPanelWidget } from './GrafanaPanelWidget';

export const MONITORING_WIDGETS: WidgetRegistry = {
  topology: { title: 'Topology', component: TopologyWidget, defaultSize: { w: 5, h: 12 }, minSize: { w: 3, h: 6 } },
  cpu: { title: 'CPU', component: CpuWidget, defaultSize: { w: 4, h: 6 }, minSize: { w: 3, h: 4 } },
  uptime: { title: 'Uptime', component: UptimeWidget, defaultSize: { w: 3, h: 12 }, minSize: { w: 2, h: 5 } },
  openIncidents: { title: 'Open incidents', component: OpenIncidentsWidget, defaultSize: { w: 7, h: 6 }, minSize: { w: 3, h: 4 } },
  // Phase 2 — addable from the tray (not in the default layout).
  memory: { title: 'Memory', component: MemoryWidget, defaultSize: { w: 4, h: 6 }, minSize: { w: 3, h: 4 } },
  disk: { title: 'Disk', component: DiskWidget, defaultSize: { w: 4, h: 7 }, minSize: { w: 3, h: 4 } },
  alerts: { title: 'Alerts', component: AlertsWidget, defaultSize: { w: 4, h: 8 }, minSize: { w: 3, h: 4 } },
  logs: { title: 'Log tail', component: LogTailWidget, defaultSize: { w: 7, h: 8 }, minSize: { w: 4, h: 5 } },
  grafana: { title: 'Grafana panel', component: GrafanaPanelWidget, defaultSize: { w: 6, h: 8 }, minSize: { w: 3, h: 5 } },
};

// Ordered ids placed on the dashboard.
export const MONITORING_WIDGET_IDS = ['topology', 'cpu', 'uptime', 'openIncidents'] as const;

// Canonical 12-col arrangement: Topology tall on the left, CPU + Open incidents
// stacked in the middle, Uptime tall on the right.
export const MONITORING_DEFAULT_LAYOUT: Layout[] = [
  { i: 'topology',      x: 0, y: 0, w: 5, h: 12, minW: 3, minH: 6 },
  { i: 'cpu',           x: 5, y: 0, w: 4, h: 6,  minW: 3, minH: 4 },
  { i: 'openIncidents', x: 5, y: 6, w: 4, h: 6,  minW: 3, minH: 4 },
  { i: 'uptime',        x: 9, y: 0, w: 3, h: 12, minW: 2, minH: 5 },
];
