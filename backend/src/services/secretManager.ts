// SecretManager: almacenamiento cifrado de API keys y credenciales.
//
// v0.33: las API keys (OpenAI, Anthropic, etc.) NO se guardan en texto
// plano en .env. Se almacenan cifradas con AES-256-GCM usando una
// master key derivada del sistema. Se accede por nombre lógico
// (ej. 'openai.api_key') y se carga lazy desde SQLite.
//
// v0.45: error codes estructurados (EC-SEC-*) con safeCall.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { logger, logOp, logLifecycle } from "../utils/log.js";
import { E } from "../utils/errorCodes.js";
import { safeCall, safeCallAsync } from "../utils/safeCall.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const SALT_LEN = 16;
const KEY_LEN = 32;
const ITERATIONS = 1 << 15;

interface SecretRecord {
  name: string;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
}

export class SecretNotFoundError extends Error {
  readonly code = "EC-SEC-001";
  readonly category = "SEC";
  constructor(public key: string) {
    super(`Secret not found: ${key}`);
    this.name = "SecretNotFoundError";
  }
}

export class SecretAccessDeniedError extends Error {
  readonly code = "EC-SEC-002";
  readonly category = "SEC";
  constructor(public key: string, public reason: string) {
    super(`Access denied to secret ${key}: ${reason}`);
    this.name = "SecretAccessDeniedError";
  }
}

export class SecretManager {
  private masterKey: Buffer | null = null;
  private cache: Map<string, { value: string; cachedAt: number }> = new Map();
  private readonly cacheTtlMs = 5 * 60 * 1000;
  private readonly store: Map<string, SecretRecord> = new Map();
  private readonly storePath: string;

  constructor(opts: { storePath?: string; devMode?: boolean } = {}) {
    this.storePath = opts.storePath ?? "/var/lib/mnexus/secrets/store.json";
    if (opts.devMode || process.env.MNEXUS_DEV_MODE === "1") {
      const devKey = createHash("sha256").update("mnexus-dev-key-do-not-use-in-prod").digest();
      this.masterKey = devKey;
      logger.warn("SecretManager: DEV MODE — keys are NOT secure");
    }
  }

  /** Inicializa la master key. Llamar una vez al arranque. */
  async initialize(): Promise<void> {
    if (this.masterKey) return;

    await safeCallAsync({
      component: "sec",
      code: "EC-SEC-003",
      message: "initialize failed",
      op: async () => {
        // 1) intentar desde env
        if (process.env.MNEXUS_SECRET_MASTER_KEY) {
          const hex = process.env.MNEXUS_SECRET_MASTER_KEY;
          if (hex.length !== 64) {
            throw E.sec("EC-SEC-004", "MNEXUS_SECRET_MASTER_KEY must be 64 hex chars (32 bytes)", {
              context: { hexLen: hex.length, expected: 64 },
              hint: "Set MNEXUS_SECRET_MASTER_KEY to a 32-byte (64 hex) key",
            });
          }
          this.masterKey = Buffer.from(hex, "hex");
          logLifecycle("SecretManager", "master key from env");
          return;
        }
        // 2) intentar desde archivo
        const keyPath = process.env.MNEXUS_SECRET_KEY_PATH ?? "/var/lib/mnexus/secrets/master.key";
        if (existsSync(keyPath)) {
          this.masterKey = Buffer.from(readFileSync(keyPath, "utf-8").trim(), "hex");
          logLifecycle("SecretManager", "master key from file", { keyPath });
          return;
        }
        // 3) generar nueva
        const newKey = randomBytes(KEY_LEN);
        mkdirSync(dirname(keyPath), { recursive: true });
        writeFileSync(keyPath, newKey.toString("hex"), { mode: 0o600 });
        chmodSync(keyPath, 0o600);
        this.masterKey = newKey;
        logLifecycle("SecretManager", "NEW master key generated. SAVE IT.", { keyPath });
      },
    });
  }

  /** Carga el store de secrets desde disco. */
  load(): void {
    safeCall<void>({
      component: "sec",
      code: "EC-SEC-005",
      message: "load failed",
      context: { storePath: this.storePath },
      op: () => {
        if (!existsSync(this.storePath)) {
          mkdirSync(dirname(this.storePath), { recursive: true });
          writeFileSync(this.storePath, "{}");
          logLifecycle("SecretManager", "store created", { storePath: this.storePath });
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
          logLifecycle("SecretManager", "loaded", { count: this.store.size });
        } catch (err) {
          // OK: empezar fresh, pero loguear
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, "SecretManager: failed to load store, starting fresh");
        }
      },
    });
  }

  /** Persiste el store a disco. */
  private save(): void {
    safeCall<void>({
      component: "sec",
      code: "EC-SEC-006",
      message: "save failed",
      context: { storePath: this.storePath, count: this.store.size },
      op: () => {
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
      },
    });
  }

  /** Lista los nombres de secrets guardados (no los valores). */
  list(): string[] {
    return safeCall<string[]>({
      component: "sec",
      code: "EC-SEC-007",
      message: "list failed",
      op: () => Array.from(this.store.keys()).sort(),
    }).value ?? [];
  }

  /** Guarda o actualiza un secret. */
  set(name: string, value: string, opts: { createdBy?: string } = {}): void {
    if (!this.masterKey) {
      throw E.sec("EC-SEC-008", "SecretManager not initialized", {
        hint: "Call initialize() first",
      });
    }
    if (!name.match(/^[a-z0-9._-]+$/i)) {
      throw E.val("EC-SEC-009", "Invalid secret name", {
        context: { name },
        hint: "Use lowercase alphanumeric, dot, underscore, or dash",
      });
    }
    safeCall<void>({
      component: "sec",
      code: "EC-SEC-010",
      message: "set failed",
      context: { name, by: opts.createdBy ?? "unknown", valueLen: value.length },
      op: () => {
        const iv = randomBytes(IV_LEN);
        const cipher = createCipheriv(ALGO, this.masterKey!, iv);
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
        this.cache.delete(name);
        logOp("sec", "set", true, { name, by: opts.createdBy ?? "unknown" });
      },
    });
  }

  /** Obtiene un secret descifrado. */
  get(name: string, opts: { requestedBy?: string } = {}): string {
    if (!this.masterKey) {
      throw E.sec("EC-SEC-011", "SecretManager not initialized", {
        hint: "Call initialize() first",
      });
    }
    const cached = this.cache.get(name);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.value;
    }
    return safeCall<string>({
      component: "sec",
      code: "EC-SEC-012",
      message: "get failed",
      context: { name, by: opts.requestedBy ?? "unknown" },
      op: () => {
        const rec = this.store.get(name);
        if (!rec) {
          logOp("sec", "get: NOT FOUND", false, { name, by: opts.requestedBy ?? "unknown" });
          throw new SecretNotFoundError(name);
        }
        try {
          const decipher = createDecipheriv(ALGO, this.masterKey!, rec.iv);
          decipher.setAuthTag(rec.authTag);
          const pt = Buffer.concat([decipher.update(rec.ciphertext), decipher.final()]);
          const value = pt.toString("utf-8");
          this.cache.set(name, { value, cachedAt: Date.now() });
          logOp("sec", "get", true, { name, by: opts.requestedBy ?? "unknown" });
          return value;
        } catch (err) {
          logOp("sec", "get: decrypt failed", false, { name, err: err instanceof Error ? err.message : String(err) });
          throw new SecretAccessDeniedError(name, "decrypt failed (corrupted or wrong key?)");
        }
      },
    }).value!;
  }

  /** Borra un secret. */
  delete(name: string): boolean {
    return safeCall<boolean>({
      component: "sec",
      code: "EC-SEC-013",
      message: "delete failed",
      context: { name },
      op: () => {
        const existed = this.store.delete(name);
        if (existed) {
          this.save();
          this.cache.delete(name);
          logOp("sec", "delete", true, { name });
        }
        return existed;
      },
    }).value ?? false;
  }

  /** Verifica si un secret existe. */
  has(name: string): boolean {
    return safeCall<boolean>({
      component: "sec",
      code: "EC-SEC-014",
      message: "has failed",
      context: { name },
      op: () => this.store.has(name),
    }).value ?? false;
  }

  /** Genera una nueva master key (para rotación). */
  static generateMasterKey(): string {
    return safeCall<string>({
      component: "sec",
      code: "EC-SEC-015",
      message: "generateMasterKey failed",
      op: () => randomBytes(KEY_LEN).toString("hex"),
    }).value!;
  }

  /** Rota la master key y re-cifra todos los secrets. */
  rotateMasterKey(newMasterKeyHex: string): void {
    if (!this.masterKey) {
      throw E.sec("EC-SEC-016", "SecretManager not initialized", { hint: "Call initialize() first" });
    }
    if (newMasterKeyHex.length !== 64) {
      throw E.val("EC-SEC-017", "Invalid key length", { context: { hexLen: newMasterKeyHex.length, expected: 64 } });
    }
    safeCall<void>({
      component: "sec",
      code: "EC-SEC-018",
      message: "rotateMasterKey failed",
      context: { count: this.store.size },
      op: () => {
        const newKey = Buffer.from(newMasterKeyHex, "hex");
        for (const [name, rec] of this.store) {
          const decipher = createDecipheriv(ALGO, this.masterKey!, rec.iv);
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
        logLifecycle("SecretManager", "master key rotated");
      },
    });
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
