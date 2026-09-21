/* ============================================================
 * routes/anki.ts — REST endpoints for Anki .apkg import / export.
 *
 * v2.27.0 — bidirectional bridge con Anki.
 *
 *   POST /api/v1/anki/import           (multipart: file field=apkg)
 *                                      → preview: { cards, stats }
 *                                      No persiste aún — usuario confirma.
 *   POST /api/v1/anki/import/commit    (body: { cards: [...] })
 *                                      → persiste a flashcards.json
 *   POST /api/v1/anki/export           (body: { deckName?, includeRevlog? })
 *                                      → response: .apkg buffer (base64)
 *                                      Toma cards desde flashcards.json
 * ============================================================ */

import { FastifyInstance } from "fastify";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { exportApkg, importApkg, persistImported } from "../services/anki.js";
import { E } from "../utils/errorCodes.js";

const FLASHCARDS_FILE = join(process.cwd(), "data", "flashcards.json");

export async function ankiRoutes(app: FastifyInstance): Promise<void> {
  /* ============================================================
   * POST /anki/import — preview
   * multipart/form-data with field "apkg"
   * Returns parsed cards + stats. Does NOT persist.
   * ============================================================ */
  app.post("/anki/import", async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: "Expected multipart/form-data with field 'apkg'" });
    }
    let buf: Buffer | null = null;
    let filename = "";
    try {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === "file" && part.fieldname === "apkg") {
          filename = part.filename ?? "upload.apkg";
          const chunks: Buffer[] = [];
          for await (const c of part.file) chunks.push(c as Buffer);
          buf = Buffer.concat(chunks);
        }
      }
    } catch (e) {
      return reply.code(400).send({ error: "Failed to read upload", detail: String(e) });
    }
    if (!buf) {
      return reply.code(400).send({ error: "No file uploaded as 'apkg' field" });
    }
    if (!/\.apkg$/i.test(filename)) {
      return reply.code(400).send({ error: "File must be .apkg" });
    }
    try {
      const result = await importApkg(buf);
      return {
        ok: true,
        filename,
        stats: result.stats,
        cards: result.cards,
      };
    } catch (e: any) {
      return reply.code(400).send({ error: "Failed to parse .apkg", detail: e?.message ?? String(e) });
    }
  });

  /* ============================================================
   * POST /anki/import/commit — persist previewed cards
   * Body: { cards: MxFlashcard[] }
   * ============================================================ */
  app.post<{ Body: { cards: any[] } }>("/anki/import/commit", async (req, reply) => {
    const cards = req.body?.cards;
    if (!Array.isArray(cards) || cards.length === 0) {
      return reply.code(400).send({ error: "No cards to commit" });
    }
    const result = await persistImported(cards);
    return { ok: true, persisted: result.cards.length, total: result.total };
  });

  /* ============================================================
   * POST /anki/export — export to .apkg
   * Body: { deckName?, includeRevlog?, scope?: { subject?, tag? } }
   * Returns base64-encoded .apkg bytes
   * ============================================================ */
  app.post<{ Body: { deckName?: string; includeRevlog?: boolean; scope?: { subject?: string; tag?: string } } }>(
    "/anki/export",
    async (req, reply) => {
      let list: any[] = [];
      try {
        const buf = await fs.readFile(FLASHCARDS_FILE, "utf-8");
        list = JSON.parse(buf);
      } catch {
        return reply.code(404).send({ error: "No flashcards to export" });
      }
      const scope = req.body?.scope;
      if (scope?.subject) list = list.filter((c) => c.subject === scope.subject);
      if (scope?.tag) list = list.filter((c) => Array.isArray(c.tags) && c.tags.includes(scope.tag));
      if (list.length === 0) return reply.code(404).send({ error: "No cards match scope" });
      const result = exportApkg({
        cards: list,
        deckName: req.body?.deckName,
        includeRevlog: !!req.body?.includeRevlog,
      });
      // Return base64-encoded bytes (client downloads as .apkg).
      return {
        ok: true,
        cardCount: result.cardCount,
        notes: result.notes,
        apkgBytesBase64: result.apkgBytes.toString("base64"),
        filename: (req.body?.deckName ?? "m-nexus") + ".apkg",
      };
    },
  );

  /* ============================================================
   * GET /anki/info — check if .apkg support is available (always true here)
   * ============================================================ */
  app.get("/anki/info", async () => ({
    ok: true,
    supported: ["collection-json", "collection-anki2"],
    cardTypes: ["basic", "cloze"],
    maxUploadMb: 50,
  }));
}
