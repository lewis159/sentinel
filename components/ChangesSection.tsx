'use client';

import { useState } from 'react';
import { type ServiceTicket } from '@/lib/mock';
import { SectionView } from './SectionView';
import { ChangeCalendar } from './ChangeCalendar';
import { CabQueue } from './CabQueue';

// Changes screen wrapper. Adds a Calendar mode alongside SectionView's own
// List ⇄ Board toggle WITHOUT modifying SectionView: when mode === 'calendar'
// we render the ChangeCalendar; otherwise SectionView renders (and keeps its
// internal List/Board toggle intact). The CAB queue sits above every mode since
// approvals are relevant whichever view is open.
export function ChangesSection({ changes }: { changes: ServiceTicket[] }) {
  const [mode, setMode] = useState<'tickets' | 'calendar'>('tickets');
  // Set when a calendar entry is clicked: jump to List/Board with that change
  // preselected in the master-detail pane.
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div>
      <CabQueue changes={changes} />

      <div className="row mb" style={{ gap: 6 }}>
        <span className="sub" style={{ marginRight: 4 }}>View</span>
        <button className={`chip ${mode === 'tickets' ? 'on' : ''}`} onClick={() => setMode('tickets')}>List / Board</button>
        <button className={`chip ${mode === 'calendar' ? 'on' : ''}`} onClick={() => setMode('calendar')}>Calendar</button>
      </div>

      {mode === 'calendar'
        ? <ChangeCalendar changes={changes} onSelect={(ref) => { setPicked(ref); setMode('tickets'); }} />
        : <SectionView kind="change" tickets={changes} initialSelected={picked} />}
    </div>
  );
}
