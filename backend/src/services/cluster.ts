// services/cluster.ts — multi-server cluster registry.
//
// v2.23.3: nodes within a cluster (share the same JWT_SECRET) discover each other
// and elect a leader. Defaults to single-node mode (no Redis) which is a no-op
// cluster of size 1: thisNode only.
//
// Modes:
//   - CLUSTER_REDIS=0   (default) — single node. peers() returns [self].
//                        heartbeatWorker is no-op. leaderLockWorker no-op.
//   - CLUSTER_REDIS=1   — multi node. Uses Redis for peer registry + leader lock.
//
// All timeouts and intervals are environment-driven; defaults are sane for
// real clusters (15s heartbeat, 60s expiry).
//
// The Redis client is injected so tests can substitute ioredis-mock.

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";

export interface PeerInfo {
  id: string;
  host: string;
  port: number;
  region: string;
  role: "leader" | "worker";
  version: string;
  capabilities: string[];
  startedAt: number;
  lastSeen: number;
  uptimeSec: number;
  publicUrl?: string;
}

export interface ClusterOptions {
  ttl: number;
  tick: number;
  port: number;
  region: string;
  version: string;
  publicUrl?: string;
  capabilities: string[];
  redis?: RedisLike | null;
  /**
   * If CLUSTER_REDIS=1 but redis client couldn't be created (e.g. ioredis not
   * installed in the test environment), we still want graceful degradation.
   */
  allowFallbackToLocal?: boolean;
  dataDir?: string;
}

export interface RedisLike {
  set: (...args: any[]) => Promise<any>;
  get: (...args: any[]) => Promise<any>;
  del: (...args: any[]) => Promise<any>;
  keys: (...args: any[]) => Promise<any>;
  expire: (...args: any[]) => Promise<any>;
}

interface PersistedSelf {
  id: string;
  host: string;
  port: number;
  region: string;
  version: string;
  startedAt: number;
  capabilities: string[];
  publicUrl?: string;
}

export class Cluster {
  private self: PeerInfo;
  private role: "leader" | "worker";
  private opts: ClusterOptions;
  private heartbeatHandle: any = null;
  private leaderLockHandle: any = null;
  private leaderLockRenewHandle: any = null;
  private fallbackPeers: PeerInfo[] = [];
  private fallbackPeersFile: string;
  private isLeaderFlag: boolean;
  private listeners: Set<(msg: { type: string; payload: any }) => void> = new Set();
  /** Bump cluster schema version when peer record shape changes. */
  static readonly SCHEMA = 1;

  constructor(opts: ClusterOptions) {
    const id = process.env.INSTANCE_ID || hostname();
    const region = opts.region || process.env.NODE_REGION || "local";
    const now = Date.now();
    const role: "leader" | "worker" = process.env.NODE_ROLE === "worker"
      ? "worker"
      : "leader"; // first node defaults to leader; switch happens when peer arrives.
    this.opts = opts;
    this.fallbackPeersFile = join(opts.dataDir || process.cwd(), "data", "cluster-peers.json");
    this.self = {
      id,
      host: hostname(),
      port: opts.port,
      region,
      role,
      version: opts.version || "dev",
      capabilities: opts.capabilities || ["http", "ws", "ocr", "llm"],
      startedAt: now,
      lastSeen: now,
      uptimeSec: 0,
      publicUrl: opts.publicUrl,
    };
    this.role = role;
    // Single-node defaults to self-as-leader; multi-node starts neutral and
    // tries to acquire via Redis.
    this.isLeaderFlag = !opts.redis;
  }

  /** Read-only: this node's id and metadata. */
  getSelf(): PeerInfo {
    return { ...this.self, uptimeSec: Math.floor((Date.now() - this.self.startedAt) / 1000) };
  }

  /** Subscribe to cluster events: `peer:joined`, `peer:left`, `leader:elected`, `leader:lost`. */
  on(fn: (msg: { type: string; payload: any }) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(type: string, payload: any) {
    for (const fn of this.listeners) {
      try { fn({ type, payload }); } catch {}
    }
  }

  /** Boot: starts the heartbeat and (when redis is enabled) the leader lock renewal. */
  async start(): Promise<void> {
    if (this.opts.redis) {
      await this.heartbeatOnce();
      this.heartbeatHandle = setInterval(() => this.heartbeatOnce().catch(() => {}), this.opts.tick * 1000);
      this.leaderLockHandle = setInterval(() => this.tryAcquireLeader().catch(() => {}), Math.max(3, Math.floor(this.opts.tick / 5)) * 1000);
      await this.tryAcquireLeader();
    } else {
      // Single-node mode: this node is always leader, peers list = [self].
      this.isLeaderFlag = true;
      this.fallbackPeers = [this.getSelf()];
      // Ensure peers file is initialised (helps the client probe REST endpoints).
      try {
        await fs.mkdir(join(this.fallbackPeersFile, ".."), { recursive: true });
        await fs.writeFile(this.fallbackPeersFile, JSON.stringify([this.getSelf()], null, 2));
      } catch {}
    }
  }

  /** Returns all live peers including self, sorted with self first. */
  async peers(): Promise<PeerInfo[]> {
    if (!this.opts.redis) {
      // Single-node mode: bypass TTL filter (this is the only node, by
      // definition always alive). Always return [self].
      return [this.getSelf()];
    }
    const peers = await this.readPeers();
    peers.sort((a, b) => (a.id === this.self.id ? -1 : b.id === this.self.id ? 1 : a.id.localeCompare(b.id)));
    // Filter dead peers (lastSeen older than ttl)
    const cutoff = Date.now() - this.opts.ttl * 1000;
    return peers.filter((p) => p.lastSeen >= cutoff || p.id === this.self.id);
  }

  /** Stop heartbeat + leader lock. Safe to call multiple times. */
  async stop(): Promise<void> {
    if (this.heartbeatHandle) clearInterval(this.heartbeatHandle);
    if (this.leaderLockHandle) clearInterval(this.leaderLockHandle);
    if (this.leaderLockRenewHandle) clearInterval(this.leaderLockRenewHandle);
    this.heartbeatHandle = this.leaderLockHandle = this.leaderLockRenewHandle = null;
    if (this.opts.redis && this.isLeaderFlag) {
      try { await this.opts.redis.del(`mnexus:leader:${this.self.region}`); } catch {}
    }
  }

  isLeader(): boolean { return this.isLeaderFlag; }
  getRole(): "leader" | "worker" { return this.role; }

  async forceRole(role: "leader" | "worker"): Promise<void> {
    const previous = this.role;
    this.role = role;
    this.self.role = role;
    if (this.opts.redis) {
      await this.heartbeatOnce();
      await this.tryAcquireLeader();
    } else {
      // Single-node: role is authoritative; flag tracks role directly.
      this.isLeaderFlag = role === "leader";
    }
    if (previous !== role) this.emit("role:changed", { role });
  }

  // ---------------- internals --------------------------------------------

  private async heartbeatOnce(): Promise<void> {
    const r = this.opts.redis!;
    const key = `mnexus:peers:${this.self.region}:${this.self.id}`;
    const value: PeerInfo = this.getSelf();
    try {
      // SET with TTL = ttl*2 so a missed heartbeat doesn't crash the cluster.
      await r.set(key, JSON.stringify(value), "EX", this.opts.ttl * 2);
    } catch {}
    // Evict stale peers
    try {
      const all = await r.keys(`mnexus:peers:${this.self.region}:*`);
      const known: string[] = [];
      for (const k of all) {
        const v = await r.get(k);
        if (!v) {
          await r.del(k);
          continue;
        }
        try {
          const p = JSON.parse(v) as PeerInfo;
          if (Date.now() - p.lastSeen > this.opts.ttl * 1000) {
            await r.del(k);
            this.emit("peer:left", { id: p.id });
          } else {
            known.push(p.id);
          }
        } catch {}
      }
    } catch {}
  }

  private async readPeers(): Promise<PeerInfo[]> {
    const r = this.opts.redis!;
    const all = await r.keys(`mnexus:peers:${this.self.region}:*`);
    const peers: PeerInfo[] = [];
    for (const k of all) {
      const v = await r.get(k);
      if (!v) continue;
      try { peers.push(JSON.parse(v) as PeerInfo); } catch {}
    }
    return peers;
  }

  private async tryAcquireLeader(): Promise<void> {
    const r = this.opts.redis!;
    const key = `mnexus:leader:${this.self.region}`;
    const ttl = Math.max(15, this.opts.ttl);
    // SET NX EX for atomic acquisition
    let ok = false;
    try {
      const res = await r.set(key, JSON.stringify(this.getSelf()), "EX", ttl, "NX");
      ok = res === "OK" || res === true;
    } catch {
      return;
    }
    if (ok) {
      this.isLeaderFlag = true;
      this.self.role = "leader";
      this.emit("leader:elected", { id: this.self.id });
      // Renew slightly before expiry to avoid races.
      if (this.leaderLockRenewHandle) clearInterval(this.leaderLockRenewHandle);
      this.leaderLockRenewHandle = setInterval(async () => {
        try {
          const current = await r.get(key);
          if (current) {
            const c = JSON.parse(current) as PeerInfo;
            if (c.id === this.self.id) await r.set(key, JSON.stringify(this.getSelf()), "EX", ttl);
          }
        } catch {}
      }, (ttl - 5) * 1000);
      return;
    }
    // Couldn't acquire — check what the current lock holder is.
    let current: any = null;
    try { current = await r.get(key); } catch {}
    if (current) {
      try {
        const c = JSON.parse(current) as PeerInfo;
        if (c.id !== this.self.id) {
          if (this.isLeaderFlag) {
            this.isLeaderFlag = false;
            this.self.role = "worker";
            this.emit("leader:lost", { id: c.id });
          }
        }
      } catch {}
    }
  }
}

/** Read persisted self-record (used to restore the node ID across restarts). */
export async function loadPersistedSelf(dataDir: string): Promise<PersistedSelf | null> {
  try {
    const txt = await fs.readFile(join(dataDir, "instance.json"), "utf-8");
    const parsed = JSON.parse(txt);
    if (parsed && typeof parsed.id === "string") return parsed as PersistedSelf;
  } catch {}
  return null;
}

export async function savePersistedSelf(dataDir: string, self: PersistedSelf): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(join(dataDir, "instance.json"), JSON.stringify(self, null, 2));
}
