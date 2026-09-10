// cspHeaders.ts: Content Security Policy + otros headers de seguridad.
//
// v0.60 (P3.3): anade headers defensivos a TODAS las responses:
//   - Content-Security-Policy
//   - X-Content-Type-Options: nosniff
//   - X-Frame-Options: DENY
//   - Strict-Transport-Security
//   - Referrer-Policy
//   - Permissions-Policy

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export interface CspOptions {
  // v0.60: csp es permisivo por default (app local),
  // pero estricto si se sirve web.
  strict: boolean;
  // v0.60: hosts adicionales (ej: tu-dominio.com para connect-src)
  extraConnectSrc: string[];
}

const DEFAULT = { strict: false, extraConnectSrc: [] };

export function registerCspHeaders(app: FastifyInstance, opts: Partial<CspOptions> = {}) {
  const o = { ...DEFAULT, ...opts };
  app.addHook("onSend", async (req: FastifyRequest, reply: FastifyReply, payload) => {
    // CSP
    if (!reply.getHeader("content-security-policy")) {
      const csp = o.strict
        ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' " + o.extraConnectSrc.join(" ") + "; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
        : "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; img-src 'self' data: blob: https:; connect-src 'self' ws: wss: http: https: " + o.extraConnectSrc.join(" ") + "; frame-ancestors 'self';";
      reply.header("Content-Security-Policy", csp);
    }
    // X-Content-Type-Options
    if (!reply.getHeader("x-content-type-options")) {
      reply.header("X-Content-Type-Options", "nosniff");
    }
    // X-Frame-Options
    if (!reply.getHeader("x-frame-options")) {
      reply.header("X-Frame-Options", o.strict ? "DENY" : "SAMEORIGIN");
    }
    // Referrer-Policy
    if (!reply.getHeader("referrer-policy")) {
      reply.header("Referrer-Policy", "no-referrer");
    }
    // Permissions-Policy
    if (!reply.getHeader("permissions-policy")) {
      reply.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    }
    // HSTS (solo si HTTPS, pero siempre lo seteamos para testing)
    if (!reply.getHeader("strict-transport-security")) {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    return payload;
  });
}
