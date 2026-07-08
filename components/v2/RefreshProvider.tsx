'use client';

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SWRConfig } from 'swr';

export const REFRESH_OPTIONS = [
  { label: 'Off', ms: 0 },
  { label: '1s', ms: 1000 },
  { label: '3s', ms: 3000 },
  { label: '5s', ms: 5000 },
  { label: '10s', ms: 10000 },
  { label: '30s', ms: 30000 },
] as const;

const STORAGE_KEY = 'sentinel.v2.refresh';
const DEFAULT_INTERVAL = 5000;

export type RefreshContextValue = {
  intervalMs: number;
  setIntervalMs: (ms: number) => void;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  effectiveMs: number;
  lastRefreshed: number | null;
  refreshNow: () => void;
};

const DEFAULT_CONTEXT: RefreshContextValue = {
  intervalMs: DEFAULT_INTERVAL,
  setIntervalMs: () => {},
  paused: false,
  setPaused: () => {},
  effectiveMs: DEFAULT_INTERVAL,
  lastRefreshed: null,
  refreshNow: () => {},
};

const RefreshContext = createContext<RefreshContextValue | null>(null);

export function useRefresh(): RefreshContextValue {
  const ctx = useContext(RefreshContext);
  return ctx ?? DEFAULT_CONTEXT;
}

export default function RefreshProvider({ children }: { children: React.ReactNode }) {
  const [intervalMs, setIntervalMsState] = useState<number>(DEFAULT_INTERVAL);
  const [paused, setPausedState] = useState<boolean>(false);
  const [hidden, setHidden] = useState<boolean>(false);
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);

  // Hydrate persisted state on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { intervalMs?: number; paused?: boolean };
        if (typeof parsed.intervalMs === 'number') setIntervalMsState(parsed.intervalMs);
        if (typeof parsed.paused === 'boolean') setPausedState(parsed.paused);
      }
    } catch {
      /* ignore storage/parse errors */
    }
    // Seed initial visibility.
    if (typeof document !== 'undefined') {
      setHidden(document.visibilityState === 'hidden');
    }
  }, []);

  // Persist interval + paused.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ intervalMs, paused }));
    } catch {
      /* ignore storage errors */
    }
  }, [intervalMs, paused]);

  // Track tab visibility.
  useEffect(() => {
    const onVis = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const effectiveMs = useMemo(() => {
    if (intervalMs === 0 || paused || hidden) return 0;
    return intervalMs;
  }, [intervalMs, paused, hidden]);

  const refreshNow = useCallback(() => {
    setLastRefreshed(Date.now());
  }, []);

  // Heartbeat: while there is an active interval, bump lastRefreshed each tick so
  // the UI shows live activity even before real SWR hooks are wired up.
  useEffect(() => {
    if (effectiveMs <= 0) return;
    const id = setInterval(() => setLastRefreshed(Date.now()), effectiveMs);
    return () => clearInterval(id);
  }, [effectiveMs]);

  const setIntervalMs = useCallback((ms: number) => setIntervalMsState(ms), []);
  const setPaused = useCallback((p: boolean) => setPausedState(p), []);

  // Keep an always-current callback for SWR's onSuccess (which is captured once
  // at config-read time but should always reflect the latest setter).
  const bumpRef = useRef(refreshNow);
  useEffect(() => {
    bumpRef.current = refreshNow;
  }, [refreshNow]);

  const value = useMemo<RefreshContextValue>(
    () => ({
      intervalMs,
      setIntervalMs,
      paused,
      setPaused,
      effectiveMs,
      lastRefreshed,
      refreshNow,
    }),
    [intervalMs, setIntervalMs, paused, setPaused, effectiveMs, lastRefreshed, refreshNow],
  );

  const swrConfig = useMemo(
    () => ({
      refreshInterval: effectiveMs,
      revalidateOnFocus: true,
      refreshWhenHidden: false,
      onSuccess: () => {
        bumpRef.current();
      },
    }),
    [effectiveMs],
  );

  return (
    <RefreshContext.Provider value={value}>
      <SWRConfig value={swrConfig}>{children}</SWRConfig>
    </RefreshContext.Provider>
  );
}
