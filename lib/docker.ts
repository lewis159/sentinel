import http from 'node:http';
import { containers as mockContainers, type Container } from '@/lib/mock';

// Server-only. Minimal Docker Engine API client over TCP, talking to the
// read-only docker-socket-proxy. Dependency-free (Node http only).
// NOTE: only the container LIST is live here. Per-container CPU/mem stats need
// the /stats endpoint and remain mock on the detail page.

const dockerHost = process.env.DOCKER_HOST; // e.g. tcp://docker-socket-proxy:2375

export const hasDocker = Boolean(dockerHost && dockerHost.startsWith('tcp://'));

function parseHost(): { host: string; port: number } | null {
  if (!dockerHost) return null;
  const stripped = dockerHost.replace(/^tcp:\/\//, '');
  const [host, portStr] = stripped.split(':');
  if (!host) return null;
  return { host, port: Number(portStr) || 2375 };
}

function get(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const target = parseHost();
    if (!target) return reject(new Error('DOCKER_HOST not configured'));
    const req = http.get(
      { host: target.host, port: target.port, path, timeout: 4000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          if (!res.statusCode || res.statusCode >= 400) {
            return reject(new Error(`docker API ${res.statusCode} for ${path}`));
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('docker API timeout')));
  });
}

type DockerContainer = {
  Names?: string[];
  State?: string;
  RestartCount?: number;
  Labels?: Record<string, string>;
};

function mapContainer(d: DockerContainer): Container {
  const rawName = (d.Names?.[0] ?? '').replace(/^\//, '');
  const name = rawName || 'unknown';
  // component = name prefix before the first '_' or '.'
  const component = name.split(/[_.]/)[0] || name;
  // Swarm services tag containers with the node id; plain (non-swarm)
  // containers have no such label. Mark those 'standalone' (a real, countable
  // sentinel value) rather than '—', so the page can distinguish "no swarm node"
  // from a missing id and exclude them from the real-node count.
  const node =
    d.Labels?.['com.docker.swarm.node.id'] ||
    d.Labels?.['node'] ||
    'standalone';
  return {
    name,
    component,
    state: d.State ?? 'unknown',
    cpu: 0, // not available from /containers/json — stats endpoint out of scope
    mem: 0, // unknown from /json
    memLimit: 0, // unknown from /json
    restarts: typeof d.RestartCount === 'number' ? d.RestartCount : 0,
    node,
  };
}

export async function getContainers(): Promise<{ rows: Container[]; live: boolean }> {
  if (!hasDocker) return { rows: mockContainers, live: false };
  try {
    const data = (await get('/v1.44/containers/json?all=true')) as DockerContainer[];
    if (!Array.isArray(data)) return { rows: mockContainers, live: false };
    const rows = data.map(mapContainer);
    return { rows, live: true };
  } catch {
    return { rows: mockContainers, live: false };
  }
}

// ---------------------------------------------------------------------------
// Swarm topology (services + tasks → stack → service → task tree).
//
// The docker-socket-proxy exposes /services, /tasks and /nodes (read-only). We
// build a compact tree the TopologyWidget renders: stacks (by the
// com.docker.stack.namespace label) → services → running tasks, with desired
// vs running replica counts. Mock fallback keeps the prototype rendering.
// ---------------------------------------------------------------------------

type DockerService = {
  ID?: string;
  Spec?: {
    Name?: string;
    Labels?: Record<string, string>;
    Mode?: { Replicated?: { Replicas?: number }; Global?: Record<string, never> };
  };
};

type DockerTask = {
  ID?: string;
  ServiceID?: string;
  NodeID?: string;
  DesiredState?: string;
  Status?: { State?: string; Message?: string };
  Slot?: number;
};

export type TopoTask = { id: string; slot: number | null; state: string; desiredState: string; node: string };
export type TopoService = {
  id: string;
  name: string;
  mode: 'replicated' | 'global' | 'unknown';
  desired: number | null; // null for global
  running: number;
  tasks: TopoTask[];
};
export type TopoStack = { stack: string; services: TopoService[] };

async function getServicesRaw(): Promise<DockerService[] | null> {
  try {
    const data = (await get('/v1.44/services')) as DockerService[];
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

async function getTasksRaw(): Promise<DockerTask[] | null> {
  try {
    const data = (await get('/v1.44/tasks')) as DockerTask[];
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

// Public helpers (services / tasks) — exposed per the build spec.
export async function getServices(): Promise<{ rows: DockerService[]; live: boolean }> {
  if (!hasDocker) return { rows: [], live: false };
  const rows = await getServicesRaw();
  return rows ? { rows, live: true } : { rows: [], live: false };
}

export async function getTasks(): Promise<{ rows: DockerTask[]; live: boolean }> {
  if (!hasDocker) return { rows: [], live: false };
  const rows = await getTasksRaw();
  return rows ? { rows, live: true } : { rows: [], live: false };
}

// Mock topology so the widget renders without a live swarm.
const mockTopology: TopoStack[] = [
  {
    stack: 'yt-transcriber',
    services: [
      {
        id: 'svc_app', name: 'yt-transcriber_app', mode: 'replicated', desired: 2, running: 2,
        tasks: [
          { id: 't1', slot: 1, state: 'running', desiredState: 'running', node: 'node-1' },
          { id: 't2', slot: 2, state: 'running', desiredState: 'running', node: 'node-1' },
        ],
      },
      {
        id: 'svc_redis', name: 'yt-transcriber_redis', mode: 'replicated', desired: 1, running: 1,
        tasks: [{ id: 't3', slot: 1, state: 'running', desiredState: 'running', node: 'node-1' }],
      },
    ],
  },
  {
    stack: 'yt-monitoring',
    services: [
      {
        id: 'svc_prom', name: 'yt-monitoring_prometheus', mode: 'replicated', desired: 1, running: 1,
        tasks: [{ id: 't4', slot: 1, state: 'running', desiredState: 'running', node: 'node-1' }],
      },
    ],
  },
];

// Build the stack→service→task tree. `live` is false when the proxy is
// unconfigured or either call fails (→ mock fallback).
export async function getTopology(): Promise<{ stacks: TopoStack[]; live: boolean }> {
  if (!hasDocker) return { stacks: mockTopology, live: false };
  const [services, tasks] = await Promise.all([getServicesRaw(), getTasksRaw()]);
  if (!services || !tasks) return { stacks: mockTopology, live: false };

  // Index running/active tasks per service id.
  const tasksByService = new Map<string, TopoTask[]>();
  for (const t of tasks) {
    const sid = t.ServiceID;
    if (!sid) continue;
    const task: TopoTask = {
      id: (t.ID ?? '').slice(0, 12) || 'task',
      slot: typeof t.Slot === 'number' ? t.Slot : null,
      state: t.Status?.State ?? 'unknown',
      desiredState: t.DesiredState ?? 'unknown',
      node: (t.NodeID ?? '').slice(0, 12) || '—',
    };
    const arr = tasksByService.get(sid) ?? [];
    arr.push(task);
    tasksByService.set(sid, arr);
  }

  const byStack = new Map<string, TopoService[]>();
  for (const s of services) {
    const id = s.ID ?? '';
    const name = s.Spec?.Name ?? id.slice(0, 12) ?? 'service';
    const stack = s.Spec?.Labels?.['com.docker.stack.namespace'] ?? '(standalone)';
    const mode: TopoService['mode'] = s.Spec?.Mode?.Replicated
      ? 'replicated'
      : s.Spec?.Mode?.Global
        ? 'global'
        : 'unknown';
    const desired = mode === 'replicated' ? (s.Spec?.Mode?.Replicated?.Replicas ?? 0) : null;
    const allTasks = (tasksByService.get(id) ?? []).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
    const running = allTasks.filter((t) => t.state === 'running').length;
    const svc: TopoService = { id: id.slice(0, 12) || 'svc', name, mode, desired, running, tasks: allTasks };
    const arr = byStack.get(stack) ?? [];
    arr.push(svc);
    byStack.set(stack, arr);
  }

  const stacks: TopoStack[] = Array.from(byStack.entries())
    .map(([stack, svcs]) => ({ stack, services: svcs.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.stack.localeCompare(b.stack));

  // No swarm services (plain container host) → fall back to mock so the widget
  // still shows a meaningful tree rather than an empty one.
  if (stacks.length === 0) return { stacks: mockTopology, live: false };
  return { stacks, live: true };
}
