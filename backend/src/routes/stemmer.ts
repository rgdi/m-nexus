// stemmer.ts routes (v0.62.0): endpoints para stemming.
import { FastifyInstance } from "fastify";
import { stem, normalize, tokenizeAndStem, buildFtsQuery, detectLanguage } from "../services/stemmer.js";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";

export async function stemmerRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { word: string; lang?: string } }>("/stemmer/stem", async (req) => {
    const b = req.body ?? {} as any;
    if (!b.word) throw E.val("EC-STM-001", "word requerido", { context: { body: b } });
    const lang = (b.lang === "en" || b.lang === "es") ? b.lang : "es";
    return { word: b.word, stem: stem(b.word, lang), lang };
  });

  app.post<{ Body: { text: string; lang?: string } }>("/stemmer/tokenize", async (req) => {
    const b = req.body ?? {} as any;
    if (!b.text) throw E.val("EC-STM-002", "text requerido", { context: { body: b } });
    const lang = (b.lang === "en" || b.lang === "es") ? b.lang : "es";
    return { tokens: tokenizeAndStem(b.text, lang), lang };
  });

  app.post<{ Body: { query: string; lang?: string } }>("/stemmer/query", async (req) => {
    const b = req.body ?? {} as any;
    if (!b.query) throw E.val("EC-STM-003", "query requerido", { context: { body: b } });
    const lang = b.lang === "en" ? "en" : b.lang === "es" ? "es" : "auto";
    const ftsQuery = buildFtsQuery(b.query, lang as any);
    const detected = detectLanguage(b.query);
    logOp("stemmer", "query built", true, { query: b.query, ftsQuery, lang: detected });
    return { ftsQuery, detectedLang: detected };
  });

  app.post<{ Body: { text: string } }>("/stemmer/detect", async (req) => {
    const b = req.body ?? {} as any;
    if (!b.text) throw E.val("EC-STM-004", "text requerido", { context: { body: b } });
    return { lang: detectLanguage(b.text) };
  });

  app.post<{ Body: { word: string } }>("/stemmer/normalize", async (req) => {
    const b = req.body ?? {} as any;
    if (!b.word) throw E.val("EC-STM-005", "word requerido", { context: { body: b } });
    return { original: b.word, normalized: normalize(b.word) };
  });
}
