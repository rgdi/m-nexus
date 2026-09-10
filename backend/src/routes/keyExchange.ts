// keyExchange.ts: rutas para intercambio de claves E2E (v0.61.1)
import { FastifyInstance } from "fastify";
import { getKeyExchangeService } from "../services/keyExchangeService.js";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";

export async function keyExchangeRoutes(app: FastifyInstance): Promise<void> {
  const svc = getKeyExchangeService();

  /// v0.61.1: genera par de claves para el usuario.
  app.post<{ Body: { userId: string } }>("/e2e/keygen", async (req) => {
    const b = req.body ?? {} as any;
    if (!b.userId) throw E.val("EC-E2E-001", "userId requerido", { context: { body: b } });
    const kp = svc.generateKeyPair();
    logOp("e2e", "keygen", true, { userId: b.userId, fingerprint: kp.fingerprint });
    return {
      userId: b.userId,
      publicKey: kp.publicKey,
      privateKey: kp.privateKey, // v0.61.1: en prod NUNCA devolver. Solo para test
      fingerprint: kp.fingerprint,
      createdAt: kp.createdAt,
    };
  });

  /// v0.61.1: encrypt con shared secret.
  app.post<{ Body: { privateKey: string; theirPublicKey: string; plaintext: string; salt?: string } }>(
    "/e2e/encrypt", async (req) => {
      const b = req.body ?? {} as any;
      if (!b.privateKey || !b.theirPublicKey || b.plaintext == null) {
        throw E.val("EC-E2E-002", "privateKey, theirPublicKey, plaintext requeridos", { context: { body: b } });
      }
      try {
        const shared = svc.computeSharedSecret(b.privateKey, b.theirPublicKey);
        const salt = b.salt ? Buffer.from(b.salt, "base64") : undefined;
        const result = svc.encrypt(shared, b.plaintext, salt);
        logOp("e2e", "encrypt", true, { len: b.plaintext.length });
        return { encrypted: result.message, salt: result.salt };
      } catch (e) {
        throw E.val("EC-E2E-003", "Error encriptando: " + (e as Error).message, { context: { body: b } });
      }
    },
  );

  /// v0.61.1: decrypt con shared secret.
  app.post<{
    Body: { privateKey: string; theirPublicKey: string; salt: string; encrypted: any };
  }>("/e2e/decrypt", async (req) => {
    const b = req.body ?? {} as any;
    if (!b.privateKey || !b.theirPublicKey || !b.salt || !b.encrypted) {
      throw E.val("EC-E2E-004", "Faltan campos", { context: { body: b } });
    }
    try {
      const shared = svc.computeSharedSecret(b.privateKey, b.theirPublicKey);
      const salt = Buffer.from(b.salt, "base64");
      const pt = svc.decrypt(shared, b.encrypted, salt);
      logOp("e2e", "decrypt", true, { len: pt.length });
      return { plaintext: pt };
    } catch (e) {
      throw E.val("EC-E2E-005", "Error decrypt: " + (e as Error).message, { context: { err: (e as Error).message } });
    }
  });

  /// v0.61.1: fingerprint de una publica.
  app.post<{ Body: { publicKey: string } }>("/e2e/fingerprint", async (req) => {
    const b = req.body ?? {} as any;
    if (!b.publicKey) throw E.val("EC-E2E-006", "publicKey requerido", { context: { body: b } });
    return { fingerprint: svc.fingerprint(b.publicKey) };
  });

  app.get("/e2e/info", async () => ({
    algorithm: "ECDH-P256 + AES-256-GCM + HKDF-SHA256",
    version: "v0.61.1",
    keySize: 256,
    curve: "P-256",
  }));
}
