// Tests para TemplateService (Fase 2.D).

import { describe, it, expect, beforeEach } from "vitest";
import { TemplateService } from "../src/services/templateService";

describe("TemplateService", () => {
  let service: TemplateService;

  beforeEach(() => {
    service = new TemplateService();
  });

  it("loads built-in templates", () => {
    const templates = service.list();
    expect(templates.length).toBeGreaterThanOrEqual(5);
  });

  it("includes medical templates (SOAP, pharmacology, anatomy, disease)", () => {
    const medical = service.list("medical");
    expect(medical.length).toBeGreaterThanOrEqual(3);
    const ids = medical.map((t) => t.id);
    expect(ids).toContain("soap");
    expect(ids).toContain("pharmacology");
    expect(ids).toContain("anatomy");
    expect(ids).toContain("disease");
  });

  it("filters by category", () => {
    expect(service.list("medical").every((t) => t.category === "medical")).toBe(true);
    expect(service.list("study").every((t) => t.category === "study")).toBe(true);
  });

  it("gets template by ID", () => {
    const soap = service.get("soap");
    expect(soap).not.toBeNull();
    expect(soap!.name).toContain("SOAP");
  });

  it("returns null for unknown ID", () => {
    expect(service.get("nonexistent")).toBeNull();
  });

  it("renders template with variables", () => {
    const result = service.render("blank", { title: "Mi Nota de Prueba" });
    expect(result).not.toBeNull();
    expect(result!.rendered).toContain("Mi Nota de Prueba");
  });

  it("replaces {{date}} with today's date", () => {
    const result = service.render("daily");
    expect(result).not.toBeNull();
    const today = new Date().toISOString().slice(0, 10);
    expect(result!.rendered).toContain(today);
  });

  it("replaces multiple variables in one template", () => {
    const result = service.render("pharmacology", { title: "Ibuprofeno" });
    expect(result!.rendered).toContain("Ibuprofeno");
    // Debe tener Indicaciones (campo del template)
    expect(result!.rendered).toContain("Indicaciones");
  });

  it("replaces unknown variables with empty string", () => {
    const result = service.render("blank", {});
    // {{title}} se reemplaza con ""
    expect(result!.rendered).not.toContain("{{");
  });

  it("renders daily note with date in filename", () => {
    const result = service.renderDailyNote();
    expect(result.suggestedFilename).toMatch(/^Daily\/\d{4}-\d{2}-\d{2}\.md$/);
  });

  it("renders custom date in daily note", () => {
    const custom = new Date("2026-12-25");
    const result = service.renderDailyNote(custom);
    expect(result.rendered).toContain("2026-12-25");
    expect(result.suggestedFilename).toContain("2026-12-25");
  });

  it("registers custom template", () => {
    service.register({
      id: "my-template",
      name: "Mi Template",
      description: "Test",
      category: "custom",
      content: "Hello {{name}}",
    });
    const result = service.render("my-template", { name: "World" });
    expect(result!.rendered).toBe("Hello World");
  });

  it("searches templates by name/description", () => {
    const results = service.search("fármaco");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((t) => t.id === "pharmacology")).toBe(true);
  });

  it("searches templates case-insensitive", () => {
    const results = service.search("SOAP");
    expect(results.some((t) => t.id === "soap")).toBe(true);
  });

  it("default tags are included in template", () => {
    const soap = service.get("soap");
    expect(soap?.defaultTags).toContain("soap");
    expect(soap?.defaultTags).toContain("clinica");
  });

  it("SOAP template has clinical sections", () => {
    const result = service.render("soap", { title: "Paciente X" });
    expect(result!.rendered).toContain("Subjetivo");
    expect(result!.rendered).toContain("Objetivo");
    expect(result!.rendered).toContain("Análisis");
    expect(result!.rendered).toContain("Plan");
  });

  it("anatomy template has anatomy-specific fields", () => {
    const result = service.render("anatomy", { title: "Hígado" });
    expect(result!.rendered).toContain("Inervación");
    expect(result!.rendered).toContain("Irrigación");
  });
});
