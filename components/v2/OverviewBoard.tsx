'use client';

import dynamic from 'next/dynamic';

import { EditModeProvider, EditModeToggle } from '@/components/EditMode';
import { NewTicketButton } from '@/components/v2/NewTicketModal';
import {
  OVERVIEW_CATALOG,
  DEFAULT_ACTIVE,
  DEFAULT_LAYOUT,
} from '@/components/v2/widgets/overview';

// react-grid-layout needs the DOM (width measurement, drag). Load the grid on
// the client only so the page can still be a server component.
const WidgetGrid = dynamic(
  () => import('@/components/v2/WidgetGrid').then((m) => m.WidgetGrid),
  { ssr: false }
);

export default function OverviewBoard() {
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
        <NewTicketButton className="v2-btn" label="New ticket" />
      </div>

      <WidgetGrid
        layoutKey="v2-overview-2"
        catalog={OVERVIEW_CATALOG}
        defaultActive={DEFAULT_ACTIVE}
        defaultLayout={DEFAULT_LAYOUT}
      />
    </EditModeProvider>
  );
}
