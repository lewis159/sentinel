# HA Runbook

_Living document — reflects the current build; re-verify after changes._

## Purpose

How to operate Sentinel's high-availability cluster: what fails over and how, the node roles,
how to grow from launch to a 3-manager cluster, and how to recover from common failures. This
is the operational companion to [Architecture](./architecture.md) and [Build Process](./build-process.md).

![HA topology — Patroni/etcd/HAProxy, app replicas, worker pool, global proxy](./images/ha-topology.png)

## Cluster components

| Component | Role |
|-----------|------|
| **Patroni (Spilo)** | Manages the Postgres primary/replica set; handles promotion |
| **etcd** | Distributed consensus store Patroni uses to elect the leader (needs a quorum) |
| **HAProxy** | Routes DB clients to the current primary (and replicas for reads) |
| **App replicas** | Multiple Next.js instances behind a load balancer |
| **Worker pool** | Multiple consumers off the `ops.jobs` queue |
| **Global socket-proxy** | One read-only Docker Engine proxy for the cluster |

Sentinel connects to Postgres **through HAProxy**, never to a node directly — so a failover is
transparent to the app beyond a brief write pause.

## Node roles & topology

- **Launch: 2 nodes.** Minimal HA — a primary and a standby, with the app/worker spread across
  both.
- **Growth: 3 managers.** The **3rd node** is the **management plane** — it runs **Portainer +
  Sentinel** itself. Three managers also give etcd a proper quorum (tolerates one node loss).

> Quorum math: etcd needs a **majority** of nodes alive to elect a leader. With 3 nodes you can
> lose 1; with 2 nodes you have no fault tolerance for the consensus layer — which is exactly
> why growth to 3 managers matters.

## Failover behaviour

When the primary Postgres node fails:

1. Patroni detects the primary is unhealthy (via etcd).
2. Patroni **promotes a healthy replica** to primary.
3. HAProxy's health check marks the old primary `DOWN` and routes writes to the new primary.
4. The app sees a brief connection error/timeout (you may see `no DB` or a connection-terminated
   note for a few seconds), then reconnects through HAProxy automatically.

**Operator action during failover:** usually none — let it complete. Confirm the new leader
(Patroni role `Leader`) and that HAProxy shows the new primary `UP`. Do **not** manually promote
a **lagging** replica.

## Adding the 3rd node (launch -> 3 managers)

1. Provision the node and join it to the swarm as a **manager**.
2. Add it to **etcd** so the consensus cluster becomes 3 members (restores real quorum).
3. Add a Patroni member on the node (it joins as a replica and starts streaming).
4. Add the node to HAProxy's backend health checks.
5. Place the **management plane** (Portainer + Sentinel) on this node.
6. Verify: 3 etcd members healthy, 1 Patroni Leader + 2 Replicas, HAProxy all `UP`.

## Recovery procedures

**A replica is down:**
- Confirm the primary is still `Leader` and serving. Repair/replace the replica; Patroni
  re-adds it and it catches up by streaming. No write impact.

**The primary is down (and failover happened):**
- Verify a replica was promoted (`Leader`). When the old node returns, Patroni should re-add it
  as a **replica** — do not force it back as primary.

**etcd quorum lost (`no leader` / split-brain risk):**
- This is the dangerous state. **Do not** promote a primary while quorum is lost. Restore enough
  etcd members to regain a **majority**, let Patroni re-elect, then verify a single `Leader`.

**Worker outage:**
- Scans stop producing findings and rules stop evaluating (`ops.jobs` backs up). Restart the
  worker pool; queued jobs drain. No data loss — jobs are persisted in `ops.jobs`.

**socket-proxy outage:**
- Infra/capacity/uptime go to mock. Restart the global proxy; live container data returns. No
  effect on the DB or findings already stored.

## Health checklist

| Check | Healthy state |
|-------|---------------|
| etcd members | Majority alive (3/3 ideal, 2/3 tolerated) |
| Patroni roles | Exactly one `Leader`, others `Replica`, low lag |
| HAProxy backends | Primary `UP`, replicas `UP` |
| App | Replicas serving behind the LB |
| Worker | Consuming `ops.jobs` (queue not growing unbounded) |
| socket-proxy | Reachable; Infra shows the live badge |

## Related

- States & messages: [Error Codes](./error-codes.md) (HA cluster states section).
- Broad failure diagnosis: [Troubleshooting](./troubleshooting.md).
- Stack composition: [Build Process](./build-process.md).
