// routes/import.ts: import endpoints (PDF, Anki APKG, Notion, Roam).
// v0.49.2: routes para que el client pueda importar archivos.
//
// POST /api/v1/import/analyze   - Analiza un archivo y devuelve preview
// POST /api/v1/import/execute   - Ejecuta la importacion y devuelve stats
// GET  /api/v1/import/formats    - Lista formatos soportados

import { FastifyInstance } from "fastify";
import { ImportService, type ImportResult } from "../services/importService.js";
import { join } from "node:path";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";

interface AnalyzeBody {
  filePath?: string;
  filename?: string;
}

interface ExecuteBody {
  filePath?: string;
  filename?: string;
  vaultPath?: string;
  /** Cuando true, las flashcards importadas se aprueban automaticamente */
  autoApprove?: boolean;
  /** Carpeta destino dentro del vault */
  destFolder?: string;
}

interface FormatInfo {
  id: string;
  name: string;
  extensions: string[];
  description: string;
  features: string[];
}

const FORMATS: FormatInfo[] = [
  {
    id: "anki",
    name: "Anki (.apkg)",
    extensions: [".apkg"],
    description: "Decks exportados de Anki o AnkiWeb. Formato .apkg (zip con SQLite).",
    features: ["cards", "tags", "deck-metadata", "media"],
  },
  {
    id: "pdf",
    name: "PDF (.pdf)",
    extensions: [".pdf"],
    description: "Documentos PDF. Cada pagina se convierte en una nota markdown.",
    features: ["notes", "ocr", "tables"],
  },
  {
    id: "notion",
    name: "Notion (.zip)",
    extensions: [".zip"],
    description: "Export de Notion en formato zip con CSV + markdown.",
    features: ["notes", "databases", "images"],
  },
  {
    id: "roam",
    name: "Roam Research (.json)",
    extensions: [".json"],
    description: "Export JSON de Roam Research con paginas y blocks.",
    features: ["notes", "block-references", "tags"],
  },
  {
    id: "obsidian",
    name: "Obsidian (.zip)",
    extensions: [".zip"],
    description: "Vault de Obsidian comprimido en zip. Extrae notas + adjuntos.",
    features: ["notes", "wikilinks", "attachments"],
  },
];

export async function importRoutes(app: FastifyInstance): Promise<void> {
  const service = new ImportService();

  // Lista formatos soportados
  app.get("/api/v1/import/formats", async (_req, reply) => {
    return reply.send({ formats: FORMATS });
  });

  // Analiza un archivo: detecta formato, cuenta notas/cards, devuelve preview
  app.post("/api/v1/import/analyze", async (req, reply) => {
    const body = (req.body ?? {}) as AnalyzeBody;
    if (!body.filePath) {
      return reply.code(400).send({ code: "EC-FS-101", message: "filePath required" });
    }

    return safeCallAsync(
      {
        component: "import",
        code: "EC-IMPORT-001",
        message: "analyze failed",
        context: { filePath: body.filePath, filename: body.filename },
        op: async () => {
          const ext = body.filePath!.substring(body.filePath!.lastIndexOf(".")).toLowerCase();
          const format = FORMATS.find((f) => f.extensions.includes(ext));

          if (!format) {
            return {
              supported: false,
              extension: ext,
              message: `Extension ${ext} not supported. Supported: ${FORMATS.map((f) => f.extensions.join(",")).join(" ")}`,
            };
          }

          const stats: any = {
            format: format.id,
            formatName: format.name,
            filename: body.filename || body.filePath!.split("/").pop(),
            features: format.features,
            estimatedNotes: 0,
            estimatedCards: 0,
          };

          if (ext === ".apkg") {
            try {
              const fs = await import("node:fs");
              const buf = fs.readFileSync(body.filePath!);
              const isSqlite = buf.includes(Buffer.from("SQLite format"));
              stats.isSqlite = isSqlite;
              stats.fileSize = buf.length;
              if (isSqlite) {
                stats.estimatedCards = "ready (will parse on execute)";
              }
            } catch (e) {
              stats.estimatedCards = "error: " + (e as Error).message;
            }
          }

          return { supported: true, ...stats };
        },
      },
    );
  });

  // Ejecuta la importacion
  app.post("/api/v1/import/execute", async (req, reply) => {
    const body = (req.body ?? {}) as ExecuteBody;
    if (!body.filePath) {
      return reply.code(400).send({ code: "EC-FS-102", message: "filePath required" });
    }

    return safeCallAsync<any>(
      {
        component: "import",
        code: "EC-IMPORT-002",
        message: "execute failed",
        context: {
          filePath: body.filePath,
          filename: body.filename,
          vaultPath: body.vaultPath,
          destFolder: body.destFolder,
          autoApprove: body.autoApprove,
        },
        op: async () => {
          const ext = body.filePath!.substring(body.filePath!.lastIndexOf(".")).toLowerCase();

          if (ext === ".apkg") {
            const result = service.importAnki(body.filePath!);
            return {
              format: "anki",
              notes: result.notes,
              tags: result.tags,
              srsCards: result.srsCards,
              errors: result.errors,
              bytes: result.bytes,
            };
          }

          if (ext === ".pdf") {
            const result = service.importPDF(body.filePath!);
            return {
              format: "pdf",
              notes: result.notes,
              tags: result.tags,
              srsCards: result.srsCards,
              errors: result.errors,
              bytes: result.bytes,
            };
          }

          return { format: "unknown", notes: [], errors: [`Format ${ext} not yet implemented`] };
        },
      },
    );
  });
}
