// stemmer.test.ts: tests del stemmer ES/EN (v0.62.0)
import { describe, it, expect } from "vitest";
import { stem, normalize, tokenizeAndStem, buildFtsQuery, detectLanguage } from "../src/services/stemmer.js";

describe("stemmer (v0.62.0)", () => {
  describe("normalize", () => {
    it("lowercase", () => {
      expect(normalize("HOLA")).toBe("hola");
    });
    it("NFD sin acentos", () => {
      expect(normalize("anatomía")).toBe("anatomia");
      expect(normalize("NIÑO")).toBe("nino");
      expect(normalize("ÁrEa")).toBe("area");
    });
    it("elimina no-alfanumericos", () => {
      expect(normalize("hola-mundo!")).toBe("holamundo");
    });
  });

  describe("stem (ES)", () => {
    it("plurales -s (NFD normalized)", () => {
      expect(stem("anatomías", "es")).toBe("anatomia");
    });
    it("verbos -ando", () => {
      expect(stem("corriendo", "es").length).toBeLessThan("corriendo".length);
    });
    it("verbos -ado", () => {
      expect(stem("terminado", "es").length).toBeLessThan("terminado".length);
    });
    it("sustantivos -idad", () => {
      expect(stem("velocidad", "es").length).toBeLessThan("velocidad".length);
    });
    it("adverbios -mente", () => {
      expect(stem("rápidamente", "es").length).toBeLessThan("rápidamente".length);
    });
    it("palabra corta no se stema", () => {
      expect(stem("es", "es")).toBe("es");
    });
  });

  describe("stem (EN)", () => {
    it("-ing", () => {
      expect(stem("running", "en")).toBe("runn");
    });
    it("-ed", () => {
      expect(stem("walked", "en")).toBe("walk");
    });
    it("-s plural", () => {
      expect(stem("dogs", "en")).toBe("dog");
    });
    it("-tion", () => {
      expect(stem("information", "en")).toBe("informa");
    });
  });

  describe("tokenizeAndStem", () => {
    it("filtra stopwords ES", () => {
      const toks = tokenizeAndStem("el hueso de la pierna", "es");
      expect(toks).toContain("hueso");
      expect(toks).toContain("pierna");
      expect(toks).not.toContain("el");
      expect(toks).not.toContain("de");
    });
    it("filtra stopwords EN", () => {
      const toks = tokenizeAndStem("the bone of the leg", "en");
      expect(toks).toContain("bone");
      expect(toks).not.toContain("the");
      expect(toks).not.toContain("of");
    });
    it("stema y filtra", () => {
      const toks = tokenizeAndStem("anatomías corriendo terminados", "es");
      expect(toks.length).toBeGreaterThan(0);
    });
  });

  describe("buildFtsQuery", () => {
    it("construye query con OR", () => {
      const q = buildFtsQuery("ciclo krebs", "es");
      expect(q).toContain("OR");
      expect(q).toContain("ciclo");
      expect(q).toContain("kreb"); // 'krebs' se stema a 'kreb' (quita 's')
    });
    it("anade wildcard *", () => {
      const q = buildFtsQuery("anatomía", "es");
      expect(q).toContain("*");
    });
    it("auto-detecta idioma", () => {
      const qES = buildFtsQuery("anatomía clínica");
      expect(qES).toContain("anatom"); // stemmed
      const qEN = buildFtsQuery("running dogs");
      expect(qEN).toContain("runn");
    });
  });

  describe("detectLanguage", () => {
    it("detecta ES por acentos", () => {
      expect(detectLanguage("anatomía clínica")).toBe("es");
    });
    it("detecta ES por stopwords", () => {
      expect(detectLanguage("el hueso de la pierna")).toBe("es");
    });
    it("detecta EN por stopwords", () => {
      expect(detectLanguage("the bone of the leg")).toBe("en");
    });
    it("default ES si no claro", () => {
      expect(detectLanguage("hueso femur")).toBe("es");
    });
  });
});
