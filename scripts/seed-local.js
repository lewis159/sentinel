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

(async () => {
  const c = new Client({ connectionString: DB, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } });
  await c.connect();
  // Clean slate + push sequences past the seed range so the worker's
  // auto-assigned refs never collide with our explicit SEC-/OPS- refs.
  await c.query('truncate ops.findings, ops.tickets, ops.comments, ops.links cascade');
  await c.query("select setval('ops.finding_seq', 50, true)");
  await c.query("select setval('ops.ticket_seq', 50, true)");
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
