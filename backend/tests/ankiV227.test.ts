// ankiV227.test.ts — v2.27.0 Anki import/export tests.

import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import {
  ankiCardToFsrs,
  detectFormat,
  exportApkg,
  importApkg,
  parseFromJson,
  parseFromSqlite,
  type AnkiCard,
  type AnkiCollectionJson,
  type AnkiModel,
  type MxFlashcard,
} from "../src/services/anki.js";

/** Build a synthetic .apkg in-memory as a Buffer (collection.json). */
function buildApkg(col: AnkiCollectionJson): Buffer {
  const zip = new AdmZip();
  zip.addFile("collection.json", Buffer.from(JSON.stringify(col), "utf-8"));
  zip.addFile("media", Buffer.from('{"0":""}', "utf-8"));
  return zip.toBuffer();
}

function makeCol(): AnkiCollectionJson {
  return {
    version: 11,
    models: {
      "1": { id: 1, name: "Basic", type: 0, flds: [{ name: "Front" }, { name: "Back" }], tmpls: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr>{{Back}}" }] },
      "2": { id: 2, name: "Cloze", type: 1, flds: [{ name: "Text" }, { name: "Extra" }], tmpls: [{ name: "Cloze", qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}<hr>{{Extra}}" }] },
    },
    decks: { "1": { id: 1, name: "TestDeck" } },
    notes: [],
    cards: [],
  };
}

describe("v2.27.0 — anki.detectFormat", () => {
  it("rejects unknown formats", () => {
    expect(detectFormat(Buffer.from("not a zip"))).toBe("unknown");
  });

  it("detects collection.json", () => {
    const buf = buildApkg(makeCol());
    expect(detectFormat(buf)).toBe("collection-json");
  });
});

describe("v2.27.0 — anki.importApkg (collection.json path)", () => {
  it("parses basic + cloze, preserves FSRS state from ivl/reps", async () => {
    const col = makeCol();
    col.notes.push(
      { id: 1, mid: 1, flds: "¿Capital de Francia?\x1fParís", sfld: "Capital de Francia", tags: [" geo"] },
      { id: 2, mid: 1, flds: "¿Capital de Alemania?\x1fBerlín", sfld: "Capital de Alemania", tags: [" geo"] },
      { id: 3, mid: 2, flds: "Páncreas secreta {{c1::insulina}}.", sfld: "Páncreas", tags: [" bio"] },
    );
    col.cards.push(
      { id: 1, nid: 1, did: 1, ord: 0, type: 0, queue: 0, due: 1, ivl: 0, factor: 2500, reps: 0, lapses: 0, left: 0 },
      { id: 2, nid: 2, did: 1, ord: 0, type: 0, queue: 2, due: 5, ivl: 5, factor: 2500, reps: 2, lapses: 0, left: 0 },
      { id: 3, nid: 3, did: 1, ord: 0, type: 0, queue: 0, due: 1, ivl: 0, factor: 2500, reps: 0, lapses: 0, left: 0 },
    );
    const buf = buildApkg(col);
    const r = await importApkg(buf);
    expect(r.cards.length).toBe(3);
    expect(r.stats.total).toBe(3);
    expect(r.stats.byType.basic).toBe(2);
    expect(r.stats.byType.cloze).toBe(1);
    expect(r.stats.withFsrsHistory).toBe(1); // card #2 has reps > 0
    const berlin = r.cards.find((c) => c.front.includes("Alemania"));
    expect(berlin?.fsrs.reps).toBe(2);
    expect(berlin?.fsrs.stability).toBe(5);
    expect(berlin?.cardType).toBe("basic");
    const cloze = r.cards.find((c) => c.front.includes("Páncreas"));
    expect(cloze?.cardType).toBe("cloze");
  });

  it("ankiCardToFsrs mapea difficulty desde factor", () => {
    const card: AnkiCard = { id: 1, nid: 1, did: 1, ord: 0, type: 0, queue: 2, due: 5, ivl: 5, factor: 2500, reps: 1, lapses: 0, left: 0 };
    const fsrs = ankiCardToFsrs(card);
    expect(fsrs.state).toBe("review");
    expect(fsrs.stability).toBe(5);
    expect(fsrs.difficulty).toBeGreaterThanOrEqual(1);
    expect(fsrs.difficulty).toBeLessThanOrEqual(10);
  });

  it("ankiCardToFsrs maneja new cards (reps=0)", () => {
    const card: AnkiCard = { id: 1, nid: 1, did: 1, ord: 0, type: 0, queue: 0, due: 1, ivl: 0, factor: 2500, reps: 0, lapses: 0, left: 0 };
    const fsrs = ankiCardToFsrs(card);
    expect(fsrs.state).toBe("new");
    expect(fsrs.reps).toBe(0);
  });

  it("ankiCardToFsrs detecta relearning (lapses == reps)", () => {
    const card: AnkiCard = { id: 1, nid: 1, did: 1, ord: 0, type: 0, queue: 2, due: 5, ivl: 1, factor: 2000, reps: 1, lapses: 1, left: 0 };
    const fsrs = ankiCardToFsrs(card);
    expect(fsrs.state).toBe("relearning");
  });
});

describe("v2.27.0 — anki.exportApkg (roundtrip)", () => {
  it("emite collection.json con models basic+cloze, decks, notes, cards", () => {
    const cards: MxFlashcard[] = [
      { id: "f1", front: "¿Capital?", back: "París", subject: "geo", tags: [" europe"], cardType: "basic",
        fsrs: { stability: 5, difficulty: 5, state: "review", reps: 2, lapses: 0, lastReview: 0, due: Date.now() + 86400_000, retrievability: 0.9 } },
      { id: "f2", front: "Páncreas secreta {{c1::insulina}}.", back: "", subject: "bio", tags: [" physio"], cardType: "cloze",
        fsrs: { stability: 0, difficulty: 5, state: "new", reps: 0, lapses: 0, lastReview: 0, due: Date.now(), retrievability: 1 } },
    ];
    const out = exportApkg({ cards, deckName: "Roundtrip" });
    expect(out.cardCount).toBe(2);
    const zip = new AdmZip(out.apkgBytes);
    const colTxt = zip.getEntry("collection.json")!.getData().toString("utf-8");
    const col = JSON.parse(colTxt);
    expect(Object.keys(col.models).sort()).toEqual(["1", "2"]);
    expect(col.decks["1"].name).toBe("Roundtrip");
    expect(col.notes.length).toBe(2);
    expect(col.cards.length).toBe(2);
    expect(col.cards[0].ivl).toBe(5);
  });

  it("omite cards con front vacío", () => {
    const cards: MxFlashcard[] = [
      { id: "f1", front: "", back: "x", subject: "", tags: [], cardType: "basic",
        fsrs: { stability: 0, difficulty: 5, state: "new", reps: 0, lapses: 0, lastReview: 0, due: 0, retrievability: 1 } },
      { id: "f2", front: "Real", back: "ok", subject: "", tags: [], cardType: "basic",
        fsrs: { stability: 0, difficulty: 5, state: "new", reps: 0, lapses: 0, lastReview: 0, due: 0, retrievability: 1 } },
    ];
    const out = exportApkg({ cards });
    expect(out.cardCount).toBe(1);
  });

  it("incluye revlog cuando includeRevlog=true", () => {
    const cards: MxFlashcard[] = [
      { id: "f1", front: "Q", back: "A", subject: "", tags: [], cardType: "basic",
        fsrs: { stability: 1, difficulty: 5, state: "review", reps: 1, lapses: 0, lastReview: Date.now(), due: Date.now() + 86400_000, retrievability: 0.9 },
        sourceAnki: { history: [{ ts: 1700000000, ease: 3, ivl: 1, lastIvl: 0, factor: 2500, time: 1000, type: 1 }] } },
    ];
    const out = exportApkg({ cards, includeRevlog: true });
    const zip = new AdmZip(out.apkgBytes);
    const col = JSON.parse(zip.getEntry("collection.json")!.getData().toString("utf-8"));
    expect(col.revlog.length).toBeGreaterThanOrEqual(1);
  });

  it("roundtrip JSON: cards importadas pueden re-exportarse", async () => {
    const col = makeCol();
    col.notes.push({ id: 1, mid: 1, flds: "Q1\x1fA1", sfld: "Q1", tags: ["t1"] });
    col.cards.push({ id: 1, nid: 1, did: 1, ord: 0, type: 0, queue: 0, due: 1, ivl: 0, factor: 2500, reps: 0, lapses: 0, left: 0 });
    const buf = buildApkg(col);
    const r = await importApkg(buf);
    const out = exportApkg({ cards: r.cards });
    expect(out.cardCount).toBe(1);
  });
});

describe("v2.27.0 — anki.parseFromSqlite (roundtrip SQLite path)", () => {
  it("ignora el path si el buffer no es collection-anki21 válido", async () => {
    const buf = buildApkg(makeCol());
    // Calling parseFromSqlite on a collection-json .apkg should fail loudly.
    await expect(parseFromSqlite(buf)).rejects.toThrow(/collection\.anki2/);
  });
});
