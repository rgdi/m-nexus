import { describe, it, expect, beforeEach } from "vitest";
import { ImageOcclusionBuilder } from "../src/flashcards/imageOcclusion";
import { makeMockApp, MockApp } from "./mockObsidian";
import { noopLogger } from "./helpers";

describe("ImageOcclusion", () => {
  let app: MockApp;
  let builder: ImageOcclusionBuilder;

  beforeEach(() => {
    app = makeMockApp();
    builder = new ImageOcclusionBuilder(app as any, {} as any, noopLogger);
  });

  it("toDrafts: una oclusión → una card", () => {
    const doc = {
      imagePath: "Photos/x.png",
      occlusions: [{ id: "o1", x: 10, y: 20, width: 100, height: 50, label: "Aorta" }],
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    };
    const drafts = builder.toDrafts(doc, "nota.md");
    expect(drafts.length).toBe(1);
    expect(drafts[0].back).toBe("Aorta");
    expect(drafts[0].front).toContain("Photos/x.png");
  });

  it("toDrafts: múltiples oclusiones → múltiples cards", () => {
    const doc = {
      imagePath: "p.png",
      occlusions: [
        { id: "o1", x: 0, y: 0, width: 50, height: 50, label: "L1" },
        { id: "o2", x: 50, y: 0, width: 50, height: 50, label: "L2" },
        { id: "o3", x: 0, y: 50, width: 50, height: 50, label: "L3" },
      ],
      createdAt: "", updatedAt: "",
    };
    expect(builder.toDrafts(doc, "n.md").length).toBe(3);
  });

  it("toDrafts: sin oclusiones → array vacío", () => {
    const doc = { imagePath: "p.png", occlusions: [], createdAt: "", updatedAt: "" };
    expect(builder.toDrafts(doc, "n.md")).toEqual([]);
  });
});
