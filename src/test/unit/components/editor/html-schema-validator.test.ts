import { describe, it, expect } from "vitest";
import { validateHtml } from "../../../../components/editor/html-schema-validator";

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
});
