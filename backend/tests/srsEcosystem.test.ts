// Cross-cutting test: PKM + SRS ecosystem integration (Fase 2-3 cohesion).
//
// Verifica que los servicios SRS (cloze, image occlusion, type-answer)
// trabajen juntos con los servicios PKM (wikilinks, tags, templates).

import { describe, it, expect } from "vitest";
import { ClozeService } from "../src/services/clozeService";
import { ImageOcclusionService } from "../src/services/imageOcclusionService";
import { TypeAnswerService } from "../src/services/typeAnswerService";
import { TagService } from "../src/services/tagService";
import { WikilinkService } from "../src/services/wikilinkService";
import { TemplateService } from "../src/services/templateService";

describe("SRS + PKM integration", () => {
  it("cloze dentro de nota con tags se procesa correctamente", () => {
    const tagService = new TagService();
    const note = `---
tags: [anatomia, flashcards]
---

# Diafragma

El {{c1::diafragma}} es un músculo clave en la {{c2::respiración}}.`;

    // Tags
    const tags = tagService.indexNote("anatomia/diafragma.md", note);
    expect(tags.sort()).toEqual(["anatomia", "flashcards"]);

    // Cloze
    const clozes = ClozeService.parseCloze(note);
    expect(clozes).toHaveLength(2);
    const cards = ClozeService.generateCards(note);
    expect(cards).toHaveLength(2);
  });

  it("image occlusion + wikilinks en la misma nota", () => {
    const wikilinkService = new WikilinkService();
    const note = `---
image_occlusion:
  image: anatomia.png
  width: 800
  height: 600
  masks:
    - { id: 0, x: 10, y: 20, width: 100, height: 50, label: "Riñón" }
tags: [anatomia]
---

# Anatomía

Ver también [[sistema urinario]] y [[hígado]] para más detalles.`;

    // Image occlusion
    const occCards = ImageOcclusionService.parse(note);
    expect(occCards).toHaveLength(1);
    expect(occCards[0].label).toBe("Riñón");

    // Wikilinks
    wikilinkService.indexNote("anatomia/rinon.md", note);
    const urinario = wikilinkService.getBacklinks("sistema urinario.md");
    expect(urinario).toContain("anatomia/rinon.md");
  });

  it("type-answer card se puede generar desde template", () => {
    const templateService = new TemplateService();
    const note = templateService.render("pharmacology", { title: "Ibuprofeno" })!;

    // Convertir el template a un type-answer card
    const card: any = {
      question: "¿Cuál es el mecanismo de acción del " + (note.template.defaultTags?.includes("farmacologia") ? "fármaco" : "X") + "?",
      answers: ["Inhibición de COX", "inhibe COX"],
      caseSensitive: false,
      fuzzyThreshold: 2,
      trimWhitespace: true,
    };

    const result = TypeAnswerService.evaluate(card, "inhibe cox");
    expect(result.correct).toBe(true);
  });

  it("múltiples cards de diferentes tipos en una nota (mixed)", () => {
    const note = `---
tags: [mixto]
image_occlusion:
  image: torso.png
  width: 1000
  height: 800
  masks:
    - { id: 0, x: 100, y: 100, width: 200, height: 200, label: "Corazón" }
    - { id: 1, x: 500, y: 400, width: 200, height: 200, label: "Hígado" }
type_answer:
  question: Órgano que bombea sangre
  answers: ["Corazón"]
---

# Mixto

Notas con cloze: {{c1::El corazón late 60-100 bpm}}.

Tags: #mixto #anatomia.

Ver [[sistema circulatorio]].`;

    const tagService = new TagService();
    const tagServiceInstance = new TagService();
    tagServiceInstance.indexNote("mix.md", note);
    const tags = tagServiceInstance.getTagsForNote("mix.md");
    expect(tags).toContain("mixto");

    // Cloze
    const clozes = ClozeService.parseCloze(note);
    expect(clozes).toHaveLength(1);

    // Image occlusion
    const occCards = ImageOcclusionService.parse(note);
    expect(occCards).toHaveLength(2);

    // Type answer
    const taCard = TypeAnswerService.parseFromFrontmatter(note);
    expect(taCard).not.toBeNull();
    expect(taCard!.answers).toContain("Corazón");
  });

  it("daily note template + tags + wikilinks workflow", () => {
    const templateService = new TemplateService();
    const tagService = new TagService();
    const wikilinkService = new WikilinkService();

    // 1. Generar daily note
    const daily = templateService.renderDailyNote(new Date("2026-03-15"));
    expect(daily.suggestedFilename).toBe("Daily/2026-03-15.md");

    // 2. Usuario añade tags y wikilinks
    const userContent = daily.rendered + "\n\nEstudié: #anatomia #farmacologia\n\nVer [[cardiovascular]] y [[nervioso]].\n\n";
    tagService.indexNote(daily.suggestedFilename, userContent);
    wikilinkService.indexNote(daily.suggestedFilename, userContent);

    // 3. Verificar
    const tags = tagService.getTagsForNote(daily.suggestedFilename);
    expect(tags).toContain("anatomia");
    expect(tags).toContain("farmacologia");

    // cardiovascular y nervioso son wikilinks outgoing
    const stats = wikilinkService.stats();
    expect(stats.totalLinks).toBe(2);
  });

  it("template puede renderizar contenido con cloze ya presente", () => {
    const templateService = new TemplateService();
    // Custom template con cloze
    templateService.register({
      id: "pharm-cloze",
      name: "Farmacología con Cloze",
      description: "Template que usa cloze",
      category: "medical",
      content: `# {{drug}}

Mecanismo: {{c1::Inhibición de COX}}
Indicaciones: {{c1::dolor e inflamación}}
AEs: {{c2::Sangrado GI}}

Mnemotécnico: {{hint}}`,
    });

    const result = templateService.render("pharm-cloze", { drug: "Ibuprofeno", hint: "INSAI" });
    expect(result.rendered).toContain("Ibuprofeno");
    const clozes = ClozeService.parseCloze(result.rendered);
    // 2 c1 + 1 c2 = 3 cloze occurrences → 2 unique cards
    expect(clozes.length).toBe(3);
    const cards = ClozeService.generateCards(result.rendered);
    expect(cards).toHaveLength(2);
  });
});
