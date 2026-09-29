// routes/folderRag.ts — v2.38.0 folder-scoped retrieval.
//
//   GET  /api/v1/rag/folders            — picker: every folder + chunk count
//   POST /api/v1/rag/ask                — { question, folderId?, shallow?, useLlm? }
//     Returns the sub-searches the planner produced, so the UI can show
//     "how this was looked up" instead of an opaque answer.
//   POST /api/v1/rag/reindex            — drop the cache and rebuild
//
// The index lives server-side. The client no longer decides what the
// model sees, so two devices asking the same question about the same
// folder get the same answer — which is the entire point of grounding
// the answer in a folder.
//
// The `folderId` filter is a hard scope, not a ranking hint: a question
// about Genetics never returns a Chemistry passage, however similar.

import type { FastifyInstance } from "fastify";
import { ask, folderStats, invalidateIndex, buildIndex } from "../services/folderRag.js";
import { logOp } from "../utils/log.js";
import { E } from "../utils/errorCodes.js";

export function registerFolderRagRoutes(app: FastifyInstance): void {
  app.get("/api/v1/rag/folders", async () => {
    return folderStats();
  });

  app.post<{
    Body: {
      question?: string;
      folderId?: string | null;
      shallow?: boolean;
      useLlm?: boolean;
      limit?: number;
      /** Conversation so far; the planner resolves "¿y por qué?" with it. */
      history?: Array<{ role: "user" | "assistant"; text: string }>;
      /** Opt-in web fallback. Off unless the client asks. */
      allowWeb?: boolean;
    };
  }>("/api/v1/rag/ask", async (req) => {
    const b = req.body ?? {};
    const question = String(b.question ?? "").trim();
    if (!question) {
      throw E.val("EC-RAG-001", "question requerida", { statusCode: 400 });
    }
    const result = await ask(question, {
      folderId: b.folderId ?? null,
      shallow: b.shallow === true,
      useLlm: b.useLlm === true,
      ...(Array.isArray(b.history) ? { history: b.history.slice(-6) } : {}),
      ...(b.allowWeb === true ? { allowWeb: true } : {}),
      ...(typeof b.limit === "number" ? { limit: b.limit } : {}),
    });
    return result;
  });

  // Cheap endpoint the UI can hit on a timer to tell the user how
  // current the index is, instead of guessing.
  app.get("/api/v1/rag/status", async () => {
    const idx = await buildIndex();
    return {
      builtAt: idx.builtAt,
      notes: idx.notes,
      chunks: idx.chunks.length,
      folders: idx.folders.size,
    };
  });

  app.post("/api/v1/rag/reindex", async () => {
    invalidateIndex();
    const idx = await buildIndex(true);
    logOp("rag", "reindexed", true, { notes: idx.notes, chunks: idx.chunks.length });
    return { ok: true, notes: idx.notes, chunks: idx.chunks.length, builtAt: idx.builtAt };
  });
}
