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
