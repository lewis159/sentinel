'use client';

import dynamic from 'next/dynamic';

import { EditModeProvider, EditModeToggle } from '@/components/EditMode';
import {
  SEC_CATALOG,
  SEC_DEFAULT_ACTIVE,
  SEC_DEFAULT_LAYOUT,
} from '@/components/v2/widgets/security';

// react-grid-layout needs the DOM (width measurement, drag). Load the grid on
// the client only so the page can still be a server component.
const WidgetGrid = dynamic(
  () => import('@/components/v2/WidgetGrid').then((m) => m.WidgetGrid),
  { ssr: false }
);

export default function SecurityBoard() {
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
        layoutKey="v2-security"
        catalog={SEC_CATALOG}
        defaultActive={SEC_DEFAULT_ACTIVE}
        defaultLayout={SEC_DEFAULT_LAYOUT}
      />
    </EditModeProvider>
  );
}
