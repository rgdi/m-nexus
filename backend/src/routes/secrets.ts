// Secrets routes: CRUD para API keys LLM y otras credenciales.
// v0.33: cifrado AES-256-GCM.
// v0.45: error codes estructurados con AppError.

import { FastifyInstance } from "fastify";
import { getSecretManager, SecretNotFoundError, SecretAccessDeniedError } from "../services/secretManager.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logOp } from "../utils/log.js";

export async function secretsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/secrets
  app.get("/api/v1/secrets", async (req, reply) => {
    const r = await safeCallAsync({
      component: "sec",
      code: "EC-SEC-020",
      message: "list secrets failed",
      op: async () => {
        const sm = getSecretManager();
        const names = sm.list();
        logOp("sec", "list", true, { count: names.length });
        return { secrets: names, count: names.length };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // GET /api/v1/secrets/:name
  app.get<{ Params: { name: string } }>("/api/v1/secrets/:name", async (req, reply) => {
    const r = await safeCallAsync({
      component: "sec",
      code: "EC-SEC-021",
      message: "get secret info failed",
      context: { name: req.params.name },
      op: async () => {
        const sm = getSecretManager();
        const exists = sm.has(req.params.name);
        if (!exists) {
          throw E.sec("EC-SEC-022", `Secret ${req.params.name} not configured`, {
            context: { name: req.params.name },
            statusCode: 404,
            hint: "POST /api/v1/secrets/:name with { value } to set it",
          });
        }
        return { name: req.params.name, configured: true };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // POST /api/v1/secrets/:name
  app.post<{ Params: { name: string }; Body: { value?: string } }>(
    "/api/v1/secrets/:name",
    async (req, reply) => {
      const r = await safeCallAsync({
        component: "sec",
        code: "EC-SEC-023",
        message: "set secret failed",
        context: { name: req.params.name, deviceId: req.auth?.sub?.slice(0, 8) },
        op: async () => {
          const value = req.body?.value;
          if (typeof value !== "string" || value.length === 0) {
            throw E.val("EC-SEC-024", "value must be a non-empty string", {
              context: { valueType: typeof value, valueLen: value?.length ?? 0 },
              hint: "Send { value: 'your-api-key' }",
            });
          }
          if (value.length > 4096) {
            throw E.val("EC-SEC-025", "value must be <= 4096 chars", {
              context: { valueLen: value.length, maxLen: 4096 },
              hint: "API key is too long; check if you pasted correctly",
            });
          }
          const sm = getSecretManager();
          const deviceId = (req as { auth?: { sub?: string } }).auth?.sub ?? "unknown";
          sm.set(req.params.name, value, { createdBy: deviceId });
          logOp("sec", "set", true, { name: req.params.name, deviceId: deviceId.slice(0, 8) });
          return { ok: true, name: req.params.name };
        },
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    }
  );

  // DELETE /api/v1/secrets/:name
  app.delete<{ Params: { name: string } }>("/api/v1/secrets/:name", async (req, reply) => {
    const r = await safeCallAsync({
      component: "sec",
      code: "EC-SEC-026",
      message: "delete secret failed",
      context: { name: req.params.name },
      op: async () => {
        const sm = getSecretManager();
        const existed = sm.delete(req.params.name);
        logOp("sec", "delete", true, { name: req.params.name, existed });
        return { ok: true, existed };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // POST /api/v1/secrets/test/:name
  app.post<{ Params: { name: string } }>("/api/v1/secrets/test/:name", async (req, reply) => {
    const r = await safeCallAsync({
      component: "sec",
      code: "EC-SEC-027",
      message: "test secret failed",
      context: { name: req.params.name },
      op: async () => {
        const sm = getSecretManager();
        try {
          const value = sm.get(req.params.name);
          return { ok: true, length: value.length };
        } catch (err) {
          if (err instanceof SecretNotFoundError) {
            throw E.sec("EC-SEC-028", err.message, {
              context: { name: req.params.name },
              statusCode: 404,
            });
          }
          if (err instanceof SecretAccessDeniedError) {
            throw E.sec("EC-SEC-029", err.message, {
              context: { name: req.params.name },
              hint: "Master key may be wrong or corrupted",
            });
          }
          throw err;
        }
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });
}
