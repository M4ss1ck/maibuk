import { describe, expect, it, vi } from "vitest";

// Stub @react-pdf/renderer so createElement gets real React elements with keys
vi.mock("@react-pdf/renderer", () => ({
  Text: "Text",
  View: "View",
  Image: "Image",
  Link: "Link",
  StyleSheet: { create: (s: Record<string, unknown>) => s },
}));

import { renderHtmlContent } from "../../../../features/export/pdf-content-renderer";
import { createPdfStyles } from "../../../../features/export/pdf-styles";
import { DEFAULT_PDF_OPTIONS } from "../../../../features/export/types";

/**
 * Extract all `key` values from a flat ReactNode array (one level deep).
 * Skips plain strings (text nodes have no key).
 */
function extractKeys(nodes: unknown[]): (string | number | null)[] {
  return nodes
    .filter((n): n is { key: string | number | null } =>
      n !== null && typeof n === "object" && "key" in n
    )
    .map((n) => n.key);
}

/**
 * Recursively collect every `key` from an element tree.
 * Returns them grouped by parent so we can check siblings.
 */
function collectSiblingKeys(node: unknown): (string | number | null)[][] {
  if (node === null || typeof node !== "object") return [];
  const el = node as { key?: string | number | null; props?: { children?: unknown } };

  const groups: (string | number | null)[][] = [];

  const children = el.props?.children;
  if (Array.isArray(children)) {
    const childKeys = children
      .filter((c): c is { key: string | number | null } =>
        c !== null && typeof c === "object" && "key" in c
      )
      .map((c) => c.key);
    if (childKeys.length > 0) {
      groups.push(childKeys);
    }
    for (const child of children) {
      groups.push(...collectSiblingKeys(child));
    }
  } else if (children && typeof children === "object") {
    groups.push(...collectSiblingKeys(children));
  }

  return groups;
}

/** Check that no sibling group has duplicate keys */
function assertNoDuplicateSiblingKeys(nodes: unknown[]) {
  // Check the top-level array itself
  const topKeys = extractKeys(nodes);
  const topDuplicates = topKeys.filter((k, idx) => topKeys.indexOf(k) !== idx);
  expect(topDuplicates, `Duplicate keys in top-level nodes: ${topDuplicates}`).toEqual([]);

  // Check every nested sibling group
  for (const node of nodes) {
    const groups = collectSiblingKeys(node);
    for (const group of groups) {
      const dupes = group.filter((k, idx) => group.indexOf(k) !== idx);
      expect(dupes, `Duplicate sibling keys: ${dupes} in group ${JSON.stringify(group)}`).toEqual([]);
    }
  }
}

const styles = createPdfStyles(DEFAULT_PDF_OPTIONS);

describe("renderHtmlContent() key uniqueness", () => {
  it("assigns unique keys to basic paragraphs", () => {
    const nodes = renderHtmlContent("<p>Hello</p><p>World</p>", styles);
    assertNoDuplicateSiblingKeys(nodes);
    expect(nodes).toHaveLength(2);
  });

  it("assigns unique keys when inline elements and text are mixed", () => {
    const html = "<p>Some <em>italic</em> and <strong>bold</strong> text</p>";
    const nodes = renderHtmlContent(html, styles);
    assertNoDuplicateSiblingKeys(nodes);
  });

  it("assigns unique keys when a span wraps inline elements (pass-through case)", () => {
    // This is the exact pattern that caused the i-0 collision:
    // <em> gets key i-0, then <span>'s child <em> also gets key i-0
    const html = "<p><em>word1</em> <span><em>word2</em></span></p>";
    const nodes = renderHtmlContent(html, styles);
    assertNoDuplicateSiblingKeys(nodes);
  });

  it("assigns unique keys with nested spans containing multiple elements", () => {
    const html =
      "<p><strong>A</strong> <span><em>B</em> <u>C</u></span> <em>D</em></p>";
    const nodes = renderHtmlContent(html, styles);
    assertNoDuplicateSiblingKeys(nodes);
  });

  it("assigns unique keys with deeply nested pass-through spans", () => {
    const html =
      "<p><em>A</em><span><span><strong>B</strong></span></span></p>";
    const nodes = renderHtmlContent(html, styles);
    assertNoDuplicateSiblingKeys(nodes);
  });

  it("assigns unique keys with multiple paragraphs containing overlapping inline patterns", () => {
    const html = [
      "<p><em>italic1</em> plain <strong>bold1</strong></p>",
      "<p><em>italic2</em> plain <strong>bold2</strong></p>",
    ].join("");
    const nodes = renderHtmlContent(html, styles);
    assertNoDuplicateSiblingKeys(nodes);
  });

  it("assigns unique keys in lists with inline formatting", () => {
    const html =
      "<ul><li><em>A</em> text</li><li><strong>B</strong> text</li></ul>";
    const nodes = renderHtmlContent(html, styles);
    assertNoDuplicateSiblingKeys(nodes);
  });

  it("assigns unique keys in blockquotes with inline elements", () => {
    const html =
      "<blockquote><p><em>first</em> <strong>second</strong></p></blockquote>";
    const nodes = renderHtmlContent(html, styles);
    assertNoDuplicateSiblingKeys(nodes);
  });

  it("handles empty HTML gracefully", () => {
    const nodes = renderHtmlContent("", styles);
    expect(nodes).toEqual([]);
  });

  it("assigns unique keys with adjacent unknown inline elements (pass-through)", () => {
    // <abbr> and <cite> are unknown inline elements that pass-through like span
    const html = "<p><abbr><em>A</em></abbr><cite><em>B</em></cite></p>";
    const nodes = renderHtmlContent(html, styles);
    assertNoDuplicateSiblingKeys(nodes);
  });
});
