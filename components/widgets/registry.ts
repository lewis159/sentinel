// Widget registry for the reusable DashboardGrid.
//
// A widget is a self-contained client component that fetches its own data and
// renders its own loading / empty / unreachable states. The registry maps a
// stable string id → metadata (title, component, default + minimum grid size).
//
// DashboardGrid places widgets by id, looking each one up here. The same
// abstraction powers both the ticket-detail dashboard (whose "widgets" are the
// ITIL panels, registered ad-hoc with a closure over the ticket) and the
// Operations → Monitoring dashboard (whose widgets are the monitoring tiles
// below). See components/DashboardGrid.tsx for how the registry is consumed.

import type { ComponentType } from 'react';

export type WidgetSize = { w: number; h: number };

export type WidgetDef = {
  /** Human title shown in the tile header (also the drag handle row). */
  title: string;
  /** The tile body. Rendered inside the panel chrome by DashboardGrid. */
  component: ComponentType;
  /** Default footprint in grid units at 12-col density. */
  defaultSize: WidgetSize;
  /** Optional minimum footprint (defaults to a sensible small floor). */
  minSize?: WidgetSize;
};

export type WidgetRegistry = Record<string, WidgetDef>;

// A widget placed on a specific dashboard. DashboardGrid takes a list of these;
// `id` keys into a registry (or carries its own def for ad-hoc panels). For the
// monitoring page we hand DashboardGrid registry entries directly so the page
// stays declarative.
export type PlacedWidget = {
  id: string;
} & WidgetDef;

// Helper: turn a registry + ordered id list into PlacedWidget[]. Unknown ids are
// dropped (defensive against a stale saved layout referencing a removed widget).
export function placeWidgets(registry: WidgetRegistry, ids: string[]): PlacedWidget[] {
  const out: PlacedWidget[] = [];
  for (const id of ids) {
    const def = registry[id];
    if (def) out.push({ id, ...def });
  }
  return out;
}
