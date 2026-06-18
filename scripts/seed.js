// Seeds ops.components / ops.findings / ops.tickets with the review data.
// Idempotent (upsert on natural keys). Run: node scripts/seed.js
const fs = require('fs'); const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
for (const l of env.split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ops = sb.schema('ops');

const components = [
  { key: 'app', name: 'YT Transcriber App', kind: 'service' },
  { key: 'nginx', name: 'nginx HA', kind: 'infra' },
  { key: 'redis', name: 'Redis', kind: 'infra' },
  { key: 'api/admin', name: 'Admin API', kind: 'route' },
  { key: 'api/videos', name: 'Videos API', kind: 'route' },
];

const findings = [
  { ref: 'SEC-0009', title: 'Raw Docker socket exposed to app container', description: 'App can reach the Docker daemon — container escape risk', severity: 'critical', cvss: 9.1, cwe: 'CWE-668', component_label: 'swarm / app', source: 'access-audit', status: 'in_progress' },
  { ref: 'SEC-0008', title: 'Service-role key reachable from edge route', description: 'Supabase service key importable in a client-adjacent path', severity: 'critical', cvss: 8.6, cwe: 'CWE-200', component_label: 'api/admin', source: 'gitleaks', status: 'open' },
  { ref: 'SEC-0007', title: 'No rate limit on /api/videos submit', description: 'Unauthenticated abuse / quota-bypass vector', severity: 'high', cvss: 7.4, cwe: 'CWE-770', component_label: 'api/videos', source: 'access-audit', status: 'open' },
  { ref: 'SEC-0006', title: 'Share links lack expiry enforcement', description: 'expires_at stored but never checked on access', severity: 'high', cvss: 7.1, cwe: 'CWE-613', component_label: 'api/share', source: 'access-audit', status: 'in_progress' },
  { ref: 'SEC-0005', title: 'Admin routes missing CSRF protection', description: 'State-changing POSTs accept cross-origin form posts', severity: 'high', cvss: 6.8, cwe: 'CWE-352', component_label: 'api/admin', source: 'access-audit', status: 'open' },
  { ref: 'SEC-0004', title: 'Missing CSP + HSTS headers at origin', description: 'nginx returns no security headers', severity: 'medium', cvss: 5.3, cwe: 'CWE-693', component_label: 'nginx', source: 'headers', status: 'open' },
  { ref: 'SEC-0003', title: 'Outdated dependency: next advisory', description: '1 moderate advisory in a transitive dep', severity: 'medium', cvss: 5.0, cwe: 'CWE-1104', component_label: 'package.json', source: 'npm-audit', status: 'open' },
  { ref: 'SEC-0002', title: 'Container memory at 91% of limit', description: 'app replica sustained >85% mem for 20m', severity: 'medium', cvss: null, cwe: null, component_label: 'swarm / app', source: 'capacity', status: 'open' },
  { ref: 'SEC-0001', title: 'Verbose error stack returned on 500', description: 'Stack traces leaked to client in prod', severity: 'low', cvss: 3.1, cwe: 'CWE-209', component_label: 'app', source: 'access-audit', status: 'fixed' },
].map((f) => ({ ...f, fingerprint: `${f.source}:${f.ref}` }));

const tickets = [
  { ref: 'OPS-0007', title: 'Harden Docker socket via read-only proxy', type: 'security', status: 'in_progress', priority: 'critical', source: 'finding' },
  { ref: 'OPS-0006', title: 'Add rate limiting to public submit endpoints', type: 'security', status: 'open', priority: 'high', source: 'manual' },
  { ref: 'OPS-0005', title: 'Enforce share-link expiry on access', type: 'security', status: 'in_progress', priority: 'high', source: 'finding' },
  { ref: 'OPS-0004', title: 'Roll out CSP + HSTS at nginx', type: 'infra', status: 'open', priority: 'medium', source: 'finding' },
  { ref: 'OPS-0003', title: 'Investigate app memory pressure', type: 'infra', status: 'blocked', priority: 'medium', source: 'alert' },
  { ref: 'OPS-0001', title: 'Suppress verbose 500 stack traces', type: 'security', status: 'resolved', priority: 'low', source: 'finding' },
];

(async () => {
  const c = await ops.from('components').upsert(components, { onConflict: 'key' });
  console.log('components:', c.error ? 'ERR ' + c.error.message : 'ok ' + components.length);
  const f = await ops.from('findings').upsert(findings, { onConflict: 'fingerprint' });
  console.log('findings:', f.error ? 'ERR ' + f.error.message : 'ok ' + findings.length);
  const t = await ops.from('tickets').upsert(tickets, { onConflict: 'ref' });
  console.log('tickets:', t.error ? 'ERR ' + t.error.message : 'ok ' + tickets.length);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
