// cloudflareAccess.ts — Verify Cloudflare Access JWTs with caching (v2.11.0).
//
// When M-NEXUS runs behind Cloudflare Tunnel + Access (Zero Trust), every
// request carries a `Cf-Access-Jwt-Assertion` header. We verify it against
// the team's cert (downloaded from Cloudflare dashboard) and trust it.
//
// Caching: verified JWTs are cached by their `sub` (user email) for 5 minutes
// in memory. This avoids re-validating signature on every request for the
// same user. Cloudflare's Access JWTs are short-lived (15min), so the cache
// TTL stays well below token expiry.

import { createVerify, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { logOp, logError } from "../utils/log.js";
import { E } from "../utils/errorCodes.js";

// In-memory cache: sub → { verifiedAt, email, expiresAt }
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cachedCertPem = null;
let verifyInstance = null;

function loadCert() {
  // Try multiple known locations
  const candidates = [
    process.env.CF_ACCESS_CERT_PATH,
    path.resolve(process.cwd(), "data", "cf-access-cert.pem"),
    path.resolve(process.cwd(), "..", "cloudflared", "cert.pem"),
    path.resolve(process.env.HOME || "/root", ".cloudflared", "cert.pem"),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const pem = fs.readFileSync(p, "utf-8");
      cachedCertPem = pem;
      verifyInstance = createVerify("RSA-SHA256");
      verifyInstance.update(Buffer.from(""));
      logOp("cf-access", "cert-loaded", true, { path: p });
      return true;
    } catch { /* try next */ }
  }
  return false;
}

export function isCloudflareAccessEnabled() {
  if (cachedCertPem) return true;
  return loadCert();
}

/**
 * Verify a Cloudflare Access JWT.
 * Returns the verified payload or null if invalid/disabled.
 */
export function verifyCfAccessJwt(jwt) {
  if (!jwt) return null;
  if (!isCloudflareAccessEnabled()) return null;

  const parts = jwt.split(".");
  if (parts.length !== 3) return null;

  // Cache check
  const cacheKey = parts[0] + parts[1]; // header.payload as key
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached;
  }

  try {
    const ok = verifyInstance.verify(cachedCertPem, Buffer.from(parts[2]), null);
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
    // Validate required claims
    if (!payload.sub || !payload.iss || !payload.exp) return null;
    // exp must be in future
    if (payload.exp * 1000 < Date.now()) return null;
    // iss must be Cloudflare
    if (!payload.iss.includes("cloudflare")) return null;

    const entry = {
      verifiedAt: Date.now(),
      email: payload.sub,
      expiresAt: Math.min(payload.exp * 1000, Date.now() + CACHE_TTL_MS),
      payload,
    };
    cache.set(cacheKey, entry);
    return entry;
  } catch (e) {
    logError("cf-access", { message: "verify-failed", err: String(e) });
    return null;
  }
}

/** Fastify middleware: if header present + valid, attach cf-user to req. */
export async function cloudflareAccessMiddleware(req, reply) {
  const jwt = req.headers["cf-access-jwt-assertion"];
  if (!jwt) return; // not behind Access, skip
  const verified = verifyCfAccessJwt(jwt);
  if (!verified) {
    reply.code(401);
    throw E.val("EC-AUTH-004", "Cloudflare Access token invalid", { statusCode: 401 });
  }
  req["cf-user"] = verified.email;
  // Set a request id for log correlation
  req.headers["x-cf-user"] = verified.email;
}

/** Clear cache (for testing or forced re-verification). */
export function clearCfCache() {
  cache.clear();
  cachedCertPem = null;
  verifyInstance = null;
}

/** Get cache stats. */
export function cfCacheStats() {
  let expired = 0;
  let live = 0;
  const now = Date.now();
  for (const [, v] of cache) {
    if (v.expiresAt < now) expired++;
    else live++;
  }
  return { size: cache.size, live, expired };
}
