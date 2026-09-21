# M-NEXUS Scaling & Load Balancing

> Added in **v2.23.3**. Multi-server topologies, peer auto-discovery, sticky routes,
> horizontal scaling. Runs on bare metal, Docker Swarm, Kubernetes or any cloud with
> a shared L2/L3 network.

---

## Why

The single-node deployment served well up to ~250 concurrent users, ~5k notes, ~50k
flashcards. Beyond that you hit:

| Bottleneck | Symptom | First remedy |
|---|---|---|
| JSON file storage | each request locks the whole map | Mongo/Postgres migration |
| Single-process WS | slow sync fan-out, browser reconnects on restart | multiple node instances |
| Single host CPU | slow LLM inference / OCR | dedicated node with GPU |

This document covers **horizontal scaling** — running multiple M-NEXUS nodes that
share the same data and present a single endpoint to clients.

---

## Topologies supported

```
                        ┌──────────┐
                        │ Client   │ (browser / Capacitor Android / iOS)
                        └────┬─────┘
                             │ HTTPS+WS
                       ┌─────▼───────┐
                       │  Ingress    │  (Nginx, Cloudflare Tunnel, k8s Ingress, AWS ALB, …)
                       │  + sticky   │
                       └─┬───┬───┬───┘
                         │   │   │
                ┌────────▼┐ ┌▼───────┐ ┌▼────────┐
                │ node-A  │ │ node-B │ │ node-C  │   ← auto-discovered peers
                │ leader  │ │ worker │ │ worker  │
                └────┬────┘ └────┬───┘ └────┬────┘
                     │          │           │
                     ▼          ▼           ▼
                ┌─────────────────────────────────┐
                │  shared state                   │
                │  • Redis (peers + leader lock)  │
                │  • Postgres (durable) OR Mongo  │
                │  • S3/GCS (recordings, glb)     │
                └─────────────────────────────────┘
```

You can run **one node** (default), **two nodes (HA pair)** or **N nodes (scale-out)**.
The client tries each peer until it finds one that responds.

---

## Auto-discovery

When a node starts it:

1. Reads its `INSTANCE_ID` from env (defaults to hostname).
2. Registers with Redis under `mnexus:peers:${INSTANCE_ID}` with:
   - `host`, `port`, `version`, `startedAt`, `lastSeen`
   - `capabilities`: `["http", "ws", "ocr", "llm"]`
3. Sends a heartbeat every 15 s.
4. Peers expired after 60 s are evicted automatically.

Every client receives the peer list via `/api/v1/cluster/peers` and via the WS
broadcast `cluster:peers` message. The client UI shows a small server indicator in
the top-right corner (collapsed in idle) — click to expand and force-pick.

### Disabling Redis for single-node

If you only run one instance, you don't need Redis. Set `CLUSTER_REDIS=0` and the
local peer list is just `[thisNode]`. Everything else works identically.

---

## Leader election

A single "leader" node is elected per cluster to run scheduled / singleton tasks
(notification listener drain, sync metrics aggregation, scheduled backups, OCR queue
arbitration). Use Redis `SET NX EX` for the lock (`mnexus:leader`).

If the leader dies, another node acquires the lock within ~5 s. Clients fall over
to a worker until a new leader is elected.

---

## Sticky routes

WebSocket sync uses the `RouteAffinity` cookie (httponly, signed). When a client
opens WS to a node, that connection stays open until the node dies. The WS
reconnect logic chooses the same node if it reappears within 30 s; otherwise it
picks the lowest-latency peer.

For HTTP, requests are stateless — any node can answer.

---

## Initial config flow

Two surfaces interact with cluster config:

1. **First-run wizard** (single-node default). If `CLUSTER_REDIS=0`, that's it.
2. **Admin / Cluster screen** reachable via the top-left dock + Cluster. Lets you:
   - See all peers live (host · port · uptime · load · version)
   - Add a peer manually (paste URL `https://node-b:4100`)
   - Promote / demote the current node from leader to worker
   - Trigger an `mnexus-admin check` deep health probe
   - View peer logs tailed to your browser

The first time you open the wizard with `CLUSTER_REDIS` set, the wizard detects
Redis and **prompts for cluster mode**: "Solo este servidor" / "Únete a un cluster"
/ "Crea un cluster nuevo". Three options, three different flows, none destructive.

---

## Configuration matrix

| Env var | Default | Where set | Purpose |
|---|---|---|---|
| `INSTANCE_ID` | hostname | systemd / docker | Stable per-node ID |
| `NODE_REGION` | `local` | systemd / docker | "eu-west", "us-east"… (used by client UX badge) |
| `NODE_ROLE` | `auto` (`leader` if first, else `worker`) | systemd / docker | Force role |
| `CLUSTER_REDIS` | `0` | env | `0` = single node, `1` = multi node |
| `REDIS_URL` | — | env | `redis://10.0.0.1:6379` (used when CLUSTER_REDIS=1) |
| `PEER_TTL` | `60` | env | Seconds before a peer is considered dead |
| `PEER_TICK` | `15` | env | Heartbeat interval |
| `DATABASE_URL` | — | env | Postgres or Mongo URL (when present, replaces JSON files) |
| `STORAGE_BACKEND` | `json` | env | `json` / `postgres` / `mongo` |
| `PUBLIC_URL` | `http://localhost:4100` | env | What peers register as their public address |

---

## Running the cluster

### Single node (default — no Redis)

```bash
curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install.sh | bash
# sets up systemd or docker-compose for one node.
```

### Two nodes (HA pair, shared Redis)

```bash
# On both nodes, install — same instructions.
curl -fsSL ...install.sh | bash -s -- server --systemd
# Then, on both:
sudo tee /etc/mnexus/cluster.env <<EOF
CLUSTER_REDIS=1
REDIS_URL=redis://10.0.0.1:6379
NODE_ROLE=auto
EOF
sudo systemctl restart mnexus
sudo systemctl status mnexus
```

### Five nodes + autoscaling (Kubernetes)

```bash
kubectl apply -f docs/k8s/mnexus.yaml
# Service Account, StatefulSet, Ingress, ConfigMap, Redis sidecar.
```

Helm chart and full k8s manifests: [docs/k8s/README.md](./k8s/README.md)

---

## What clients see

In the top-right corner, a small pill changes colour based on which node responded
last:

- 🟢 green — current server
- 🟡 yellow — fallback (degraded)
- 🔴 red — all peers down (last cached page)
- ⚪ white — first load, no peer list yet

Clicking it opens the "Server" overlay:

```
Actualmente conectado a
  ✓ node-A · eu-west · 4100 · v2.23.3

Otros servidores disponibles
  ✓ node-B · eu-west · 4101 · v2.23.3
  ⟳ node-C · us-east · 4100 · v2.23.3 (conectando)
  ✗ node-D · ap-south · 4100 · v2.23.2 (versión antigua — upgrade sugerido)

Acciones:
  [ Forzar reconexión a este nodo ]
  [ Diagnosticar este peer ]
  [ Compartir URL con dispositivo nuevo ]
```

---

## Performance

| Setup | Concurrent users | Notes sync latency (p50) | Cold WS reconnect |
|---|---|---|---|
| 1 node, JSON files | ~250 | 32 ms | 180 ms |
| 2 nodes, JSON + Redis | ~700 | 24 ms | 90 ms |
| 5 nodes, Postgres + Redis | 4 000+ | 18 ms | 70 ms |

(Benchmarks done with k6, synthetic 50k notes, 5k flashcards per user.)

---

## What clients see — switching mid-session

`window.MNEXUS_PEERS` is exposed so scripts can request `getServerByRegion("eu-west")`.
Active sync messages are forwarded through the WS, so when the WS migrates to a
new node, any `sync:incoming` listeners transparently switch.

---

## Limitations / open

- **Leader-only OCR / LLM queue**: only the elected leader runs long-running jobs.
  Workers proxy uploads but the actual inference happens on the leader unless you
  enable `DISTRIBUTED_OCR=1`.
- **Sticky WS via cookie**: clients on corporate networks without cookies (rare
  middleboxes) fall back to round-robin and will eventually get the same node.
- **Schema migrations**: are still monolith-aware (each node runs the migration on
  startup); for safe cluster migration run with `LEADER_ONLY_MIGRATIONS=1` so only
  the leader migrates and workers wait.
