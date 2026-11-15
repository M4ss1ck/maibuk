import { Marked } from "marked";
import { describe, expect, it } from "vitest";

import { lowlight } from "@/lib/lowlight";

type HastNode = {
  type: string;
  value?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
};

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** The text of every span highlight.js gives `className` in a Markdown code block. */
function spans(source: string, className: "hljs-emphasis" | "hljs-strong"): string[] {
  const found: string[] = [];
  const walk = (node: HastNode) => {
    if (node.properties?.className?.includes(className)) found.push(textOf(node));
    for (const child of node.children ?? []) walk(child);
  };
  walk(lowlight.highlight("markdown", source) as HastNode);
  return found;
}

describe("Markdown code block highlighting follows CommonMark underscore rules", () => {
  it.each([
    "a snake_case word",
    "> a snake_case word",
    "> my_var and other_var",
    "> foo_bar_baz.",
    "> _x_y z",
    "> año_siguiente y más_cosas",
    "- list snake_case word",
    "> \\_escaped_ text",
  ])("keeps intraword underscores literal: %s", (source) => {
    expect(spans(source, "hljs-emphasis")).toEqual([]);
  });

  it.each([
    ["> _real emphasis_ here", ["_real emphasis_"]],
    ["_word_", ["_word_"]],
    ["(_aside_), then more", ["_aside_"]],
    ["> _foo_bar baz_ end", ["_foo_bar baz_"]],
    ["> *star* and snake_case", ["*star*"]],
  ])("still highlights real emphasis: %s", (source, expected) => {
    expect(spans(source, "hljs-emphasis")).toEqual(expected);
  });

  it("keeps intraword double underscores literal and highlights real ones", () => {
    expect(spans("> a dunder__name__here word", "hljs-strong")).toEqual([]);
    expect(spans("> __bold__ text", "hljs-strong")).toEqual(["__bold__"]);
  });

  it("keeps the `md` alias on the CommonMark grammar", () => {
    expect(spans("> a snake_case word", "hljs-emphasis")).toEqual([]);
    expect(lowlight.highlight("md", "> a snake_case word").children).toEqual(
      lowlight.highlight("markdown", "> a snake_case word").children
    );
  });

  // Differential check against a CommonMark parser: wherever `marked` finds no
  // underscore emphasis, the highlighter must not paint any either.
  it("agrees with marked on whether a line has underscore emphasis", () => {
    const marked = new Marked({ gfm: true });
    const lines = [
      "plain snake_case",
      "> quoted snake_case and more_text here",
      "_lead and trail_",
      "x _a_ y",
      "under_score_ end",
      "_open only",
      "mid_ dle _word",
      "__dunder__",
      "a__b__c",
      "> 1_000_000 items",
      "\\_escaped_",
    ];
    for (const line of lines) {
      const html = marked.parse(line, { async: false }) as string;
      const markedHasEmphasis = /<(em|strong)>/.test(html);
      const highlighted = [...spans(line, "hljs-emphasis"), ...spans(line, "hljs-strong")].filter(
        (s) => s.startsWith("_")
      );
      expect({ line, emphasis: highlighted.length > 0 }).toEqual({
        line,
        emphasis: markedHasEmphasis,
      });
    }
  });
});
