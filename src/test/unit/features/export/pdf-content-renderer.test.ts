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
import { mapCssFontToPdf } from "../../../../features/export/pdf-content-renderer";
import { createPdfStyles } from "../../../../features/export/pdf-styles";
import { DEFAULT_PDF_OPTIONS } from "../../../../features/export/types";

/**
 * Extract all `key` values from a flat ReactNode array (one level deep).
 * Skips plain strings (text nodes have no key).
 */
function extractKeys(nodes: unknown[]): (string | number | null)[] {
  return nodes
    .filter(
      (n): n is { key: string | number | null } => n !== null && typeof n === "object" && "key" in n
    )
    .map((n) => n.key);
}

function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    node.forEach((child) => {
      collectText(child, out);
    });
  } else if (node && typeof node === "object" && "props" in node) {
    collectText((node as { props?: { children?: unknown } }).props?.children, out);
  }
  return out;
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
      .filter(
        (c): c is { key: string | number | null } =>
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
      expect(dupes, `Duplicate sibling keys: ${dupes} in group ${JSON.stringify(group)}`).toEqual(
        []
      );
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
    const html = "<p><strong>A</strong> <span><em>B</em> <u>C</u></span> <em>D</em></p>";
    const nodes = renderHtmlContent(html, styles);
    assertNoDuplicateSiblingKeys(nodes);
  });

  it("assigns unique keys with deeply nested pass-through spans", () => {
    const html = "<p><em>A</em><span><span><strong>B</strong></span></span></p>";
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
    const html = "<ul><li><em>A</em> text</li><li><strong>B</strong> text</li></ul>";
    const nodes = renderHtmlContent(html, styles);
    assertNoDuplicateSiblingKeys(nodes);
  });

  it("assigns unique keys in blockquotes with inline elements", () => {
    const html = "<blockquote><p><em>first</em> <strong>second</strong></p></blockquote>";
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

describe("renderSceneBreak (PDF)", () => {
  it("renders a text scene break with its symbols", () => {
    const tree = renderHtmlContent('<p class="scene-break">❧</p>', styles);
    const sceneBreak = tree[0] as { props?: { style?: unknown } };

    expect(collectText(tree).join("")).toContain("❧");
    expect(sceneBreak.props?.style).toBe(styles.sceneBreak);
  });

  it("renders an image scene break as an Image", () => {
    const tree = renderHtmlContent(
      '<figure class="scene-break"><img src="data:image/png;base64,AA" /></figure>',
      styles
    );
    const sceneBreak = tree[0] as { props?: { style?: unknown } };

    expect(JSON.stringify(tree)).toContain("data:image/png;base64,AA");
    expect(sceneBreak.props?.style).toBe(styles.sceneBreak);
  });
});

describe("code blocks (PDF)", () => {
  it("renders a <pre><code> block with the code-block style and its text", () => {
    const tree = renderHtmlContent("<pre><code>const x = 1;</code></pre>", styles);
    const block = tree[0] as { props?: { style?: unknown } };

    expect(block.props?.style).toBe(styles.codeBlock);
    expect(collectText(tree).join("")).toContain("const x = 1;");
  });

  it("preserves newlines inside a code block", () => {
    const tree = renderHtmlContent("<pre><code>line1\nline2</code></pre>", styles);
    expect(collectText(tree).join("")).toBe("line1\nline2");
  });

  it("renders inline <code> with the inline code style", () => {
    const tree = renderHtmlContent("<p>use <code>npm</code> now</p>", styles);
    const inlineCode = JSON.stringify(tree);
    expect(inlineCode).toContain("npm");
    expect(collectText(tree).join("")).toContain("npm");
  });
});

// ---------------------------------------------------------------------------
// mapCssFontToPdf()
// ---------------------------------------------------------------------------

describe("mapCssFontToPdf()", () => {
  it("maps serif fonts to Times-Roman", () => {
    expect(mapCssFontToPdf("Literata, serif")).toBe("Times-Roman");
    expect(mapCssFontToPdf("Georgia, serif")).toBe("Times-Roman");
    expect(mapCssFontToPdf("Times New Roman, serif")).toBe("Times-Roman");
    expect(mapCssFontToPdf("serif")).toBe("Times-Roman");
  });

  it("maps sans-serif fonts to Helvetica", () => {
    expect(mapCssFontToPdf("Inter, sans-serif")).toBe("Helvetica");
    expect(mapCssFontToPdf("Arial, sans-serif")).toBe("Helvetica");
    expect(mapCssFontToPdf("DejaVu Sans, sans-serif")).toBe("Helvetica");
    expect(mapCssFontToPdf("Ubuntu, sans-serif")).toBe("Helvetica");
    expect(mapCssFontToPdf("Verdana, sans-serif")).toBe("Helvetica");
    expect(mapCssFontToPdf("Trebuchet MS, sans-serif")).toBe("Helvetica");
    expect(mapCssFontToPdf("Helvetica")).toBe("Helvetica");
    expect(mapCssFontToPdf("Tahoma, sans-serif")).toBe("Helvetica");
    expect(mapCssFontToPdf("Segoe UI, sans-serif")).toBe("Helvetica");
  });

  it("maps monospace fonts to Courier", () => {
    expect(mapCssFontToPdf("monospace")).toBe("Courier");
    expect(mapCssFontToPdf("Courier New, monospace")).toBe("Courier");
    expect(mapCssFontToPdf("Consolas, monospace")).toBe("Courier");
  });

  it("defaults to Times-Roman for unknown fonts", () => {
    expect(mapCssFontToPdf("CustomFont")).toBe("Times-Roman");
    expect(mapCssFontToPdf("")).toBe("Times-Roman");
  });

  it("is case-insensitive", () => {
    expect(mapCssFontToPdf("ARIAL, SANS-SERIF")).toBe("Helvetica");
    expect(mapCssFontToPdf("COURIER NEW")).toBe("Courier");
  });
});

// ---------------------------------------------------------------------------
// Inline style rendering (color, font-family, font-size, highlights)
// ---------------------------------------------------------------------------

describe("renderHtmlContent() inline style preservation", () => {
  /**
   * Helper to extract the `style` prop from the first inline child
   * of the first paragraph node. Handles both single-child and array-children
   * (React stores a single child directly, not in an array).
   */
  function getFirstInlineStyle(nodes: unknown[]): Record<string, unknown> | undefined {
    const paragraph = nodes[0] as { props?: { children?: unknown } };
    const rawChildren = paragraph?.props?.children;
    const children = Array.isArray(rawChildren) ? rawChildren : rawChildren ? [rawChildren] : [];
    // First child that is an element (skip plain text)
    const inlineEl = children.find(
      (c): c is { props: { style: Record<string, unknown> } } =>
        c !== null &&
        typeof c === "object" &&
        "props" in c &&
        !!(c as { props?: { style?: unknown } }).props?.style
    );
    return inlineEl?.props?.style;
  }

  it("applies text color from span style attribute", () => {
    const html = '<p><span style="color: #EF4444">red text</span></p>';
    const nodes = renderHtmlContent(html, styles);
    const inlineStyle = getFirstInlineStyle(nodes);
    expect(inlineStyle).toBeDefined();
    expect(inlineStyle?.color).toBe("#EF4444");
  });

  it("maps font-family to a react-pdf built-in font", () => {
    const html = '<p><span style="font-family: Georgia, serif">serif text</span></p>';
    const nodes = renderHtmlContent(html, styles);
    const inlineStyle = getFirstInlineStyle(nodes);
    expect(inlineStyle).toBeDefined();
    expect(inlineStyle?.fontFamily).toBe("Times-Roman");
  });

  it("maps sans-serif font-family to Helvetica", () => {
    const html = '<p><span style="font-family: Inter, sans-serif">sans text</span></p>';
    const nodes = renderHtmlContent(html, styles);
    const inlineStyle = getFirstInlineStyle(nodes);
    expect(inlineStyle).toBeDefined();
    expect(inlineStyle?.fontFamily).toBe("Helvetica");
  });

  it("converts font-size from px to pt", () => {
    const html = '<p><span style="font-size: 24px">big text</span></p>';
    const nodes = renderHtmlContent(html, styles);
    const inlineStyle = getFirstInlineStyle(nodes);
    expect(inlineStyle).toBeDefined();
    // 24px * 0.75 = 18pt
    expect(inlineStyle?.fontSize).toBe(18);
  });

  it("preserves multiple inline styles on a single span", () => {
    const html =
      '<p><span style="color: #3B82F6; font-family: Arial, sans-serif; font-size: 16px">styled</span></p>';
    const nodes = renderHtmlContent(html, styles);
    const inlineStyle = getFirstInlineStyle(nodes);
    expect(inlineStyle).toBeDefined();
    expect(inlineStyle?.color).toBe("#3B82F6");
    expect(inlineStyle?.fontFamily).toBe("Helvetica");
    expect(inlineStyle?.fontSize).toBe(12); // 16px * 0.75 = 12pt
  });

  it("passes through spans without inline styles (no wrapper)", () => {
    const html = "<p><span>plain text</span></p>";
    const nodes = renderHtmlContent(html, styles);
    // The span should be a pass-through — text is directly in the paragraph
    const paragraph = nodes[0] as { props?: { children?: unknown[] } };
    const rawChildren = paragraph?.props?.children;
    const children = Array.isArray(rawChildren) ? rawChildren : rawChildren ? [rawChildren] : [];
    expect(children.length).toBeGreaterThan(0);
    // Should contain plain text, not a styled Text element
    const hasStyledChild = children.some(
      (c) =>
        c !== null &&
        typeof c === "object" &&
        "props" in c &&
        !!(c as { props?: { style?: unknown } }).props?.style
    );
    expect(hasStyledChild).toBe(false);
  });

  it("applies background-color from mark elements", () => {
    const html = '<p><mark style="background-color: #22C55E">highlighted</mark></p>';
    const nodes = renderHtmlContent(html, styles);
    const inlineStyle = getFirstInlineStyle(nodes);
    expect(inlineStyle).toBeDefined();
    expect(inlineStyle?.backgroundColor).toBe("#22C55E");
  });

  it("defaults mark background to yellow when no style is present", () => {
    const html = "<p><mark>highlighted</mark></p>";
    const nodes = renderHtmlContent(html, styles);
    const inlineStyle = getFirstInlineStyle(nodes);
    expect(inlineStyle).toBeDefined();
    expect(inlineStyle?.backgroundColor).toBe("#ffff00");
  });

  it("assigns unique keys when styled spans are present", () => {
    const html = '<p><span style="color: red">A</span> <span style="color: blue">B</span></p>';
    const nodes = renderHtmlContent(html, styles);
    assertNoDuplicateSiblingKeys(nodes);
  });

  it("assigns unique keys with mixed styled spans and plain formatting", () => {
    const html =
      '<p><em>italic</em> <span style="color: #EF4444"><strong>red bold</strong></span> plain</p>';
    const nodes = renderHtmlContent(html, styles);
    assertNoDuplicateSiblingKeys(nodes);
  });
});
