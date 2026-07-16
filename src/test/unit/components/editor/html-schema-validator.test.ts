import { describe, it, expect, vi } from "vitest";
import { validateHtml, createHtmlLinter } from "@/components/editor/html-schema-validator";
import { findBlockOffsetInHtml } from "@/components/editor/HtmlInspectMenu";

describe("validateHtml", () => {
  it("returns no diagnostics for valid HTML", () => {
    const diagnostics = validateHtml("<p>Hello <strong>world</strong></p>");
    expect(diagnostics).toEqual([]);
  });

  it("detects unclosed tags", () => {
    const diagnostics = validateHtml("<p>Hello <strong>world</p>");
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].severity).toBe("error");
  });

  it("detects invalid nesting", () => {
    const diagnostics = validateHtml("<p>Hello <p>nested</p></p>");
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("handles empty input", () => {
    const diagnostics = validateHtml("");
    expect(diagnostics).toEqual([]);
  });

  it("handles self-closing tags", () => {
    const diagnostics = validateHtml("<p>Hello<br>world</p><hr>");
    expect(diagnostics).toEqual([]);
  });

  it("handles XHTML-style self-closing tags", () => {
    const diagnostics = validateHtml("<p>Hello<br/>world</p><img src='x'/>");
    expect(diagnostics).toEqual([]);
  });

  it("handles tags with attributes containing >", () => {
    // The regex-based approach won't perfectly handle this, but should not crash
    const diagnostics = validateHtml('<p title="a>b">text</p>');
    // We expect it to run without throwing
    expect(Array.isArray(diagnostics)).toBe(true);
  });

  it("handles HTML comments gracefully", () => {
    const diagnostics = validateHtml("<p>Hello</p><!-- comment --><p>World</p>");
    expect(diagnostics).toEqual([]);
  });

  it("warns on auto-closing p tags", () => {
    const diagnostics = validateHtml("<p>First<p>Second</p>");
    const warning = diagnostics.find((d) => d.severity === "warning");
    expect(warning).toBeDefined();
    expect(warning!.message).toContain("implicitly closes");
  });

  it("handles whitespace-only input", () => {
    const diagnostics = validateHtml("   \n\t  ");
    expect(diagnostics).toEqual([]);
  });

  it("reports correct positions for unclosed tags", () => {
    const html = "<div><span>text</div>";
    const diagnostics = validateHtml(html);
    const unclosed = diagnostics.find((d) => d.message.includes("Unexpected closing"));
    expect(unclosed).toBeDefined();
    expect(unclosed!.from).toBe(html.indexOf("</div>"));
  });

  it("handles deeply nested valid HTML", () => {
    const diagnostics = validateHtml(
      "<div><ul><li><p><strong><em>deep</em></strong></p></li></ul></div>"
    );
    expect(diagnostics).toEqual([]);
  });
});

describe("createHtmlLinter", () => {
  it("calls the linter factory with a callback and options", () => {
    const fakeLinter = vi.fn().mockReturnValue("linter-extension");
    const result = createHtmlLinter(fakeLinter);

    expect(result).toBe("linter-extension");
    expect(fakeLinter).toHaveBeenCalledWith(expect.any(Function), { delay: 300 });
  });

  it("linter callback returns diagnostics from validateHtml", () => {
    let capturedCallback: (view: any) => any;
    const fakeLinter = vi.fn().mockImplementation((cb: any) => {
      capturedCallback = cb;
      return "linter-extension";
    });
    createHtmlLinter(fakeLinter);

    const mockView = { state: { doc: { toString: () => "<p>Hello <strong>world</p>" } } };
    const diagnostics = capturedCallback!(mockView);
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});

describe("findBlockOffsetInHtml", () => {
  it("returns null for empty HTML", () => {
    expect(findBlockOffsetInHtml("", 1)).toBeNull();
  });

  it("returns null for out-of-range block index", () => {
    expect(findBlockOffsetInHtml("<p>Hello</p>", 5)).toBeNull();
  });

  it("finds the first block tag", () => {
    const html = "<p>Hello world</p>";
    const result = findBlockOffsetInHtml(html, 1);
    expect(result).toEqual({ from: 0, to: html.length });
  });

  it("finds the second block in a sequence", () => {
    const html = "<p>First</p><p>Second</p>";
    const result = findBlockOffsetInHtml(html, 2);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(html.indexOf("<p>Second"));
    expect(html.slice(result!.from, result!.to)).toBe("<p>Second</p>");
  });

  it("finds nested block tags (list items)", () => {
    const html = "<ul><li>Item 1</li><li>Item 2</li></ul>";
    // Block 1 = <ul>, Block 2 = first <li>, Block 3 = second <li>
    const result = findBlockOffsetInHtml(html, 2);
    expect(result).not.toBeNull();
    expect(html.slice(result!.from, result!.to)).toBe("<li>Item 1</li>");
  });

  it("handles heading tags", () => {
    const html = "<h1>Title</h1><p>Content</p>";
    const result = findBlockOffsetInHtml(html, 1);
    expect(result).not.toBeNull();
    expect(html.slice(result!.from, result!.to)).toBe("<h1>Title</h1>");
  });

  it("handles block tags with attributes", () => {
    const html = '<p class="intro">Hello</p>';
    const result = findBlockOffsetInHtml(html, 1);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(0);
    expect(html.slice(result!.from, result!.to)).toBe('<p class="intro">Hello</p>');
  });
});
