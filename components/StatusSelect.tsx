'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const OPTIONS = ['open', 'in_progress', 'fixed', 'acknowledged'];

export function StatusSelect({ findingRef, status }: { findingRef: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState(status);

  async function change(next: string) {
    setValue(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/ops/findings/${findingRef}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error('failed');
      router.refresh();
    } catch {
      setValue(status);
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      className="chip"
      value={value}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      style={{ fontWeight: 600, color: 'var(--high)' }}
    >
      {OPTIONS.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
