'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RaiseTicketButton({ findingRef }: { findingRef: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function raise() {
    setBusy(true);
    try {
      const res = await fetch(`/api/ops/findings/${findingRef}/raise-ticket`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data?.ref) throw new Error(data?.error ?? 'failed');
      router.push(`/tickets/${data.ref}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <button className="btn sm" onClick={raise} disabled={busy}>
      {busy ? 'Raising…' : 'Raise ticket'}
    </button>
  );
}
