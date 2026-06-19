'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

// Silent auto-refresh for data pages. Renders nothing.
//
// Polls /api/poll?source=<source> on an interval (default 20s) and, when the
// returned signature changes, calls router.refresh() — which re-fetches the
// server component's data and reconciles WITHOUT remounting the client
// components below it. So SectionView's selected row and any open modal/compose
// box are preserved across the refresh.
//
// Behaviour:
//   - fetches once on mount to establish the baseline signature
//   - only polls while the tab is visible (document.visibilityState)
//   - re-checks immediately when the tab becomes visible again
//   - ignores fetch errors (never refreshes on a failed/!ok poll)
//   - clears the interval + listener on unmount
export function AutoRefresh({ source, intervalMs = 20000 }: { source: string; intervalMs?: number }) {
  const router = useRouter();
  const sigRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check(allowRefresh: boolean) {
      try {
        const res = await fetch(`/api/poll?source=${encodeURIComponent(source)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        const sig: unknown = data?.sig;
        if (cancelled || typeof sig !== 'string') return;

        if (sigRef.current === null) {
          // First successful poll: establish baseline, don't refresh.
          sigRef.current = sig;
          return;
        }
        if (allowRefresh && sig !== sigRef.current) {
          sigRef.current = sig;
          router.refresh();
        } else {
          sigRef.current = sig;
        }
      } catch {
        /* ignore — never refresh on error */
      }
    }

    // Establish baseline immediately.
    check(false);

    const id = setInterval(() => {
      if (document.visibilityState === 'visible') check(true);
    }, intervalMs);

    function onVisible() {
      if (document.visibilityState === 'visible') check(true);
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [source, intervalMs, router]);

  return null;
}
