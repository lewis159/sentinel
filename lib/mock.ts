// Mock data for the Sentinel UI prototype. No backend — purely to drive the
// rough page layouts so the end-to-end flow is navigable.

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export const sevClass: Record<Severity, string> = {
  critical: 'sev-crit', high: 'sev-high', medium: 'sev-med', low: 'sev-low', info: 'sev-info',
};
export const sevLabel: Record<Severity, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info',
};

export type Finding = {
  ref: string; title: string; desc: string; severity: Severity; cvss: number; cwe: string;
  component: string; source: string; status: string; age: string; ticket?: string;
};

export const findings: Finding[] = [
  { ref: 'SEC-0009', title: 'Raw Docker socket exposed to app container', desc: 'App can reach the Docker daemon — container escape risk', severity: 'critical', cvss: 9.1, cwe: 'CWE-668', component: 'swarm / app', source: 'access-audit', status: 'in_progress', age: '2d', ticket: 'OPS-0007' },
  { ref: 'SEC-0008', title: 'Service-role key reachable from edge route', desc: 'Supabase service key importable in a client-adjacent path', severity: 'critical', cvss: 8.6, cwe: 'CWE-200', component: 'api/admin', source: 'gitleaks', status: 'open', age: '5h' },
  { ref: 'SEC-0007', title: 'No rate limit on /api/videos submit', desc: 'Unauthenticated abuse / quota-bypass vector', severity: 'high', cvss: 7.4, cwe: 'CWE-770', component: 'api/videos', source: 'access-audit', status: 'open', age: '1d' },
  { ref: 'SEC-0006', title: 'Share links lack expiry enforcement', desc: 'expires_at stored but never checked on access', severity: 'high', cvss: 7.1, cwe: 'CWE-613', component: 'api/share', source: 'access-audit', status: 'in_progress', age: '3d', ticket: 'OPS-0005' },
  { ref: 'SEC-0005', title: 'Admin routes missing CSRF protection', desc: 'State-changing POSTs accept cross-origin form posts', severity: 'high', cvss: 6.8, cwe: 'CWE-352', component: 'api/admin', source: 'access-audit', status: 'open', age: '4d' },
  { ref: 'SEC-0004', title: 'Missing CSP + HSTS headers at origin', desc: 'nginx returns no security headers', severity: 'medium', cvss: 5.3, cwe: 'CWE-693', component: 'nginx', source: 'headers', status: 'open', age: '2d' },
  { ref: 'SEC-0003', title: 'Outdated dependency: next@15.0.1 (advisory)', desc: '1 moderate advisory in a transitive dep', severity: 'medium', cvss: 5.0, cwe: 'CWE-1104', component: 'package.json', source: 'npm-audit', status: 'open', age: '14m' },
  { ref: 'SEC-0002', title: 'Container memory at 91% of limit', desc: 'app replica sustained >85% mem for 20m', severity: 'medium', cvss: 0, cwe: '', component: 'swarm / app', source: 'capacity', status: 'open', age: '1h' },
  { ref: 'SEC-0001', title: 'Verbose error stack returned on 500', desc: 'Stack traces leaked to client in prod', severity: 'low', cvss: 3.1, cwe: 'CWE-209', component: 'app', source: 'access-audit', status: 'fixed', age: '1d' },
];

export const sevCounts = { critical: 2, high: 3, medium: 3, low: 1, info: 0 };

export type Ticket = {
  ref: string; title: string; type: string; status: string; priority: Severity;
  assignee: string; source: string; age: string; finding?: string;
};

export const tickets: Ticket[] = [
  { ref: 'OPS-0007', title: 'Harden Docker socket via read-only proxy', type: 'security', status: 'in_progress', priority: 'critical', assignee: 'ben', source: 'finding', age: '2d', finding: 'SEC-0009' },
  { ref: 'OPS-0006', title: 'Add rate limiting to public submit endpoints', type: 'security', status: 'open', priority: 'high', assignee: '—', source: 'manual', age: '1d' },
  { ref: 'OPS-0005', title: 'Enforce share-link expiry on access', type: 'security', status: 'in_progress', priority: 'high', assignee: 'ben', source: 'finding', age: '3d', finding: 'SEC-0006' },
  { ref: 'OPS-0004', title: 'Roll out CSP + HSTS at nginx', type: 'infra', status: 'open', priority: 'medium', assignee: '—', source: 'finding', age: '2d' },
  { ref: 'OPS-0003', title: 'Investigate app memory pressure', type: 'infra', status: 'blocked', priority: 'medium', assignee: 'ben', source: 'alert', age: '1h' },
  { ref: 'OPS-0002', title: 'Q2 access review', type: 'task', status: 'open', priority: 'low', assignee: 'ben', source: 'manual', age: '6d' },
  { ref: 'OPS-0001', title: 'Suppress verbose 500 stack traces', type: 'security', status: 'resolved', priority: 'low', assignee: 'ben', source: 'finding', age: '1d' },
];

export type Check = {
  key: string; name: string; type: 'security' | 'ops'; schedule: string; lastRun: string;
  status: 'pass' | 'issues' | 'failed'; findings: number; source: string;
};

export const checks: Check[] = [
  { key: 'npm-audit', name: 'Dependency audit', type: 'security', schedule: 'on push + nightly', lastRun: '14m ago', status: 'issues', findings: 1, source: 'npm-audit' },
  { key: 'gitleaks', name: 'Secret scan', type: 'security', schedule: 'on push', lastRun: '14m ago', status: 'issues', findings: 1, source: 'gitleaks' },
  { key: 'trivy', name: 'Image / container CVE', type: 'security', schedule: 'on build', lastRun: '2h ago', status: 'pass', findings: 0, source: 'trivy' },
  { key: 'headers', name: 'HTTP headers / TLS', type: 'security', schedule: 'every 6h', lastRun: '3h ago', status: 'issues', findings: 1, source: 'headers' },
  { key: 'access-audit', name: 'Access / auth audit', type: 'security', schedule: 'daily', lastRun: '1d ago', status: 'issues', findings: 5, source: 'access-audit' },
  { key: 'abuse', name: 'Abuse / multi-account', type: 'security', schedule: 'hourly', lastRun: '8m ago', status: 'issues', findings: 7, source: 'abuse' },
  { key: 'capacity', name: 'Container capacity', type: 'ops', schedule: 'every 60s', lastRun: '40s ago', status: 'issues', findings: 1, source: 'capacity' },
  { key: 'uptime', name: 'Uptime', type: 'ops', schedule: 'every 30s', lastRun: '20s ago', status: 'pass', findings: 0, source: 'uptime' },
];

export const scanRuns = [
  { id: '1042', type: 'Dependency audit (npm)', findings: '3 new', when: '14 min ago', status: 'complete', duration: '38s' },
  { id: '1041', type: 'Secret scan (gitleaks)', findings: '0 issues', when: '14 min ago', status: 'complete', duration: '12s' },
  { id: '1040', type: 'Header / TLS check', findings: '2 issues', when: '6 hours ago', status: 'complete', duration: '5s' },
  { id: '1039', type: 'Auth / access audit', findings: '1 critical', when: '1 day ago', status: 'complete', duration: '1m 04s' },
  { id: '1038', type: 'Image CVE (Trivy)', findings: 'failed', when: '1 day ago', status: 'failed', duration: '—' },
];

export type Container = {
  name: string; component: string; state: string; cpu: number; mem: number; memLimit: number; restarts: number; node: string;
};
export const containers: Container[] = [
  { name: 'yt_app.1', component: 'app', state: 'running', cpu: 24, mem: 466, memLimit: 512, restarts: 0, node: 'node-1' },
  { name: 'yt_app.2', component: 'app', state: 'running', cpu: 18, mem: 312, memLimit: 512, restarts: 1, node: 'node-2' },
  { name: 'yt_redis.1', component: 'redis', state: 'running', cpu: 3, mem: 41, memLimit: 128, restarts: 0, node: 'node-1' },
  { name: 'docker-socket-proxy.1', component: 'proxy', state: 'running', cpu: 1, mem: 12, memLimit: 64, restarts: 0, node: 'node-1' },
];

export const components = [
  { key: 'app', name: 'YT Transcriber App', kind: 'service', findings: 4, containers: 2 },
  { key: 'nginx', name: 'nginx HA', kind: 'infra', findings: 1, containers: 1 },
  { key: 'redis', name: 'Redis', kind: 'infra', findings: 0, containers: 1 },
  { key: 'api/admin', name: 'Admin API', kind: 'route', findings: 2, containers: 0 },
  { key: 'api/videos', name: 'Videos API', kind: 'route', findings: 1, containers: 0 },
];

export type AbuseUser = {
  id: string; name: string; email: string; tier: string; risk: number; signals: string[]; lastSeen: string;
};
export const users: AbuseUser[] = [
  { id: 'u1', name: 'james.m***', email: 'jm.4471@tempmail.io', tier: 'Starter', risk: 92, signals: ['Shared device · 4 accts', 'Disposable email'], lastSeen: '8 min ago' },
  { id: 'u2', name: 'a.kowalski', email: 'akow***@gmail.com', tier: 'Starter', risk: 74, signals: ['Velocity · 5 signups/IP', 'Same card fingerprint'], lastSeen: '31 min ago' },
  { id: 'u3', name: 'rosa.s', email: 'rosa.s***@proton.me', tier: 'Pro', risk: 61, signals: ['Shared device · 2 accts'], lastSeen: '2 h ago' },
  { id: 'u4', name: 'tn.builds', email: 'tn***@outlook.com', tier: 'Starter', risk: 48, signals: ['New IP region', 'Velocity'], lastSeen: '5 h ago' },
  { id: 'u5', name: 'd.patel', email: 'dpatel***@gmail.com', tier: 'Studio', risk: 18, signals: [], lastSeen: '1 d ago' },
];

export const alerts = [
  { id: 'a1', severity: 'high' as Severity, message: 'New critical finding SEC-0008 (secret scan)', rule: 'High-sev findings', status: 'firing', when: '5h ago' },
  { id: 'a2', severity: 'medium' as Severity, message: 'app replica memory > 85% for 20m', rule: 'Capacity pressure', status: 'firing', when: '1h ago' },
  { id: 'a3', severity: 'high' as Severity, message: '3 device fingerprints linked to multiple free accounts', rule: 'Abuse cluster', status: 'acknowledged', when: '3h ago' },
  { id: 'a4', severity: 'low' as Severity, message: 'Finding SEC-0001 auto-resolved', rule: 'Auto-close', status: 'resolved', when: '1d ago' },
];

export const rules = [
  { id: 'r1', name: 'Escalate unowned high+ findings', enabled: true, trigger: 'severity ≥ high AND unassigned > 24h', action: 'notify · escalate' },
  { id: 'r2', name: 'Capacity pressure → ticket', enabled: true, trigger: 'mem% > 0.85 for 5m', action: 'alert · raise ticket' },
  { id: 'r3', name: 'New critical → page', enabled: true, trigger: 'finding.created severity = critical', action: 'notify slack · email' },
  { id: 'r4', name: 'Abuse cluster digest', enabled: false, trigger: 'abuse cluster ≥ 3 accounts', action: 'notify · raise ticket' },
];

export const kbArticles = [
  { slug: 'docker-socket-proxy', title: 'Hardening the Docker socket with a read-only proxy', cat: 'Runbook', updated: '2d ago' },
  { slug: 'incident-response', title: 'Incident response checklist', cat: 'Process', updated: '1w ago' },
  { slug: 'rate-limiting', title: 'Adding rate limits to public endpoints', cat: 'Runbook', updated: '3d ago' },
  { slug: 'security-headers', title: 'CSP + HSTS at the nginx origin', cat: 'Runbook', updated: '5d ago' },
  { slug: 'abuse-signals', title: 'How multi-account detection works', cat: 'Reference', updated: '1w ago' },
];

export const activity = [
  { icon: '✓', text: 'Finding SEC-0009 moved to In progress by ben', when: '12 min ago' },
  { icon: '⟳', text: 'Automated scan suite completed — 3 new findings', when: '14 min ago' },
  { icon: '⚑', text: 'Anti-abuse flagged 2 accounts sharing a device fingerprint', when: '3h ago' },
  { icon: '🎫', text: 'Ticket OPS-0005 commented by ben', when: '5h ago' },
  { icon: '✓', text: 'Finding SEC-0001 marked Fixed', when: '1d ago' },
];

// ---------- Service management (ITIL) ----------
// The unified ITIL record (ops.tickets extended). `kind` is the practice.
export type TicketKind = 'incident' | 'request' | 'change' | 'problem' | 'release';
export type EstateApp = 'YT' | 'Sentinel' | 'Bruce' | 'Estate';

export const KIND_LABEL: Record<TicketKind, string> = {
  incident: 'Incident', request: 'Request', change: 'Change', problem: 'Problem', release: 'Release',
};
// Per-kind workflow status columns (used by the Kanban board grouping).
export const KIND_STATUSES: Record<TicketKind, string[]> = {
  incident: ['open', 'in_progress', 'resolved', 'closed'],
  request: ['open', 'in_progress', 'fulfilled', 'closed'],
  change: ['draft', 'awaiting_cab', 'approved', 'scheduled', 'implemented', 'closed'],
  problem: ['open', 'investigating', 'known_error', 'resolved'],
  release: ['planned', 'building', 'staged', 'deployed', 'verified'],
};

export const APP_LABEL: Record<EstateApp, string> = {
  YT: 'YT Transcriber', Sentinel: 'Sentinel', Bruce: 'Springsteen', Estate: 'Estate',
};

export type ServiceTicket = {
  ref: string; kind: TicketKind; title: string; description: string;
  status: string; priority: Severity; impact: string; urgency: string;
  app: EstateApp | string; assignee: string; source: string;
  slaDue: string | null; age: string;
  // P3 — when the assignee was set (first-class ops.tickets.assigned_at). Optional
  // so existing rows/mocks that predate assignment stay valid.
  assignedAt?: string | null;
  // P2 multi-tenancy — the tenant (Clerk org id) + customer contact this ticket
  // belongs to. Null on internal/estate tickets. Read-through from attrs when a
  // column is unset (see lib/data.ts mapServiceTicket).
  tenantRef: string | null; customerEmail: string | null; customerName: string | null;
  attrs: Record<string, any>;
};

// Mock ITIL records — a handful per kind so sections render without a DB.
export const serviceTickets: ServiceTicket[] = [
  { ref: 'INC-0001', kind: 'incident', title: 'Transcription queue backed up — jobs stalled', description: 'Worker pool stopped draining the queue; users see "processing" indefinitely.', status: 'in_progress', priority: 'critical', impact: 'high', urgency: 'high', app: 'YT', assignee: 'ben', source: 'alert', slaDue: new Date(Date.now() + 3 * 3600 * 1000).toISOString(), age: '2h', tenantRef: null, customerEmail: null, customerName: null, attrs:{} },
  { ref: 'INC-0002', kind: 'incident', title: 'Sentinel infra page failing to load container stats', description: 'docker-socket-proxy returned 502 for ~10 minutes.', status: 'resolved', priority: 'medium', impact: 'medium', urgency: 'low', app: 'Sentinel', assignee: 'ben', source: 'manual', slaDue: null, age: '1d', tenantRef: null, customerEmail: null, customerName: null, attrs:{} },
  { ref: 'INC-0003', kind: 'incident', title: 'Memory pressure on app replica', description: 'app replica sustained >85% mem for 20m.', status: 'open', priority: 'medium', impact: 'medium', urgency: 'medium', app: 'YT', assignee: '—', source: 'alert', slaDue: new Date(Date.now() + 20 * 3600 * 1000).toISOString(), age: '1h', tenantRef: null, customerEmail: null, customerName: null, attrs:{} },

  { ref: 'REQ-0001', kind: 'request', title: 'Provision Studio tier for new org', description: 'Onboarding request for a Studio-tier workspace.', status: 'open', priority: 'low', impact: 'low', urgency: 'low', app: 'YT', assignee: '—', source: 'manual', slaDue: null, age: '4h', tenantRef: null, customerEmail: null, customerName: null, attrs:{} },
  { ref: 'REQ-0002', kind: 'request', title: 'Add team member to Sentinel global-admin', description: 'Access request — approval pending.', status: 'in_progress', priority: 'medium', impact: 'low', urgency: 'medium', app: 'Sentinel', assignee: 'ben', source: 'manual', slaDue: null, age: '2d', tenantRef: null, customerEmail: null, customerName: null, attrs:{} },

  { ref: 'CHG-0001', kind: 'change', title: 'Roll out CSP + HSTS at nginx origin', description: 'Normal change — add security headers across all estate apps.', status: 'awaiting_cab', priority: 'medium', impact: 'medium', urgency: 'low', app: 'Estate', assignee: 'ben', source: 'finding', slaDue: null, age: '3d', tenantRef: null, customerEmail: null, customerName: null, attrs:{ risk: 'medium', cab_status: 'pending', window: '2026-06-22 02:00 UTC', backout: 'Revert nginx config block; reload.', change_type: 'normal' } },
  { ref: 'CHG-0002', kind: 'change', title: 'Migrate Sentinel DB to self-hosted HA Postgres', description: 'Major change — Patroni + etcd + HAProxy cutover.', status: 'draft', priority: 'high', impact: 'high', urgency: 'medium', app: 'Sentinel', assignee: 'ben', source: 'manual', slaDue: null, age: '5d', tenantRef: null, customerEmail: null, customerName: null, attrs:{ risk: 'high', cab_status: 'not_submitted', window: 'TBD', backout: 'Repoint DATABASE_URL to old instance.', change_type: 'normal' } },
  { ref: 'CHG-0003', kind: 'change', title: 'Emergency: rotate leaked service-role key', description: 'Standard/emergency change to rotate the Supabase service key.', status: 'implemented', priority: 'critical', impact: 'high', urgency: 'high', app: 'YT', assignee: 'ben', source: 'finding', slaDue: null, age: '6d', tenantRef: null, customerEmail: null, customerName: null, attrs:{ risk: 'high', cab_status: 'approved', window: 'immediate', backout: 'N/A — key rotation.', change_type: 'emergency' } },

  { ref: 'PRB-0001', kind: 'problem', title: 'Recurring queue stalls under burst load', description: 'Multiple incidents trace to the same worker lock contention.', status: 'investigating', priority: 'high', impact: 'high', urgency: 'medium', app: 'YT', assignee: 'ben', source: 'manual', slaDue: null, age: '3d', tenantRef: null, customerEmail: null, customerName: null, attrs:{ root_cause: 'Single advisory lock held across long transcribe job.', known_error: false, workaround: 'Manually restart worker pool when depth > 200.' } },
  { ref: 'PRB-0002', kind: 'problem', title: 'Intermittent 502 from docker-socket-proxy', description: 'Proxy occasionally drops under concurrent infra-page loads.', status: 'known_error', priority: 'medium', impact: 'medium', urgency: 'low', app: 'Sentinel', assignee: '—', source: 'manual', slaDue: null, age: '8d', tenantRef: null, customerEmail: null, customerName: null, attrs:{ root_cause: 'Proxy connection cap too low.', known_error: true, workaround: 'Refresh the page; raise proxy max-conns.' } },

  { ref: 'REL-0001', kind: 'release', title: 'Sentinel v0.4 — Service management module', description: 'Ships the ITIL section, roadmap board and changelog.', status: 'building', priority: 'medium', impact: 'medium', urgency: 'medium', app: 'Sentinel', assignee: 'ben', source: 'manual', slaDue: null, age: '1d', tenantRef: null, customerEmail: null, customerName: null, attrs:{ version: 'v0.4.0', window: '2026-06-25', linked_changes: ['CHG-0002'] } },
  { ref: 'REL-0002', kind: 'release', title: 'YT v2.1 — AI summary + full-text search', description: 'Feature release bundling the v2 backlog highlights.', status: 'planned', priority: 'low', impact: 'medium', urgency: 'low', app: 'YT', assignee: '—', source: 'manual', slaDue: null, age: '2d', tenantRef: null, customerEmail: null, customerName: null, attrs:{ version: 'v2.1.0', window: 'Q3', linked_changes: [] } },
];

export type RoadmapItem = {
  itemKey: string; title: string; description: string;
  status: string; app: EstateApp | string; sortOrder: number;
};
export const ROADMAP_STATUSES = ['backlog', 'in_progress', 'in_review', 'shipped'];
export const ROADMAP_STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog', in_progress: 'In progress', in_review: 'In review', shipped: 'Shipped',
};

export const roadmapItems: RoadmapItem[] = [
  { itemKey: 'RM-001', title: 'Service management module (ITIL)', description: 'Incidents/requests/changes/problems/releases + roadmap + changelog.', status: 'in_progress', app: 'Sentinel', sortOrder: 1 },
  { itemKey: 'RM-002', title: 'Report-issue widget + ingest API', description: 'Estate apps POST bugs into ops.findings via HMAC endpoint.', status: 'backlog', app: 'Estate', sortOrder: 2 },
  { itemKey: 'RM-003', title: 'Change calendar + CAB workflow', description: 'Calendar view for changes; approval/CAB states.', status: 'backlog', app: 'Sentinel', sortOrder: 3 },
  { itemKey: 'RM-004', title: 'Self-hosted HA Postgres cutover', description: 'Move Sentinel off the dev DB to Patroni HA.', status: 'in_review', app: 'Sentinel', sortOrder: 4 },
  { itemKey: 'RM-005', title: 'AI summary for transcripts', description: 'Per-video AI summary on the YT portal.', status: 'backlog', app: 'YT', sortOrder: 5 },
  { itemKey: 'RM-006', title: 'Full-text transcript search', description: 'Search across all transcripts in a workspace.', status: 'backlog', app: 'YT', sortOrder: 6 },
  { itemKey: 'RM-007', title: 'Clerk estate-level IdP', description: 'Re-engineer Clerk to a shared .bentech.dev identity provider.', status: 'in_progress', app: 'Estate', sortOrder: 7 },
  { itemKey: 'RM-008', title: 'Nightly security reviews → findings', description: 'GitHub Actions AI reviews push into ops.findings.', status: 'shipped', app: 'Sentinel', sortOrder: 8 },
];

export type ChangelogEntry = {
  version: string; label: string; date: string; body: string; app: EstateApp | string;
};
export const changelogEntries: ChangelogEntry[] = [
  { version: 'v0.3.0', label: 'Nightly security reviews', date: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(), body: 'Cloud GitHub Actions AI security reviews now push findings into the portal.', app: 'Sentinel' },
  { version: 'v0.2.0', label: 'Resilience self-tests', date: new Date(Date.now() - 18 * 24 * 3600 * 1000).toISOString(), body: 'Added the resilience runner (DB failover, app-replica, worker, headers, scale).', app: 'Sentinel' },
  { version: 'v2.0.0', label: 'YT portal GA', date: new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString(), body: 'YT Transcriber web portal reached general availability.', app: 'YT' },
];

// Graph neighbours used by the LinksPanel on detail pages.
export const findingLinks: Record<string, { rel: string; type: string; id: string; label: string; href: string }[]> = {
  'SEC-0009': [
    { rel: 'raises', type: 'ticket', id: 'OPS-0007', label: 'Harden Docker socket via read-only proxy', href: '/tickets/OPS-0007' },
    { rel: 'about', type: 'component', id: 'app', label: 'YT Transcriber App', href: '/components/app' },
    { rel: 'documents', type: 'kb', id: 'docker-socket-proxy', label: 'Hardening the Docker socket', href: '/kb/docker-socket-proxy' },
    { rel: 'found-by', type: 'scan', id: '1039', label: 'Auth / access audit run #1039', href: '/scans/runs/1039' },
  ],
};
