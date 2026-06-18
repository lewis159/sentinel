'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const DOCKER_HOST = process.env.DOCKER_HOST;

// This worker identifies itself so claimed jobs can be traced to a replica.
const WORKER_ID = process.env.HOSTNAME || ('w-' + process.pid);

const SCHEDULER_INTERVAL_MS = 30 * 1000; // enqueue periodic jobs
const CLAIM_INTERVAL_MS = 3 * 1000;      // poll the queue
const MAX_ATTEMPTS = 3;                   // retries before giving up
const BACKOFF_MS = 30 * 1000;             // requeue delay on retryable failure

// Periodic jobs the scheduler keeps topped up. Each type has at most one
// pending row at a time (enforced by the partial unique index).
const PERIODIC_JOBS = ['snapshot-collect', 'capacity-scan', 'headers-scan', 'seed-rules', 'rules-eval', 'ai-triage'];

// Jobs whose worker died mid-run leave a 'running' row that the partial unique
// index treats as pending, blocking re-enqueue. Requeue ones stuck this long.
const STALE_LOCK_INTERVAL = '5 minutes';

// Target for the headers-scan security check. Defaults to the local stack LB.
const SCAN_TARGET_URL = process.env.SCAN_TARGET_URL || 'http://nginx-lb:3000';

// Security headers we expect; absence becomes an open finding.
const SECURITY_HEADERS = [
  'Content-Security-Policy',
  'Strict-Transport-Security',
  'X-Frame-Options',
  'X-Content-Type-Options',
  'Referrer-Policy',
];

if (!DATABASE_URL) {
  console.error('[sentinel-worker] Missing DATABASE_URL — cannot run.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false }, // Patroni/Spilo TLS (self-signed)
});

function log(msg) {
  console.log(`[sentinel-worker ${WORKER_ID}] ${new Date().toISOString()} ${msg}`);
}
function errlog(msg) {
  console.error(`[sentinel-worker ${WORKER_ID}] ${new Date().toISOString()} ${msg}`);
}

/**
 * Parse a tcp://host:port DOCKER_HOST into { host, port } for Node http.
 */
function parseDockerHost(dockerHost) {
  // e.g. tcp://docker-socket-proxy:2375
  const m = /^tcp:\/\/([^:/]+):(\d+)/.exec(dockerHost);
  if (!m) return null;
  return { host: m[1], port: parseInt(m[2], 10) };
}

/**
 * GET the Docker containers list (all=true) via the socket proxy.
 */
function fetchContainers(target) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: target.host,
        port: target.port,
        path: '/v1.44/containers/json?all=true',
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Docker API HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Failed to parse Docker API response: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Docker API request timed out')));
    req.end();
  });
}

// --- Job handlers ----------------------------------------------------------

/**
 * snapshot-collect: pull container list from the socket proxy and insert
 * one row per container into ops.container_snapshots. No-op (not a failure)
 * when DOCKER_HOST is unset so the worker keeps draining the queue.
 */
async function handleSnapshotCollect() {
  if (!DOCKER_HOST) {
    log('snapshot-collect: DOCKER_HOST unset — no-op.');
    return;
  }
  const target = parseDockerHost(DOCKER_HOST);
  if (!target) {
    throw new Error(`Could not parse DOCKER_HOST="${DOCKER_HOST}" (expected tcp://host:port)`);
  }

  const containers = await fetchContainers(target);
  let inserted = 0;
  for (const c of containers) {
    const containerName = (c.Names && c.Names[0] ? c.Names[0] : '').replace(/^\//, '');
    await pool.query(
      'INSERT INTO ops.container_snapshots (container_name, state, restarts, raw) VALUES ($1, $2, $3, $4)',
      [containerName, c.State, c.RestartCount ?? 0, JSON.stringify(c)]
    );
    inserted += 1;
  }
  log(`snapshot-collect: containers=${containers.length} inserted=${inserted}`);
}

/**
 * capacity-scan: upsert the capacity:fleet finding reflecting running count.
 */
async function handleCapacityScan() {
  if (!DOCKER_HOST) {
    log('capacity-scan: DOCKER_HOST unset — no-op.');
    return;
  }
  const target = parseDockerHost(DOCKER_HOST);
  if (!target) {
    throw new Error(`Could not parse DOCKER_HOST="${DOCKER_HOST}" (expected tcp://host:port)`);
  }

  const containers = await fetchContainers(target);
  const runningCount = containers.filter((c) => c.State === 'running').length;

  const title = `${runningCount} containers monitored`;
  const description = `Worker capacity scan observed ${runningCount} running containers`;

  await pool.query(
    `INSERT INTO ops.findings (fingerprint, title, description, severity, source, status, component_label)
     VALUES ('capacity:fleet', $1, $2, 'info', 'worker', 'open', 'swarm')
     ON CONFLICT (fingerprint)
     DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, last_seen_at = now()`,
    [title, description]
  );
  log(`capacity-scan: running=${runningCount}`);
}

/**
 * GET a URL with Node's http/https and resolve its response headers. Rejects on
 * network error or timeout. Does not follow redirects (we only want headers).
 */
function fetchHeaders(targetUrl) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(targetUrl);
    } catch (e) {
      reject(new Error(`Invalid SCAN_TARGET_URL "${targetUrl}": ${e.message}`));
      return;
    }
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        host: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: { Accept: '*/*' },
      },
      (res) => {
        // Drain the body so the socket frees up; we only need headers.
        res.resume();
        resolve({ statusCode: res.statusCode, headers: res.headers, host: u.host });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('headers-scan request timed out')));
    req.end();
  });
}

/**
 * headers-scan: GET a target URL and check security headers. Each missing header
 * upserts an open finding; each present header self-heals a matching auto-managed
 * finding to 'fixed'. Network/DB errors are caught so the claim loop survives an
 * unreachable target — the job still finishes successfully.
 */
async function handleHeadersScan() {
  let result;
  try {
    result = await fetchHeaders(SCAN_TARGET_URL);
  } catch (err) {
    log(`headers-scan: target ${SCAN_TARGET_URL} unreachable — ${err.message}`);
    return;
  }

  const host = result.host;
  // Node lowercases response header names.
  const present = result.headers || {};
  let missing = 0;
  let upserted = 0;

  for (const name of SECURITY_HEADERS) {
    const fingerprint = `headers:${host}:${name}`;
    const has = Object.prototype.hasOwnProperty.call(present, name.toLowerCase());
    try {
      if (!has) {
        missing += 1;
        const title = `Missing security header: ${name}`;
        const description = `Response from ${SCAN_TARGET_URL} is missing the ${name} security header.`;
        await pool.query(
          `INSERT INTO ops.findings (fingerprint, title, description, severity, cwe, component_label, source, status)
           VALUES ($1, $2, $3, 'medium', 'CWE-693', 'nginx', 'headers', 'open')
           ON CONFLICT (fingerprint)
           DO UPDATE SET last_seen_at = now(),
                         status = CASE WHEN ops.findings.override_locked THEN ops.findings.status ELSE 'open' END`,
          [fingerprint, title, description]
        );
        upserted += 1;
      } else {
        // Present now: self-heal a prior auto-managed finding.
        await pool.query(
          `UPDATE ops.findings
              SET status='fixed', resolved_at=now()
            WHERE fingerprint=$1 AND auto_managed AND NOT override_locked`,
          [fingerprint]
        );
      }
    } catch (err) {
      errlog(`headers-scan: finding upsert failed for ${fingerprint}: ${err.message}`);
    }
  }

  log(`headers-scan: target=${SCAN_TARGET_URL} missing=${missing} upserted=${upserted}`);
}

/**
 * Minimal dependency-free HTTP request returning the response body as a string.
 * Resolves on any HTTP status; rejects only on network error / timeout. Accepts
 * { method, url, headers, body, timeoutMs }.
 */
function httpRequest({ method, url, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      reject(new Error(`Invalid URL "${url}": ${e.message}`));
      return;
    }
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        host: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: method || 'GET',
        headers: headers || {},
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs || 8000, () => req.destroy(new Error('request timed out')));
    if (body) req.write(body);
    req.end();
  });
}

/**
 * notify: fan an alert out to configured slack/telegram connectors. Errors are
 * swallowed (never throws). If no channels are configured, logs once.
 */
async function notify(severity, message) {
  let connectors;
  try {
    const res = await pool.query(
      `SELECT type, config FROM public.connectors
        WHERE enabled = true AND type IN ('slack', 'telegram')`
    );
    connectors = res.rows;
  } catch (err) {
    errlog(`notify: failed to load connectors: ${err.message}`);
    return;
  }

  if (!connectors || connectors.length === 0) {
    log('notify: no channels configured');
    return;
  }

  for (const c of connectors) {
    const cfg = c.config || {};
    try {
      if (c.type === 'slack' && cfg.webhook) {
        const payload = JSON.stringify({ text: `[${severity}] ${message}` });
        await httpRequest({
          method: 'POST',
          url: cfg.webhook,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          body: payload,
          timeoutMs: 8000,
        });
      } else if (c.type === 'telegram' && cfg.botToken && cfg.chatId) {
        const payload = JSON.stringify({ chat_id: cfg.chatId, text: `[${severity}] ${message}` });
        await httpRequest({
          method: 'POST',
          url: `https://api.telegram.org/bot${cfg.botToken}/sendMessage`,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          body: payload,
          timeoutMs: 8000,
        });
      }
    } catch (err) {
      errlog(`notify: ${c.type} delivery failed: ${err.message}`);
    }
  }
}

/**
 * seed-rules: insert 3 default rules iff ops.rules is currently empty. Idempotent
 * via NOT EXISTS guard, so repeated periodic runs are no-ops once seeded.
 */
async function handleSeedRules() {
  const res = await pool.query(
    `INSERT INTO ops.rules (name, enabled, trigger, action)
     SELECT * FROM (VALUES
       ('Critical/High findings', true,
        '{"on":"finding","where":{"severity":["critical","high"]}}'::jsonb,
        '{"alert":{"severity":"high"}}'::jsonb),
       ('Capacity pressure', true,
        '{"on":"finding","where":{"source":"capacity"}}'::jsonb,
        '{"alert":{"severity":"medium"}}'::jsonb),
       ('Secret exposure', true,
        '{"on":"finding","where":{"source":"gitleaks"}}'::jsonb,
        '{"alert":{"severity":"critical"}}'::jsonb)
     ) AS v(name, enabled, trigger, action)
     WHERE NOT EXISTS (SELECT 1 FROM ops.rules)`
  );
  log(`seed-rules: inserted=${res.rowCount}`);
}

/**
 * Identify the column holding a finding's stable reference. The seed/headers
 * handlers use 'fingerprint'; treat that as the canonical ref for alert dedup.
 */
const FINDING_REF = 'ref';   // findings.ref is the clean SEC-#### id (unique)

/**
 * rules-eval: for each enabled rule, fire a 'firing' alert for any OPEN finding
 * matching trigger.where (severity IN [...] and/or source =) that does not yet
 * have a firing alert with dedup_key = rule_id||':'||finding.ref. Notifies on
 * each new alert. Idempotent via NOT EXISTS dedup guard.
 */
async function handleRulesEval() {
  const rulesRes = await pool.query(
    `SELECT id, name, trigger, action FROM ops.rules WHERE enabled = true`
  );

  let fired = 0;
  for (const rule of rulesRes.rows) {
    const where = (rule.trigger && rule.trigger.where) || {};
    const action = (rule.action && rule.action.alert) || {};
    const conds = [];
    const params = [rule.id];

    if (Array.isArray(where.severity) && where.severity.length > 0) {
      params.push(where.severity);
      conds.push(`f.severity = ANY($${params.length}::text[])`);
    }
    if (where.source) {
      params.push(where.source);
      conds.push(`f.source = $${params.length}`);
    }
    // A rule with no recognised predicate matches nothing (avoid alerting on all).
    if (conds.length === 0) continue;

    params.push(action.severity || null);
    const sevIdx = params.length;
    params.push(rule.name);
    const nameIdx = params.length;

    let sel;
    try {
      sel = await pool.query(
        `INSERT INTO ops.alerts (rule_id, severity, message, dedup_key, status, metadata)
         SELECT $1::uuid,
                COALESCE($${sevIdx}, f.severity),
                ($${nameIdx} || ': ' || f.${FINDING_REF} || ' ' || COALESCE(f.title, '')),
                ($1::text || ':' || f.${FINDING_REF}),
                'firing',
                jsonb_build_object('finding', f.${FINDING_REF})
           FROM ops.findings f
          WHERE f.status = 'open'
            AND ${conds.join(' AND ')}
            AND NOT EXISTS (
              SELECT 1 FROM ops.alerts a
               WHERE a.dedup_key = ($1::text || ':' || f.${FINDING_REF})
                 AND a.status = 'firing'
            )
         RETURNING severity, message`,
        params
      );
    } catch (err) {
      errlog(`rules-eval: rule "${rule.name}" failed: ${err.message}`);
      continue;
    }

    for (const a of sel.rows) {
      fired += 1;
      await notify(a.severity, a.message);
    }
  }
  log(`rules-eval: alerts_fired=${fired}`);
}

/**
 * ai-triage: enrich up to 3 un-remediated open findings via a configured hermes
 * (Ollama) connector. No connector / unreachable / timeout -> no-op, never crash.
 */
async function handleAiTriage() {
  let connector;
  try {
    const res = await pool.query(
      `SELECT config FROM public.connectors WHERE type='hermes' AND enabled=true LIMIT 1`
    );
    connector = res.rows[0];
  } catch (err) {
    errlog(`ai-triage: connector lookup failed: ${err.message}`);
    return;
  }

  const url = connector && connector.config && connector.config.url;
  if (!url) {
    log('ai-triage: no hermes connector');
    return;
  }

  let findings;
  try {
    const res = await pool.query(
      `SELECT ${FINDING_REF} AS ref, title, description
         FROM ops.findings
        WHERE status='open' AND (remediation = '{}'::jsonb OR remediation IS NULL)
        LIMIT 3`
    );
    findings = res.rows;
  } catch (err) {
    errlog(`ai-triage: finding query failed: ${err.message}`);
    return;
  }

  let updated = 0;
  for (const f of findings) {
    const prompt =
      `Provide exactly 3 concise remediation steps for the following ops/security finding.\n` +
      `Title: ${f.title || ''}\nDescription: ${f.description || ''}`;
    const payload = JSON.stringify({ model: 'llama3', prompt, stream: false });

    let resp;
    try {
      const r = await httpRequest({
        method: 'POST',
        url: `${url.replace(/\/$/, '')}/api/generate`,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        body: payload,
        timeoutMs: 10000,
      });
      const parsed = JSON.parse(r.body);
      resp = parsed.response;
    } catch (err) {
      log(`ai-triage: hermes request failed for ${f.ref} — ${err.message}`);
      continue;
    }
    if (!resp) continue;

    try {
      await pool.query(
        `UPDATE ops.findings
            SET remediation = jsonb_build_object('text', $2::text, 'ai_generated', true)
          WHERE ${FINDING_REF} = $1`,
        [f.ref, resp]
      );
      updated += 1;
    } catch (err) {
      errlog(`ai-triage: update failed for ${f.ref}: ${err.message}`);
    }
  }
  log(`ai-triage: updated=${updated}`);
}

const HANDLERS = {
  'snapshot-collect': handleSnapshotCollect,
  'capacity-scan': handleCapacityScan,
  'headers-scan': handleHeadersScan,
  'seed-rules': handleSeedRules,
  'rules-eval': handleRulesEval,
  'ai-triage': handleAiTriage,
};

// --- Scheduler -------------------------------------------------------------

/**
 * Idempotently enqueue each periodic job. The partial unique index means
 * ON CONFLICT DO NOTHING quietly drops the insert when a pending row of that
 * type already exists, so N workers never create duplicates.
 */
async function schedulerTick() {
  // Reap stale locks first so a dead worker's 'running' rows don't keep the
  // partial unique index from accepting fresh enqueues below.
  try {
    const reaped = await pool.query(
      `UPDATE ops.jobs
          SET status='queued', locked_by=null, locked_at=null
        WHERE status='running' AND locked_at < now() - interval '${STALE_LOCK_INTERVAL}'`
    );
    if (reaped.rowCount > 0) {
      log(`scheduler reaped ${reaped.rowCount} stale-locked job(s) back to queued`);
    }
  } catch (err) {
    errlog(`scheduler stale-lock reaper failed: ${err.message}`);
  }

  for (const type of PERIODIC_JOBS) {
    try {
      const res = await pool.query(
        `INSERT INTO ops.jobs (type) VALUES ($1)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [type]
      );
      if (res.rowCount > 0) {
        log(`scheduler enqueued ${type} (${res.rows[0].id})`);
      }
    } catch (err) {
      errlog(`scheduler enqueue ${type} failed: ${err.message}`);
    }
  }
}

// --- Claim loop ------------------------------------------------------------

/**
 * Atomically claim one queued job using FOR UPDATE SKIP LOCKED so concurrent
 * workers never grab the same row. Returns the claimed job or null.
 */
async function claimJob() {
  const res = await pool.query(
    `UPDATE ops.jobs
        SET status='running', locked_by=$1, locked_at=now(), attempts=attempts+1, updated_at=now()
      WHERE id = (
        SELECT id FROM ops.jobs
         WHERE status='queued' AND run_after<=now()
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING *`,
    [WORKER_ID]
  );
  return res.rows[0] || null;
}

async function claimTick() {
  const job = await claimJob();
  if (!job) return;

  log(`claimed job ${job.id} type=${job.type} attempt=${job.attempts}`);

  const handler = HANDLERS[job.type];
  try {
    if (!handler) throw new Error(`No handler for job type "${job.type}"`);
    await handler(job.payload || {});
    await pool.query(
      `UPDATE ops.jobs SET status='done', last_error=NULL, updated_at=now() WHERE id=$1`,
      [job.id]
    );
    log(`job ${job.id} type=${job.type} done`);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (job.attempts < MAX_ATTEMPTS) {
      // Retryable: requeue with a backoff delay.
      await pool.query(
        `UPDATE ops.jobs
            SET status='queued', last_error=$2, run_after=now() + ($3 || ' milliseconds')::interval, updated_at=now()
          WHERE id=$1`,
        [job.id, msg, String(BACKOFF_MS)]
      );
      errlog(`job ${job.id} type=${job.type} failed (attempt ${job.attempts}/${MAX_ATTEMPTS}) — requeued: ${msg}`);
    } else {
      await pool.query(
        `UPDATE ops.jobs SET status='error', last_error=$2, updated_at=now() WHERE id=$1`,
        [job.id, msg]
      );
      errlog(`job ${job.id} type=${job.type} failed permanently after ${job.attempts} attempts: ${msg}`);
    }
  }
}

// --- Loops -----------------------------------------------------------------

async function safeSchedulerTick() {
  try {
    await schedulerTick();
  } catch (err) {
    errlog(`scheduler tick failed: ${err && err.message ? err.message : err}`);
  }
}

async function safeClaimTick() {
  try {
    await claimTick();
  } catch (err) {
    errlog(`claim tick failed: ${err && err.message ? err.message : err}`);
  }
}

log(`starting up; scheduler=${SCHEDULER_INTERVAL_MS}ms claim=${CLAIM_INTERVAL_MS}ms`);
safeSchedulerTick();
safeClaimTick();
setInterval(safeSchedulerTick, SCHEDULER_INTERVAL_MS);
setInterval(safeClaimTick, CLAIM_INTERVAL_MS);
