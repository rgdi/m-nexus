// clip.ts: web clipper endpoint.
//
// v0.60 (P1.4): monta WebClipperService. Acepta HTML directo o URL.
// POST /api/v1/clip/html  - body: { html, url?, title? }
// POST /api/v1/clip/url   - body: { url }  (hace fetch del HTML)
// Devuelve: ClipResult con markdown limpio.

import { FastifyInstance } from "fastify";
import { WebClipperService, type ClipResult } from "../services/webClipperService.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logger, logOp } from "../utils/log.js";

export async function clipRoutes(app: FastifyInstance): Promise<void> {
  // v0.60 (P1.4): clip desde HTML pegado
  app.post<{ Body: { html?: string; url?: string; title?: string } }>(
    "/clip/html",
    async (req) => {
      const { html, url, title } = req.body ?? {};
      if (!html || typeof html !== "string") {
        throw E.val("EC-CLIP-001", "html es requerido", {
          hint: "Send { html: '...', url?: '...', title?: '...' }",
        });
      }
      const r = await safeCallAsync<ClipResult>({
        component: "clip",
        code: "EC-CLIP-002",
        message: "clip html failed",
        context: { htmlLen: html.length, url, titleProvided: !!title },
        op: async () => {
          let result = WebClipperService.htmlToMarkdown(html, url);
          if (title) result = { ...result, title };
          logOp("clip", "html ok", true, {
            contentLen: result.content.length,
            site: result.site,
          });
          return result;
        },
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    },
  );

  // v0.60 (P1.4): clip desde URL (server-side fetch)
  app.post<{ Body: { url?: string } }>(
    "/clip/url",
    async (req) => {
      const { url } = req.body ?? {};
      if (!url || typeof url !== "string") {
        throw E.val("EC-CLIP-003", "url es requerido", {
          hint: "Send { url: 'https://...' }",
        });
      }
      // Validar URL
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw E.val("EC-CLIP-004", "URL invalida", { context: { url } });
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw E.val("EC-CLIP-005", "Solo se permite http/https", { context: { url } });
      }
      const r = await safeCallAsync<ClipResult>({
        component: "clip",
        code: "EC-CLIP-006",
        message: "clip url failed",
        context: { url, host: parsed.host },
        op: async () => {
          const start = Date.now();
          const res = await fetch(url, {
            headers: {
              "User-Agent": "M-NEXUS Web Clipper/0.60 (compatible; like Anki)",
              "Accept": "text/html,application/xhtml+xml",
            },
            signal: AbortSignal.timeout(15_000), // 15s timeout
          });
          if (!res.ok) {
            throw E.val("EC-CLIP-007", `HTTP ${res.status} en fetch`, {
              context: { url, status: res.status },
            });
          }
          const html = await res.text();
          const result = WebClipperService.htmlToMarkdown(html, url);
          logOp("clip", "url ok", true, {
            url, htmlLen: html.length,
            contentLen: result.content.length, ms: Date.now() - start,
          });
          return result;
        },
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    },
  );

  // v0.60 (P1.4): info endpoint
  app.get("/clip/info", async () => {
    return {
      endpoints: {
        "POST /api/v1/clip/html": "Body: { html, url?, title? }. Devuelve ClipResult con markdown.",
        "POST /api/v1/clip/url":  "Body: { url }. Hace server-side fetch + clip.",
      },
      formats: ["markdown"],
      version: "0.60",
    };
  });
}
