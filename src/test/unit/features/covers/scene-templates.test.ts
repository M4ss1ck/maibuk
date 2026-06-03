import { describe, expect, it } from "vitest";
import { TEMPLATES, buildTemplateScene } from "../../../../features/covers/scene/templates";

const args = { title: "The Great Book", author: "Jane Doe", presetId: "6x9" };

describe("TEMPLATES", () => {
  it("exposes several templates with unique ids", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(3);
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildTemplateScene", () => {
  it("produces a v1 scene containing the title and author text", () => {
    for (const tpl of TEMPLATES) {
      const scene = buildTemplateScene(tpl.id, args);
      expect(scene.schemaVersion).toBe(1);
      expect(scene.doc.width).toBe(1800);
      const texts = scene.layers.filter((l) => l.type === "text");
      const joined = texts.map((l) => (l.type === "text" ? l.text : "")).join(" ");
      expect(joined).toContain("The Great Book");
      expect(joined).toContain("Jane Doe");
    }
  });

  it("falls back to the first template for an unknown id", () => {
    const scene = buildTemplateScene("does-not-exist", args);
    expect(scene.schemaVersion).toBe(1);
    expect(scene.layers.length).toBeGreaterThan(0);
  });
});
