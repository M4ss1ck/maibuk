/**
 * The Maps textures (#750): the base textures a Fill paints its area with,
 * drawn as one-colour SVG `<pattern>` definitions.
 */

import { describe, expect, it } from "vitest";
import { MAP_STYLE_IDS, MAP_STYLES } from "./styles";
import { TEXTURE_IDS, isTextureId, texturePattern, texturePatternId } from "./textures";

/** The colours a piece of markup paints with, from its `fill` and `stroke` attributes. */
function coloursOf(markup: string): string[] {
  return [...markup.matchAll(/(?:fill|stroke)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((colour) => colour !== "none");
}

describe("textures", () => {
  it("offers five base textures", () => {
    expect(TEXTURE_IDS).toEqual(["grass", "sand", "marsh", "hatching", "dots"]);
  });

  it("names each pattern after its Style and texture, Atlas keeping the original id", () => {
    expect(texturePatternId("grass", "atlas")).toBe("texture-grass");
    expect(texturePattern("grass", "atlas")).toContain('id="texture-grass"');
    for (const style of MAP_STYLE_IDS) {
      expect(texturePattern("grass", style)).toContain(`id="${texturePatternId("grass", style)}"`);
    }
    // A pattern is defined once per Style and texture, so the id keys on both.
    expect(new Set(MAP_STYLE_IDS.map((style) => texturePatternId("grass", style))).size).toBe(
      MAP_STYLE_IDS.length
    );
  });

  it("defines each texture as a repeating tile in page millimetres", () => {
    for (const style of MAP_STYLE_IDS) {
      for (const id of TEXTURE_IDS) {
        const pattern = texturePattern(id, style);
        expect(pattern, id).toMatch(/^<pattern /);
        expect(pattern, id).toContain('patternUnits="userSpaceOnUse"');
        expect(pattern, id).toMatch(/ width="[\d.]+" height="[\d.]+">/);
        expect(pattern.endsWith("</pattern>"), id).toBe(true);
      }
    }
  });

  it("draws every texture in a single ink", () => {
    for (const style of MAP_STYLE_IDS) {
      for (const id of TEXTURE_IDS) {
        const colours = new Set(coloursOf(texturePattern(id, style)));
        expect(colours.size, id).toBe(1);
        for (const colour of colours) expect(colour, id).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("draws Atlas in each texture's own ink and every other Style in its ink role", () => {
    for (const style of MAP_STYLE_IDS) {
      for (const id of TEXTURE_IDS) {
        const [ink] = coloursOf(texturePattern(id, style));
        if (style !== "atlas") expect(ink, `${style}.${id}`).toBe(MAP_STYLES[style].ink);
      }
    }
  });

  it("draws the same pattern every time, so a render never drifts", () => {
    for (const style of MAP_STYLE_IDS) {
      for (const id of TEXTURE_IDS) {
        expect(texturePattern(id, style)).toBe(texturePattern(id, style));
      }
    }
  });

  it("knows only the textures it draws", () => {
    expect(isTextureId("grass")).toBe(true);
    expect(isTextureId("forest")).toBe(false);
    expect(isTextureId(7)).toBe(false);
    expect(isTextureId(null)).toBe(false);
  });
});
