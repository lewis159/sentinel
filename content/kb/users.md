# User Audit

_Living document — reflects the current build; re-verify after changes._

## Purpose

**User Audit** (route `/users`) is the anti-abuse surface. It pulls the monitored platform's
real users and scores each one for risk — disposable-email domains, brand-new accounts,
multi-account/abuse signals — so you can review and act before abuse costs you.

![User audit — risk-scored list with abuse signals](./images/users-risk.png)

## How to use it

- **Audit list** (`/users`) — users sorted by recency, each with a **risk score** and the
  signals that drove it.
- **User detail** (`/users/[id]`) — the full signal set, device/IP clusters, and linked
  findings/tickets.

### How risk is scored (current build)

From `lib/data.ts` `getUsers()`:

- **Disposable email** (domain matches tempmail / guerrillamail / mailinator /
  10minutemail / throwaway / yopmail) → +60 and a "Disposable email" signal.
- **New account (<24h)** → +25 and a "New account (<24h)" signal.
- A baseline +10. Score is capped at **99**.

## How it works (technical)

User data is **not** in Sentinel's own DB — it is the monitored platform's data, pulled
live through the Supabase **connector**:

- `getUsers()` calls `supabase.from('users').select('id,email,tier,created_at').limit(50)`.
- The connector is configured in [Settings → Connectors](./settings-connectors.md), not via
  environment variables.
- If no connector is enabled, or the query errors, the page falls back to mock users and
  drops the **live** badge (with a note such as `no connector` or the error message).

The `abuse` scan check (see [Scans](./scans.md)) uses the same source to raise persistent
abuse **findings** in `ops.findings`.

## Common tasks

- **Review fresh high-risk signups:** the list is recency-ordered; scan the top for high scores.
- **Investigate a user:** open the detail page for device/IP clusters and linked entities.
- **Turn a pattern into a tracked issue:** raise/relate a finding or ticket from the user.

## Troubleshooting

- **List shows demo users / no live badge** — the Supabase connector is missing, disabled, or
  failing its test. Configure it in Settings → Connectors.
- **Risk scores look wrong** — scoring is heuristic (see above); tune the disposable-domain
  list and thresholds in `lib/data.ts` if needed.
- **No users returned** — the connector's `users` table is empty or the key lacks read access.

## Error codes / messages

| Message / note | Meaning | Fix |
|----------------|---------|-----|
| `no connector` | No enabled Supabase connector | Add one in Settings → Connectors |
| `no users` | Query returned 0 rows | Verify the source `users` table / key scope |
| `<supabase error message>` | The Supabase query failed | Check URL/key, RLS, network; re-test the connector |
