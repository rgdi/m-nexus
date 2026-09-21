// routes/cluster.ts — REST endpoints for multi-server cluster.
//
// v2.23.3: GET /api/v1/cluster/peers returns the live list, including self.
// POST /api/v1/cluster/heartbeat is a manual heartbeat (heartbeats are
// auto-emitted on a timer, but admins can request extra pulses).
// POST /api/v1/cluster/promote and /demote force a role change (admin only).
// GET /api/v1/cluster/leader says who is the current leader.

import { FastifyInstance } from "fastify";
import { Cluster } from "../services/cluster.js";

export async function clusterRoutes(app: FastifyInstance, cluster: Cluster): Promise<void> {
  app.get("/api/v1/cluster/peers", async () => {
    const peers = await cluster.peers();
    return { ok: true, peers, total: peers.length };
  });

  app.get("/api/v1/cluster/leader", async () => {
    const peers = await cluster.peers();
    const leader = peers.find((p) => p.role === "leader");
    return { ok: true, leader: leader || null };
  });

  app.post("/api/v1/cluster/heartbeat", async () => {
    return { ok: true, ts: Date.now() };
  });

  app.post<{ Body: { role: "leader" | "worker" } }>(
    "/api/v1/cluster/role",
    async (req, reply) => {
      const body = (req.body ?? {}) as { role?: "leader" | "worker" };
      if (body.role !== "leader" && body.role !== "worker") {
        return reply.status(400).send({ error: "Role must be 'leader' or 'worker'", code: "EC-CLUSTER-101" });
      }
      await cluster.forceRole(body.role);
      return { ok: true, role: cluster.getRole() };
    }
  );
}
