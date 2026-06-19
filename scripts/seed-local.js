// Seeds the LOCAL sentinel-db Postgres: ops components/findings/tickets + a
// pre-configured Supabase connector (from .env.local) so YT data works out of
// the box. Run after the stack is up: node scripts/seed-local.js
const fs = require('fs'); const path = require('path');
const { Client } = require('pg');

const env = {};
try {
  for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
  }
} catch {}

const DB = process.env.DATABASE_URL || 'postgres://sentinel:sentinel@localhost:5432/sentinel';

const components = [
  ['app', 'YT Transcriber App', 'service'], ['nginx', 'nginx HA', 'infra'], ['redis', 'Redis', 'infra'],
  ['api/admin', 'Admin API', 'route'], ['api/videos', 'Videos API', 'route'],
];
const findings = [
  ['SEC-0009', 'Raw Docker socket exposed to app container', 'App can reach the Docker daemon — container escape risk', 'critical', 9.1, 'CWE-668', 'swarm / app', 'access-audit', 'in_progress'],
  ['SEC-0008', 'Service-role key reachable from edge route', 'Supabase service key importable in a client-adjacent path', 'critical', 8.6, 'CWE-200', 'api/admin', 'gitleaks', 'open'],
  ['SEC-0007', 'No rate limit on /api/videos submit', 'Unauthenticated abuse / quota-bypass vector', 'high', 7.4, 'CWE-770', 'api/videos', 'access-audit', 'open'],
  ['SEC-0006', 'Share links lack expiry enforcement', 'expires_at stored but never checked on access', 'high', 7.1, 'CWE-613', 'api/share', 'access-audit', 'in_progress'],
  ['SEC-0005', 'Admin routes missing CSRF protection', 'State-changing POSTs accept cross-origin form posts', 'high', 6.8, 'CWE-352', 'api/admin', 'access-audit', 'open'],
  ['SEC-0004', 'Missing CSP + HSTS headers at origin', 'nginx returns no security headers', 'medium', 5.3, 'CWE-693', 'nginx', 'headers', 'open'],
  ['SEC-0003', 'Outdated dependency: next advisory', '1 moderate advisory in a transitive dep', 'medium', 5.0, 'CWE-1104', 'package.json', 'npm-audit', 'open'],
  ['SEC-0002', 'Container memory at 91% of limit', 'app replica sustained >85% mem for 20m', 'medium', null, null, 'swarm / app', 'capacity', 'open'],
  ['SEC-0001', 'Verbose error stack returned on 500', 'Stack traces leaked to client in prod', 'low', 3.1, 'CWE-209', 'app', 'access-audit', 'fixed'],
];
const tickets = [
  ['OPS-0007', 'Harden Docker socket via read-only proxy', 'security', 'in_progress', 'critical', 'finding'],
  ['OPS-0006', 'Add rate limiting to public submit endpoints', 'security', 'open', 'high', 'manual'],
  ['OPS-0005', 'Enforce share-link expiry on access', 'security', 'in_progress', 'high', 'finding'],
  ['OPS-0004', 'Roll out CSP + HSTS at nginx', 'infra', 'open', 'medium', 'finding'],
  ['OPS-0003', 'Investigate app memory pressure', 'infra', 'blocked', 'medium', 'alert'],
  ['OPS-0001', 'Suppress verbose 500 stack traces', 'security', 'resolved', 'low', 'finding'],
];

// Service-management (ITIL) records — extend ops.tickets via the `kind` column.
// [ref, kind, title, description, status, priority, impact, urgency, app, source, sla_hours, attrs]
const serviceTickets = [
  ['INC-0001', 'incident', 'Transcription queue backed up — jobs stalled', 'Worker pool stopped draining the queue; users see "processing" indefinitely.', 'in_progress', 'critical', 'high', 'high', 'YT', 'alert', 3, {}],
  ['INC-0002', 'incident', 'Sentinel infra page failing to load container stats', 'docker-socket-proxy returned 502 for ~10 minutes.', 'resolved', 'medium', 'medium', 'low', 'Sentinel', 'manual', null, {}],
  ['INC-0003', 'incident', 'Memory pressure on app replica', 'app replica sustained >85% mem for 20m.', 'open', 'medium', 'medium', 'medium', 'YT', 'alert', 20, {}],
  ['REQ-0001', 'request', 'Provision Studio tier for new org', 'Onboarding request for a Studio-tier workspace.', 'open', 'low', 'low', 'low', 'YT', 'manual', null, {}],
  ['REQ-0002', 'request', 'Add team member to Sentinel global-admin', 'Access request — approval pending.', 'in_progress', 'medium', 'low', 'medium', 'Sentinel', 'manual', null, {}],
  ['CHG-0001', 'change', 'Roll out CSP + HSTS at nginx origin', 'Normal change — add security headers across all estate apps.', 'awaiting_cab', 'medium', 'medium', 'low', 'Estate', 'finding', null, { risk: 'medium', cab_status: 'pending', window: '2026-06-22 02:00 UTC', backout: 'Revert nginx config block; reload.', change_type: 'normal' }],
  ['CHG-0002', 'change', 'Migrate Sentinel DB to self-hosted HA Postgres', 'Major change — Patroni + etcd + HAProxy cutover.', 'draft', 'high', 'high', 'medium', 'Sentinel', 'manual', null, { risk: 'high', cab_status: 'not_submitted', window: 'TBD', backout: 'Repoint DATABASE_URL to old instance.', change_type: 'normal' }],
  ['CHG-0003', 'change', 'Emergency: rotate leaked service-role key', 'Emergency change to rotate the Supabase service key.', 'implemented', 'critical', 'high', 'high', 'YT', 'finding', null, { risk: 'high', cab_status: 'approved', window: 'immediate', backout: 'N/A — key rotation.', change_type: 'emergency' }],
  ['PRB-0001', 'problem', 'Recurring queue stalls under burst load', 'Multiple incidents trace to the same worker lock contention.', 'investigating', 'high', 'high', 'medium', 'YT', 'manual', null, { root_cause: 'Single advisory lock held across long transcribe job.', known_error: false, workaround: 'Manually restart worker pool when depth > 200.' }],
  ['PRB-0002', 'problem', 'Intermittent 502 from docker-socket-proxy', 'Proxy occasionally drops under concurrent infra-page loads.', 'known_error', 'medium', 'medium', 'low', 'Sentinel', 'manual', null, { root_cause: 'Proxy connection cap too low.', known_error: true, workaround: 'Refresh the page; raise proxy max-conns.' }],
  ['REL-0001', 'release', 'Sentinel v0.4 — Service management module', 'Ships the ITIL section, roadmap board and changelog.', 'building', 'medium', 'medium', 'medium', 'Sentinel', 'manual', null, { version: 'v0.4.0', window: '2026-06-25', linked_changes: ['CHG-0002'] }],
  ['REL-0002', 'release', 'YT v2.1 — AI summary + full-text search', 'Feature release bundling the v2 backlog highlights.', 'planned', 'low', 'medium', 'low', 'YT', 'manual', null, { version: 'v2.1.0', window: 'Q3', linked_changes: [] }],
];

// [item_key, title, description, status, app, sort_order]
const roadmap = [
  ['RM-001', 'Service management module (ITIL)', 'Incidents/requests/changes/problems/releases + roadmap + changelog.', 'in_progress', 'Sentinel', 1],
  ['RM-002', 'Report-issue widget + ingest API', 'Estate apps POST bugs into ops.findings via HMAC endpoint.', 'backlog', 'Estate', 2],
  ['RM-003', 'Change calendar + CAB workflow', 'Calendar view for changes; approval/CAB states.', 'backlog', 'Sentinel', 3],
  ['RM-004', 'Self-hosted HA Postgres cutover', 'Move Sentinel off the dev DB to Patroni HA.', 'in_review', 'Sentinel', 4],
  ['RM-005', 'AI summary for transcripts', 'Per-video AI summary on the YT portal.', 'backlog', 'YT', 5],
  ['RM-006', 'Full-text transcript search', 'Search across all transcripts in a workspace.', 'backlog', 'YT', 6],
  ['RM-007', 'Clerk estate-level IdP', 'Re-engineer Clerk to a shared .bentech.dev identity provider.', 'in_progress', 'Estate', 7],
  ['RM-008', 'Nightly security reviews → findings', 'GitHub Actions AI reviews push into ops.findings.', 'shipped', 'Sentinel', 8],
];

// [version, label, days_ago, body, app]
const changelog = [
  ['v0.3.0', 'Nightly security reviews', 5, 'Cloud GitHub Actions AI security reviews now push findings into the portal.', 'Sentinel'],
  ['v0.2.0', 'Resilience self-tests', 18, 'Added the resilience runner (DB failover, app-replica, worker, headers, scale).', 'Sentinel'],
  ['v2.0.0', 'YT portal GA', 40, 'YT Transcriber web portal reached general availability.', 'YT'],
];

(async () => {
  const c = new Client({ connectionString: DB, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } });
  await c.connect();
  // Clean slate + push sequences past the seed range so the worker's
  // auto-assigned refs never collide with our explicit SEC-/OPS- refs.
  await c.query('truncate ops.findings, ops.tickets, ops.comments, ops.links cascade');
  await c.query("select setval('ops.finding_seq', 50, true)");
  await c.query("select setval('ops.ticket_seq', 50, true)");
  // Service-management tables (migration 02). Truncate if present so re-seeding
  // is idempotent; skip silently on an old DB without the migration applied.
  try { await c.query('truncate ops.roadmap_items, ops.changelog_entries cascade'); } catch {}
  for (const [key, name, kind] of components)
    await c.query('insert into ops.components (key,name,kind) values ($1,$2,$3) on conflict (key) do nothing', [key, name, kind]);
  for (const [ref, title, description, severity, cvss, cwe, cl, source, status] of findings)
    await c.query(
      `insert into ops.findings (ref,fingerprint,title,description,severity,cvss,cwe,component_label,source,status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (fingerprint) do update set title=excluded.title, status=excluded.status, last_seen_at=now()`,
      [ref, `${source}:${ref}`, title, description, severity, cvss, cwe, cl, source, status]
    );
  for (const [ref, title, type, status, priority, source] of tickets)
    await c.query(
      'insert into ops.tickets (ref,title,type,status,priority,source) values ($1,$2,$3,$4,$5,$6) on conflict (ref) do nothing',
      [ref, title, type, status, priority, source]
    );

  // Service-management (ITIL) records. The `kind`/`impact`/`urgency`/`app`/
  // `sla_due`/`attrs` columns require migration 02 — skip gracefully if absent.
  let svcSeeded = 0;
  try {
    for (const [ref, kind, title, description, status, priority, impact, urgency, app, source, slaHours, attrs] of serviceTickets) {
      const slaDue = slaHours == null ? null : new Date(Date.now() + slaHours * 3600 * 1000).toISOString();
      await c.query(
        `insert into ops.tickets (ref,kind,title,description,status,priority,impact,urgency,app,source,sla_due,attrs)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) on conflict (ref) do nothing`,
        [ref, kind, title, description, status, priority, impact, urgency, app, source, slaDue, JSON.stringify(attrs)]
      );
      svcSeeded++;
    }
    for (const [item_key, title, description, status, app, sort_order] of roadmap)
      await c.query(
        'insert into ops.roadmap_items (item_key,title,description,status,app,sort_order) values ($1,$2,$3,$4,$5,$6) on conflict (item_key) do nothing',
        [item_key, title, description, status, app, sort_order]
      );
    for (const [version, label, daysAgo, body, app] of changelog)
      await c.query(
        'insert into ops.changelog_entries (version,label,date,body,app) values ($1,$2,$3,$4,$5)',
        [version, label, new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString(), body, app]
      );
    console.log(`seeded service-mgmt: ${svcSeeded} ITIL tickets, ${roadmap.length} roadmap items, ${changelog.length} changelog entries`);
  } catch (e) {
    console.log(`service-mgmt seed skipped (migration 02 not applied?): ${e.message}`);
  }

  console.log(`seeded: ${components.length} components, ${findings.length} findings, ${tickets.length} tickets`);

  // Pre-configure the Supabase connector from .env.local (dev convenience).
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const existing = await c.query("select id from public.connectors where type='supabase' limit 1");
    const config = JSON.stringify({ url: env.NEXT_PUBLIC_SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY });
    if (existing.rows.length === 0) {
      await c.query("insert into public.connectors (name,type,config,enabled,status) values ('Supabase (YT Transcriber)','supabase',$1::jsonb,true,'configured')", [config]);
      console.log('connector: supabase configured from .env.local');
    } else {
      console.log('connector: supabase already exists (left as-is)');
    }
  } else {
    console.log('connector: no Supabase creds in .env.local — configure via the Connectors page');
  }
  await c.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
