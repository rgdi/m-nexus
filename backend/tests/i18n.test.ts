// Tests para i18n.ts (v0.46).

import { describe, it, expect } from "vitest";
import { t, detectLocale, localizedMessage, type Locale } from "../src/utils/i18n";

describe("i18n", () => {
  describe("detectLocale", () => {
    it("returns 'es' for Spanish Accept-Language", () => {
      expect(detectLocale("es-ES,es;q=0.9")).toBe("es");
      expect(detectLocale("es")).toBe("es");
      expect(detectLocale("es-MX")).toBe("es");
    });

    it("returns 'pt' for Portuguese", () => {
      expect(detectLocale("pt-BR,pt;q=0.9")).toBe("pt");
      expect(detectLocale("pt")).toBe("pt");
    });

    it("returns 'en' for English or other", () => {
      expect(detectLocale("en-US")).toBe("en");
      expect(detectLocale("en")).toBe("en");
      expect(detectLocale("fr-FR")).toBe("en");
      expect(detectLocale("")).toBe("en");
      expect(detectLocale(undefined)).toBe("en");
    });
  });

  describe("t() translation", () => {
    it("translates known keys to Spanish", () => {
      expect(t("errors.required", "es")).toBe("El campo es obligatorio");
      expect(t("errors.not_found", "es")).toBe("No encontrado");
    });

    it("translates known keys to Portuguese", () => {
      expect(t("errors.required", "pt")).toBe("O campo é obrigatório");
      expect(t("errors.rate_limit", "pt")).toBe("Muitas solicitações");
    });

    it("translates known keys to English", () => {
      expect(t("errors.required", "en")).toBe("Field is required");
      expect(t("errors.unauthorized", "en")).toBe("Unauthorized");
    });

    it("returns key as fallback for unknown keys", () => {
      expect(t("unknown.key", "es")).toBe("unknown.key");
      expect(t("not.translated", "en")).toBe("not.translated");
    });

    it("FSRS-specific messages", () => {
      expect(t("fsrs.eval.invalid_rating", "es")).toContain("Again");
      expect(t("fsrs.eval.invalid_rating", "en")).toContain("Again");
    });

    it("proposals messages exist in all locales", () => {
      expect(t("proposals.llm_unavailable", "en")).toBeTruthy();
      expect(t("proposals.llm_unavailable", "es")).toBeTruthy();
      expect(t("proposals.llm_unavailable", "pt")).toBeTruthy();
    });
  });

  describe("localizedMessage()", () => {
    it("returns message with optional context", () => {
      const r1 = localizedMessage("errors.required", "es");
      expect(r1.message).toBe("El campo es obligatorio");
      expect(r1.context).toBeUndefined();

      const r2 = localizedMessage("errors.required", "es", { field: "userId" });
      expect(r2.message).toBe("El campo es obligatorio");
      expect(r2.context).toEqual({ field: "userId" });
    });
  });
});
