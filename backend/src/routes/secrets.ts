// Secrets routes: CRUD para API keys LLM y otras credenciales.
//
// v0.33: las API keys se guardan cifradas con AES-256-GCM. Solo
// la lista de nombres (no los valores) es visible. El server tiene
// una ACL de quién puede set/get (por ahora: cualquier device
// autenticado puede set; solo el server puede get — la app usa
// la key a través del backend, no la descarga).
//
// Endpoints:
//   GET    /api/v1/secrets          → lista nombres
//   GET    /api/v1/secrets/:name    → marca como "configured" (no devuelve el valor)
//   POST   /api/v1/secrets/:name    → set (body: { value: "..." })
//   DELETE /api/v1/secrets/:name    → borra

import { FastifyInstance } from "fastify";
import { getSecretManager, SecretNotFoundError, SecretAccessDeniedError } from "../services/secretManager.js";
import { logger } from "../utils/log.js";

export async function secretsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/secrets — listar nombres
  app.get("/api/v1/secrets", async (_req, reply) => {
    const sm = getSecretManager();
    const names = sm.list();
    return reply.send({ secrets: names, count: names.length });
  });

  // GET /api/v1/secrets/:name — info (sin el valor)
  app.get<{ Params: { name: string } }>("/api/v1/secrets/:name", async (req, reply) => {
    const sm = getSecretManager();
    const exists = sm.has(req.params.name);
    if (!exists) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `Secret ${req.params.name} not configured` });
    }
    return reply.send({
      name: req.params.name,
      configured: true,
    });
  });

  // POST /api/v1/secrets/:name — guardar valor
  app.post<{ Params: { name: string }; Body: { value: string } }>(
    "/api/v1/secrets/:name",
    async (req, reply) => {
      const value = req.body?.value;
      if (typeof value !== "string" || value.length === 0) {
        return reply.code(400).send({ code: "INVALID", message: "value must be a non-empty string" });
      }
      if (value.length > 4096) {
        return reply.code(400).send({ code: "TOO_LONG", message: "value must be <= 4096 chars" });
      }
      const sm = getSecretManager();
      const deviceId = (req as { auth?: { sub?: string } }).auth?.sub ?? "unknown";
      try {
        sm.set(req.params.name, value, { createdBy: deviceId });
        return reply.send({ ok: true, name: req.params.name });
      } catch (err) {
        logger.error({ err, name: req.params.name }, "Failed to set secret");
        return reply.code(500).send({ code: "INTERNAL", message: "Failed to save secret" });
      }
    }
  );

  // DELETE /api/v1/secrets/:name — borrar
  app.delete<{ Params: { name: string } }>("/api/v1/secrets/:name", async (req, reply) => {
    const sm = getSecretManager();
    const existed = sm.delete(req.params.name);
    return reply.send({ ok: true, existed });
  });

  // POST /api/v1/secrets/test/:name — test que se puede descifrar
  // No devuelve el valor, solo confirma que la desencriptación funciona
  app.post<{ Params: { name: string } }>("/api/v1/secrets/test/:name", async (req, reply) => {
    const sm = getSecretManager();
    try {
      const value = sm.get(req.params.name);
      return reply.send({ ok: true, length: value.length });
    } catch (err) {
      if (err instanceof SecretNotFoundError) {
        return reply.code(404).send({ code: "NOT_FOUND", message: err.message });
      }
      if (err instanceof SecretAccessDeniedError) {
        return reply.code(500).send({ code: "DECRYPT_FAILED", message: err.message });
      }
      throw err;
    }
  });
}
