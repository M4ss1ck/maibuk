/**
 * The Maps textures (#750): the base textures a Fill paints its area with,
 * drawn as one-colour SVG `<pattern>` definitions.
 */

import { describe, expect, it } from "vitest";
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

  it("names each pattern after its texture, so one definition serves every Fill", () => {
    expect(texturePatternId("grass")).toBe("texture-grass");
    expect(texturePattern("grass")).toContain('id="texture-grass"');
  });

  it("defines each texture as a repeating tile in page millimetres", () => {
    for (const id of TEXTURE_IDS) {
      const pattern = texturePattern(id);
      expect(pattern, id).toMatch(/^<pattern /);
      expect(pattern, id).toContain('patternUnits="userSpaceOnUse"');
      expect(pattern, id).toMatch(/ width="[\d.]+" height="[\d.]+">/);
      expect(pattern.endsWith("</pattern>"), id).toBe(true);
    }
  });

  it("draws every texture in a single ink", () => {
    for (const id of TEXTURE_IDS) {
      const colours = new Set(coloursOf(texturePattern(id)));
      expect(colours.size, id).toBe(1);
      for (const colour of colours) expect(colour, id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("draws the same pattern every time, so a render never drifts", () => {
    for (const id of TEXTURE_IDS) expect(texturePattern(id)).toBe(texturePattern(id));
  });

  it("knows only the textures it draws", () => {
    expect(isTextureId("grass")).toBe(true);
    expect(isTextureId("forest")).toBe(false);
    expect(isTextureId(7)).toBe(false);
    expect(isTextureId(null)).toBe(false);
  });
});
