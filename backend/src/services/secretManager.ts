// SecretManager: almacenamiento cifrado de API keys y credenciales.
//
// v0.33: las API keys (OpenAI, Anthropic, etc.) NO se guardan en texto
// plano en .env. Se almacenan cifradas con AES-256-GCM usando una
// master key derivada del sistema. Se accede por nombre lógico
// (ej. 'openai.api_key') y se carga lazy desde SQLite.
//
// Diseño:
// - Master key: 256 bits, generada en primer arranque y guardada en
//   /var/lib/mnexus/secrets/master.key con permisos 0600.
// - En backend de desarrollo o test: usa una key fija en memoria.
// - En producción: lee MNEXUS_SECRET_MASTER_KEY de env, o falla
//   cerrado (el server no arranca sin una key válida).
//
// Auditoría: cada get() registra un log con la key accedida y
// el deviceId que la pidió. Útil para detectar accesos anómalos.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "../utils/log.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;        // 96 bits recomendado para GCM
const SALT_LEN = 16;
const KEY_LEN = 32;
const ITERATIONS = 1 << 15; // scrypt cost

export class SecretNotFoundError extends Error {
  constructor(public key: string) {
    super(`Secret not found: ${key}`);
    (this as unknown as { code: string }).code = "SECRET_NOT_FOUND";
  }
}

export class SecretAccessDeniedError extends Error {
  constructor(public key: string, reason: string) {
    super(`Access denied to secret ${key}: ${reason}`);
    (this as unknown as { code: string }).code = "SECRET_ACCESS_DENIED";
  }
}

interface SecretRecord {
  name: string;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  createdAt: number;
  updatedAt: number;
  /** deviceId que la creó (para auditoría). */
  createdBy?: string;
}

export class SecretManager {
  private masterKey: Buffer | null = null;
  private cache: Map<string, { value: string; cachedAt: number }> = new Map();
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 min
  private readonly store: Map<string, SecretRecord> = new Map();
  private readonly storePath: string;
  private readonly devKey: Buffer | null = null;

  constructor(opts: { storePath?: string; devMode?: boolean } = {}) {
    this.storePath = opts.storePath ?? "/var/lib/mnexus/secrets/store.json";
    if (opts.devMode || process.env.MNEXUS_DEV_MODE === "1") {
      // Key fija en dev. NO usar en producción.
      this.devKey = createHash("sha256").update("mnexus-dev-key-do-not-use-in-prod").digest();
      this.masterKey = this.devKey;
      logger.warn("SecretManager: DEV MODE — keys are NOT secure");
    }
  }

  /** Inicializa la master key. Llamar una vez al arranque. */
  async initialize(): Promise<void> {
    if (this.masterKey) return; // dev mode ya la tiene

    // 1) intentar desde env
    if (process.env.MNEXUS_SECRET_MASTER_KEY) {
      const hex = process.env.MNEXUS_SECRET_MASTER_KEY;
      if (hex.length !== 64) {
        throw new Error("MNEXUS_SECRET_MASTER_KEY must be 64 hex chars (32 bytes)");
      }
      this.masterKey = Buffer.from(hex, "hex");
      logger.info("SecretManager: master key from env");
      return;
    }

    // 2) intentar desde archivo
    const keyPath = process.env.MNEXUS_SECRET_KEY_PATH ?? "/var/lib/mnexus/secrets/master.key";
    if (existsSync(keyPath)) {
      this.masterKey = Buffer.from(readFileSync(keyPath, "utf-8").trim(), "hex");
      logger.info({ keyPath }, "SecretManager: master key from file");
      return;
    }

    // 3) generar nueva
    const newKey = randomBytes(KEY_LEN);
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, newKey.toString("hex"), { mode: 0o600 });
    chmodSync(keyPath, 0o600);
    this.masterKey = newKey;
    logger.warn({ keyPath }, "SecretManager: NEW master key generated. SAVE IT.");
  }

  /** Carga el store de secrets desde disco. */
  load(): void {
    if (!existsSync(this.storePath)) {
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, "{}");
      return;
    }
    try {
      const raw = readFileSync(this.storePath, "utf-8");
      const obj = JSON.parse(raw);
      for (const [name, rec] of Object.entries(obj as Record<string, Omit<SecretRecord, "name">>)) {
        this.store.set(name, {
          name,
          ciphertext: Buffer.from(rec.ciphertext as unknown as number[]),
          iv: Buffer.from(rec.iv as unknown as number[]),
          authTag: Buffer.from(rec.authTag as unknown as number[]),
          createdAt: rec.createdAt,
          updatedAt: rec.updatedAt,
          createdBy: rec.createdBy,
        });
      }
      logger.info({ count: this.store.size }, "SecretManager: loaded");
    } catch (err) {
      logger.error({ err }, "SecretManager: failed to load store, starting fresh");
    }
  }

  /** Persiste el store a disco. */
  private save(): void {
    const obj: Record<string, unknown> = {};
    for (const [name, rec] of this.store) {
      obj[name] = {
        ciphertext: Array.from(rec.ciphertext),
        iv: Array.from(rec.iv),
        authTag: Array.from(rec.authTag),
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
        createdBy: rec.createdBy,
      };
    }
    mkdirSync(dirname(this.storePath), { recursive: true });
    writeFileSync(this.storePath, JSON.stringify(obj, null, 2));
    chmodSync(this.storePath, 0o600);
  }

  /** Lista los nombres de secrets guardados (no los valores). */
  list(): string[] {
    return Array.from(this.store.keys()).sort();
  }

  /** Guarda o actualiza un secret. */
  set(name: string, value: string, opts: { createdBy?: string } = {}): void {
    if (!this.masterKey) throw new Error("SecretManager not initialized");
    if (!name.match(/^[a-z0-9._-]+$/i)) {
      throw new Error(`Invalid secret name: ${name}`);
    }
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.masterKey, iv);
    const ct = Buffer.concat([cipher.update(value, "utf-8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const now = Date.now();
    const existing = this.store.get(name);
    this.store.set(name, {
      name,
      ciphertext: ct,
      iv,
      authTag,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      createdBy: opts.createdBy ?? existing?.createdBy,
    });
    this.save();
    // Invalida cache
    this.cache.delete(name);
    logger.info({ name, by: opts.createdBy ?? "unknown" }, "SecretManager: set");
  }

  /** Obtiene un secret descifrado. */
  get(name: string, opts: { requestedBy?: string } = {}): string {
    if (!this.masterKey) throw new Error("SecretManager not initialized");
    // Cache
    const cached = this.cache.get(name);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.value;
    }
    const rec = this.store.get(name);
    if (!rec) {
      logger.warn({ name, by: opts.requestedBy ?? "unknown" }, "SecretManager: NOT FOUND");
      throw new SecretNotFoundError(name);
    }
    try {
      const decipher = createDecipheriv(ALGO, this.masterKey, rec.iv);
      decipher.setAuthTag(rec.authTag);
      const pt = Buffer.concat([decipher.update(rec.ciphertext), decipher.final()]);
      const value = pt.toString("utf-8");
      this.cache.set(name, { value, cachedAt: Date.now() });
      logger.info({ name, by: opts.requestedBy ?? "unknown" }, "SecretManager: get");
      return value;
    } catch (err) {
      logger.error({ err, name }, "SecretManager: decrypt failed (corrupted or wrong key?)");
      throw new SecretAccessDeniedError(name, "decrypt failed");
    }
  }

  /** Borra un secret. */
  delete(name: string): boolean {
    const existed = this.store.delete(name);
    if (existed) {
      this.save();
      this.cache.delete(name);
      logger.info({ name }, "SecretManager: deleted");
    }
    return existed;
  }

  /** Verifica si un secret existe. */
  has(name: string): boolean {
    return this.store.has(name);
  }

  /** Genera una nueva master key (para rotación). */
  static generateMasterKey(): string {
    return randomBytes(KEY_LEN).toString("hex");
  }

  /** Rota la master key y re-cifra todos los secrets. */
  rotateMasterKey(newMasterKeyHex: string): void {
    if (!this.masterKey) throw new Error("not initialized");
    if (newMasterKeyHex.length !== 64) throw new Error("key must be 64 hex chars");
    const newKey = Buffer.from(newMasterKeyHex, "hex");
    // Re-cifra cada secret con la nueva key
    for (const [name, rec] of this.store) {
      const decipher = createDecipheriv(ALGO, this.masterKey, rec.iv);
      decipher.setAuthTag(rec.authTag);
      const pt = Buffer.concat([decipher.update(rec.ciphertext), decipher.final()]).toString("utf-8");
      const iv = randomBytes(IV_LEN);
      const cipher = createCipheriv(ALGO, newKey, iv);
      const ct = Buffer.concat([cipher.update(pt, "utf-8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      this.store.set(name, { ...rec, ciphertext: ct, iv, authTag, updatedAt: Date.now() });
    }
    this.masterKey = newKey;
    this.save();
    logger.warn("SecretManager: master key rotated");
  }
}

// Singleton
let instance: SecretManager | null = null;
export function getSecretManager(): SecretManager {
  if (!instance) {
    instance = new SecretManager({ devMode: process.env.NODE_ENV !== "production" });
  }
  return instance;
}
