// corsPolicy.ts: lista de origins permitidos (Fase 6 security fix).
//
// v0.46: bug del auditor #8 — `cors: { origin: true, credentials: true }` refleja
// cualquier origin. Si en el futuro se mete auth por cookie, esto es vulnerable a CSRF.
//
// Solución: whitelist explícita de origins permitidos via env var.
// Default: solo localhost (dev) + capacitor (app nativa).
// En producción, el operador define CORS_ALLOWED_ORIGINS=https://app.mnexus.io,https://admin.mnexus.io

import { config } from "../config.js";

/**
 * Origins permitidos por defecto (dev + app nativa).
 * - localhost variants: para web local
 * - capacitor://localhost: para app móvil Android/iOS
 * - file://: para PWA standalone
 */
const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "http://localhost:3000",     // Next.js / Vite dev
  "http://localhost:4000",     // Backend mismo (self)
  "http://localhost:5173",     // Vite default
  "http://localhost:8080",     // Webpack/Vue
  "http://127.0.0.1:3000",
  "http://127.0.0.1:4000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8080",
  "capacitor://localhost",     // Capacitor iOS/Android
  "ionic://localhost",          // Ionic
  "http://localhost",           // Web fallback
];

/**
 * Lee CORS_ALLOWED_ORIGINS de env (comma-separated) o devuelve defaults.
 * Si CORS_ALLOWED_ORIGINS=* → rechaza en runtime con error explícito
 * (porque credentials:true + origin:* es la combinación insegura que el auditor señaló).
 */
export function getAllowedOrigins(): string[] {
  const envValue = process.env.CORS_ALLOWED_ORIGINS;
  if (envValue === undefined || envValue.trim() === "") {
    return [...DEFAULT_ALLOWED_ORIGINS];
  }
  if (envValue.trim() === "*") {
    // El auditor lo dijo: credentials + * es un anti-patrón.
    // En vez de tirar el server, log warning y usar defaults seguros.
    console.warn(
      "[CORS] CORS_ALLOWED_ORIGINS=* is dangerous with credentials:true. Using safe defaults."
    );
    return [...DEFAULT_ALLOWED_ORIGINS];
  }
  return envValue
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

/**
 * Decide si un origin request debe ser permitido.
 *
 * Reglas:
 * 1. Sin origin (mismo origen, server-to-server, curl): permitido
 * 2. Origin en whitelist: permitido + reflected en Access-Control-Allow-Origin
 * 3. Origin no en whitelist: NO permitido
 *
 * Importante: NO devuelve "true"/"*" — siempre un origin específico o vacío.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin || origin === "null") {
    // Mismo origen o request sin Origin header (curl, server-to-server)
    return true;
  }
  const allowed = getAllowedOrigins();
  return allowed.includes(origin);
}

/**
 * CORS origin callback para @fastify/cors.
 * Fastify lo llama por request: (origin, cb) => cb(err, allowed)
 *
 * - Si origin es null/empty → permite (same-origin, curl)
 * - Si origin está en whitelist → refleja (devuelve el origin exacto)
 * - Si no → bloquea con error
 */
export function corsOriginCallback(
  origin: string | undefined,
  cb: (err: Error | null, allow: string | boolean) => void
): void {
  if (isOriginAllowed(origin)) {
    // Devolver el origin exacto (no true genérico) para que Access-Control-Allow-Origin
    // refleje el origin permitido, en vez de "*" (que es el bug original)
    cb(null, origin ?? true);
  } else {
    // Bloqueado: pasamos AMBOS (err + allow=false) para que la aserción del test
    // detecte el rechazo incluso si el caller no chequea err.
    cb(new Error(`CORS: origin '${origin}' not in whitelist`), false);
  }
}
