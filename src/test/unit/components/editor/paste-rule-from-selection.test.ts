import { describe, expect, it } from "vitest";
import { inferPasteRuleFromSelection } from "../../../../components/editor/paste-rule-from-selection";
import { cleanPastedHtml } from "../../../../components/editor/paste-cleanup";
import { PASTE_CLEANUP_PRESETS } from "../../../../features/settings/types";

describe("inferPasteRuleFromSelection", () => {
  it("returns null for empty or whitespace-only selections", () => {
    expect(inferPasteRuleFromSelection("")).toBeNull();
    expect(inferPasteRuleFromSelection("   \n\t ")).toBeNull();
  });

  it("trims surrounding whitespace from the value", () => {
    expect(inferPasteRuleFromSelection("  span  ")).toEqual({
      target: "tag",
      value: "span",
    });
  });

  it("treats a known HTML tag name as a tag rule", () => {
    expect(inferPasteRuleFromSelection("font")).toEqual({
      target: "tag",
      value: "font",
    });
  });

  it("treats an rgb()/hex color as a text-color rule", () => {
    expect(inferPasteRuleFromSelection("rgb(51, 51, 51)")).toEqual({
      target: "textColor",
      value: "rgb(51, 51, 51)",
    });
    expect(inferPasteRuleFromSelection("#1a2b3c")).toEqual({
      target: "textColor",
      value: "#1a2b3c",
    });
  });

  it("treats a leading-dot identifier as a CSS class, stripping the dot", () => {
    expect(inferPasteRuleFromSelection(".MsoNormal")).toEqual({
      target: "cssClass",
      value: "MsoNormal",
    });
  });

  it("treats a bare non-tag identifier as a CSS class", () => {
    expect(inferPasteRuleFromSelection("MsoNormal")).toEqual({
      target: "cssClass",
      value: "MsoNormal",
    });
  });

  it("turns a full style attribute into a stable property selector", () => {
    expect(
      inferPasteRuleFromSelection(
        'style="font-family: -webkit-standard; font-size: medium; color: rgb(0, 0, 0);"',
      ),
    ).toEqual({
      target: "cssSelector",
      value: '[style*="font-family"][style*="font-size"][style*="color"]',
    });
  });

  it("strips a single-quoted style wrapper into a property selector", () => {
    expect(inferPasteRuleFromSelection("style='color: red'")).toEqual({
      target: "cssSelector",
      value: '[style*="color"]',
    });
  });

  it("turns a bare multi-declaration block into a property selector", () => {
    expect(
      inferPasteRuleFromSelection("font-family: -webkit-standard; color: rgb(0, 0, 0)"),
    ).toEqual({
      target: "cssSelector",
      value: '[style*="font-family"][style*="color"]',
    });
  });

  it("uses the style property name when the value contains quotes", () => {
    expect(
      inferPasteRuleFromSelection('style="font-family: \'Times New Roman\';"'),
    ).toEqual({
      target: "cssSelector",
      value: '[style*="font-family"]',
    });
  });

  // End-to-end: the whole point of the feature — a rule built from a selected
  // inline style must actually strip that style when the paste engine runs.
  it("produces a rule that removes the selected inline style on paste", () => {
    const inferred = inferPasteRuleFromSelection(
      'style="font-family: -webkit-standard; font-size: medium; color: rgb(0, 0, 0);"',
    );
    if (!inferred) throw new Error("expected a rule");
    const cleaned = cleanPastedHtml(
      '<p style="font-family: -webkit-standard; font-size: medium; color: rgb(0, 0, 0);">Hi</p>',
      {
        preset: "custom",
        options: { ...PASTE_CLEANUP_PRESETS.keepAll },
        rules: [
          {
            id: "r1",
            enabled: true,
            label: "",
            action: "removeStyle",
            ...inferred,
          },
        ],
      },
    );
    expect(cleaned).not.toContain("style=");
    expect(cleaned).toBe("<p>Hi</p>");
  });

  it("removes the selected inline style even when pasted style declarations are serialized differently", () => {
    const inferred = inferPasteRuleFromSelection(
      'style="font-family: -webkit-standard; font-size: medium; color: rgb(0, 0, 0);"',
    );
    if (!inferred) throw new Error("expected a rule");
    const cleaned = cleanPastedHtml(
      '<p style="color: rgb(0, 0, 0); font-size: medium; font-family: -webkit-standard;">Hi</p>',
      {
        preset: "custom",
        options: { ...PASTE_CLEANUP_PRESETS.keepAll },
        rules: [
          {
            id: "r1",
            enabled: true,
            label: "",
            action: "removeStyle",
            ...inferred,
          },
        ],
      },
    );
    expect(cleaned).not.toContain("style=");
    expect(cleaned).toBe("<p>Hi</p>");
  });

  it("treats selector-like text as a CSS selector", () => {
    // A `[style*=...]` attribute selector must pass through verbatim and must
    // not be mistaken for a `style="..."` attribute and unwrapped.
    for (const selector of [
      'span[style*="font-size"]',
      '[style*="font-size"]',
      "div > p",
      "p.MsoNormal",
      "a:hover",
    ]) {
      expect(inferPasteRuleFromSelection(selector)).toEqual({
        target: "cssSelector",
        value: selector,
      });
    }
  });
});
