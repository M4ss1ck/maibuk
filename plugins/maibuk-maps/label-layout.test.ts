import { describe, expect, it } from "vitest";
import { MIN_LABEL_WIDTH_MM } from "./maps";
import {
  LABEL_LINE_HEIGHT,
  LABEL_TEXT_STYLE,
  labelFontExtent,
  layoutLabel,
  lineWidth,
} from "./label-layout";

const label = (over = {}) => ({
  text: "Gulf",
  font: "im-fell-english" as const,
  size: 6,
  letterSpacing: 0,
  width: 55,
  sizing: "auto" as const,
  ...over,
});

const type = (over = {}) => ({
  font: "im-fell-english" as const,
  size: 6,
  letterSpacing: 0,
  ...over,
});

describe("Map Label layout (#800)", () => {
  it("lays out one auto line at its measured width and cap-size height", () => {
    const layout = layoutLabel(label({ text: "Gulf of Mexico" }));
    expect(layout.lines).toEqual(["Gulf of Mexico"]);
    expect(layout.width).toBe(lineWidth("Gulf of Mexico", label()));
    expect(layout.height).toBe(6);
    expect(layout.lineHeight).toBeCloseTo(6 * LABEL_LINE_HEIGHT, 10);
  });

  it("stacks auto lines at Enter and sizes the box to the longest line", () => {
    const layout = layoutLabel(label({ text: "North\nSea\nCoast" }));
    expect(layout.lines).toEqual(["North", "Sea", "Coast"]);
    const widths = ["North", "Sea", "Coast"].map((line) => lineWidth(line, label()));
    expect(layout.width).toBe(Math.max(...widths));
    expect(layout.height).toBeCloseTo(6 + 2 * 7.2, 10);
  });

  it("collapses whitespace in auto lines the way SVG does", () => {
    expect(layoutLabel(label({ text: "  Gulf   of  " })).lines).toEqual(["Gulf of"]);
  });

  it("lays out the placeholder when an empty label has one", () => {
    const layout = layoutLabel(label({ text: "" }), "Write your text here");
    expect(layout.lines).toEqual(["Write your text here"]);
    expect(layout.placeholder).toBe(true);
    expect(layout.width).toBe(lineWidth("Write your text here", label()));
  });

  it("lays out an empty label as one empty line at the minimum width without a placeholder", () => {
    const layout = layoutLabel(label({ text: "" }));
    expect(layout.lines).toEqual([""]);
    expect(layout.placeholder).toBe(false);
    expect(layout.width).toBe(MIN_LABEL_WIDTH_MM);
    expect(layout.width).toBe(1);
  });

  it("measures a one-letter label at a positive width", () => {
    const layout = layoutLabel(label({ text: "A" }));
    expect(layout.width).toBe(lineWidth("A", label()));
    expect(layout.width).toBeGreaterThan(0);
  });

  it("wraps a fixed label at its stored width without losing words", () => {
    const text = "The Gulf of Mexico and the Caribbean Sea";
    const layout = layoutLabel(label({ text, sizing: "fixed", width: 30 }));
    expect(layout.lines.length).toBeGreaterThan(1);
    for (const line of layout.lines) {
      expect(lineWidth(line, label())).toBeLessThanOrEqual(30);
    }
    expect(layout.lines.join(" ")).toBe(text);
    expect(layout.width).toBe(30);
    expect(layout.height).toBeCloseTo(6 + (layout.lines.length - 1) * 7.2, 10);
  });

  it("keeps Enter breaks in a fixed label even when the text fits", () => {
    expect(layoutLabel(label({ text: "North\nSea", sizing: "fixed", width: 200 })).lines).toEqual([
      "North",
      "Sea",
    ]);
  });

  it("breaks a word wider than a fixed box between its letters", () => {
    const layout = layoutLabel(label({ text: "Mississippi", sizing: "fixed", width: 10 }));
    expect(layout.lines.length).toBeGreaterThan(1);
    for (const line of layout.lines) {
      expect(lineWidth(line, label()) <= 10 || line.length === 1).toBe(true);
    }
    expect(layout.lines.join("")).toBe("Mississippi");
  });

  it("adds letter spacing after every character", () => {
    expect(lineWidth("abc", type({ font: "cinzel", letterSpacing: 1 }))).toBeCloseTo(
      lineWidth("abc", type({ font: "cinzel", letterSpacing: 0 })) + 3,
      10
    );
  });

  it("scales width with the cap size", () => {
    expect(lineWidth("Sea", type({ size: 12 }))).toBeCloseTo(
      2 * lineWidth("Sea", type({ size: 6 })),
      10
    );
  });

  it("estimates the PDF Font at half an em per character", () => {
    expect(lineWidth("abcd", type({ font: "pdf", size: 10, letterSpacing: 0 }))).toBeCloseTo(
      20,
      10
    );
    expect(labelFontExtent("pdf")).toEqual({ ascent: 0.8, descent: 0.2 });
  });

  it("reads a positive ascent and descent that sum below two em for every bundled font", () => {
    for (const font of ["im-fell-english", "cinzel", "uncial-antiqua", "medieval-sharp"] as const) {
      const extent = labelFontExtent(font);
      expect(extent.ascent).toBeGreaterThan(0);
      expect(extent.descent).toBeGreaterThan(0);
      expect(extent.ascent + extent.descent).toBeLessThan(2);
    }
  });

  it("turns kerning and ligatures off in the drawn text style", () => {
    expect(LABEL_TEXT_STYLE).toContain("font-kerning:none");
  });
});
