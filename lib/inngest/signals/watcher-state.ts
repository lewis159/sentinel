// Persistent cross-run de-dup marker for the estate watcher cron.
//
// The watcher (lib/inngest/functions/watchers.ts) runs every 30 minutes. Step
// memoization makes any ONE run idempotent, but it can't stop successive runs
// from re-alerting while the SAME ongoing condition persists. claimWatcherAlert()
// is that cross-run gate: it records a coarse `fingerprint` of the current
// condition against a `signal` key and returns whether THIS tick should alert.
//
// Semantics — alert (return true) when:
//   • no marker exists yet for this signal (first ever trip), OR
//   • the fingerprint changed since the last alert (condition materially moved), OR
//   • the cooldown window has elapsed (an unchanged, still-ongoing condition
//     resurfaces at most once per cooldown as a reminder).
// Otherwise (same fingerprint, still inside cooldown) return false → de-duped.
//
// The claim-and-set is a SINGLE atomic upsert (insert … on conflict do update …
// where … returning), so two overlapping ticks can never both win for the same
// fingerprint — exactly one gets the RETURNING row.
//
// Mock-safe: with no DB (hasDb === false) there is nothing to persist AND
// saveProposal/broadcast themselves no-op, so we fail OPEN (return true) — the
// watcher still runs its (inert) alert path in dev without a spurious de-dup.
import { hasDb, q, q1 } from '@/lib/db';

// Default cooldown: a still-ongoing, unchanged condition re-surfaces at most once
// every 6 hours (12 ticks at the 30-min cadence) instead of every tick.
export const DEFAULT_WATCHER_COOLDOWN_SECONDS = 6 * 60 * 60;

// Lazily create the marker table on the write path so prod doesn't hard-depend on
// migration 18 having run first (mirrors lib/hermes/proposals.ts).
async function ensureTable(): Promise<void> {
  await q(
    `create table if not exists ops.hermes_watcher_state (
       signal          text primary key,
       fingerprint     text not null,
       last_alerted_at timestamptz not null default now(),
       detail          jsonb not null default '{}',
       updated_at      timestamptz not null default now()
     )`,
  );
}

/**
 * Claim the right to alert for (signal, fingerprint). Returns true when this tick
 * should broadcast + file a proposal, false when the SAME condition was already
 * alerted within `cooldownSeconds` (de-dup). Atomic: exactly one concurrent
 * caller can win for a given fingerprint. Fails OPEN (true) with no DB.
 */
export async function claimWatcherAlert(
  signal: string,
  fingerprint: string,
  cooldownSeconds: number = DEFAULT_WATCHER_COOLDOWN_SECONDS,
  detail: Record<string, unknown> = {},
): Promise<boolean> {
  if (!hasDb) return true; // nothing to persist; alert path is inert in dev anyway.
  try {
    await ensureTable();
    // On a first insert the row returns → claim won. On conflict we only update
    // (and return a row) when the fingerprint changed OR the cooldown elapsed;
    // otherwise the WHERE fails, no row is returned, and the claim is refused.
    const row = await q1<{ signal: string }>(
      `insert into ops.hermes_watcher_state (signal, fingerprint, last_alerted_at, detail, updated_at)
       values ($1, $2, now(), $4::jsonb, now())
       on conflict (signal) do update
         set fingerprint = excluded.fingerprint,
             last_alerted_at = now(),
             detail = excluded.detail,
             updated_at = now()
         where ops.hermes_watcher_state.fingerprint <> excluded.fingerprint
            or ops.hermes_watcher_state.last_alerted_at < now() - make_interval(secs => $3)
       returning signal`,
      [signal, fingerprint, cooldownSeconds, JSON.stringify(detail)],
    );
    return Boolean(row);
  } catch {
    // On any DB error, fail OPEN — better to risk a duplicate alert than to
    // silently swallow a real one because the marker table hiccuped.
    return true;
  }
}
