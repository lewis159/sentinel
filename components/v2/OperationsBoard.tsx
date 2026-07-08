'use client';

import dynamic from 'next/dynamic';

import { EditModeProvider, EditModeToggle } from '@/components/EditMode';
import {
  OPS_CATALOG,
  OPS_DEFAULT_ACTIVE,
  OPS_DEFAULT_LAYOUT,
} from '@/components/v2/widgets/operations';

// react-grid-layout needs the DOM (width measurement, drag). Load the grid on
// the client only so the page can still be a server component.
const WidgetGrid = dynamic(
  () => import('@/components/v2/WidgetGrid').then((m) => m.WidgetGrid),
  { ssr: false }
);

export default function OperationsBoard() {
  return (
    <EditModeProvider>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
        }}
      >
        <EditModeToggle />
      </div>

      <WidgetGrid
        layoutKey="v2-operations"
        catalog={OPS_CATALOG}
        defaultActive={OPS_DEFAULT_ACTIVE}
        defaultLayout={OPS_DEFAULT_LAYOUT}
      />
    </EditModeProvider>
  );
}
