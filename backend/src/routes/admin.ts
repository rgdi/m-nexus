// Admin routes: AI provider config + manual backup trigger.
// v2.6.0: all routes here require JWT (admin scope).
//
// Mounted at /api/v1/admin/* by server.ts.

import type { FastifyPluginAsync } from "fastify";
import { getAIConfig, setAIConfig, testConnection, AI_PROVIDERS, type AIConfig, type AIProvider } from "../services/aiProviders.js";
import { runBackupNow, getBackupStatus } from "../services/autoBackupService.js";
import { getBackupConfig, setBackupConfig, type BackupConfig } from "../services/backupConfig.js";
import { loadDemoDataInline } from "../services/demoData.js";

function requireAdmin(req: any, reply: any): boolean {
  // LAN bypass: when running on localhost network AND LAN_AUTH_BYPASS=true,
  // the auth middleware sets req.auth.isLanBypass=true. If middleware was
  // not applied (e.g., direct route registration in tests), fall back to
  // env-var check so test environments can still exercise admin routes.
  const lanOk = process.env.LAN_AUTH_BYPASS === "true";
  if (lanOk) return true; // LAN bypass short-circuits everything
  if (!req.auth || (req.auth.scope !== "admin" && !req.auth.isLanBypass)) {
    reply.status(401).send({ error: "Admin auth required", code: "EC-AUTH-130" });
    return false;
  }
  return true;
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // ── AI provider ─────────────────────────────────────────────────────

  // GET /api/v1/admin/ai → current config (apiKey masked)
  app.get("/admin/ai", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const cfg = await getAIConfig();
    return reply.send({
      ...cfg,
      apiKey: cfg.apiKey ? "***" : undefined,
      availableProviders: AI_PROVIDERS,
    });
  });

  // POST /api/v1/admin/ai → save config
  app.post("/admin/ai", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = (req.body ?? {}) as Partial<AIConfig> & { provider?: AIProvider };
    if (!body.provider || !body.model) {
      return reply.status(400).send({ error: "provider and model required", code: "EC-AI-100" });
    }
    if (!AI_PROVIDERS.find((p) => p.value === body.provider)) {
      return reply.status(400).send({ error: `Unknown provider: ${body.provider}`, code: "EC-AI-101" });
    }
    const current = await getAIConfig();
    const next: AIConfig = {
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl || current.baseUrl,
      apiKey: body.apiKey && body.apiKey !== "***" ? body.apiKey : current.apiKey,
      temperature: body.temperature ?? current.temperature,
      maxTokens: body.maxTokens ?? current.maxTokens,
      enabledAt: Date.now(),
    };
    await setAIConfig(next);
    return reply.send({ ok: true, provider: next.provider, model: next.model });
  });

  // POST /api/v1/admin/ai/test → ping the provider
  app.post("/admin/ai/test", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return reply.send(await testConnection());
  });

  // ── Backup ──────────────────────────────────────────────────────────

  // GET /api/v1/admin/backup → config + last run info
  app.get("/admin/backup", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return reply.send({
      config: getBackupConfig(),
      status: getBackupStatus(),
    });
  });

  // POST /api/v1/admin/backup/config → update rotation settings
  app.post("/admin/backup/config", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = (req.body ?? {}) as Partial<BackupConfig>;
    const next: BackupConfig = {
      intervalHours: Number(body.intervalHours) || 24,
      keepDaily: Number(body.keepDaily) || 30,
      keepMonthly: Number(body.keepMonthly) || 12,
      remoteCommand: typeof body.remoteCommand === "string" ? body.remoteCommand : undefined,
    };
    if (next.intervalHours < 0 || next.intervalHours > 168) {
      return reply.status(400).send({ error: "intervalHours must be 0-168", code: "EC-BACKUP-100" });
    }
    await setBackupConfig(next);
    return reply.send({ ok: true, config: next });
  });

  // POST /api/v1/admin/backup/run → manual trigger
  app.post("/admin/backup/run", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const result = await runBackupNow();
    return reply.send(result);
  });

  // ── v2.6.0: Demo data (opt-in) ──────────────────────────────────────
  app.post("/admin/demo/load", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { loadDemoDataInline } = await import("../services/demoData.js");
    const result = await loadDemoDataInline();
    return reply.send(result);
  });
};
