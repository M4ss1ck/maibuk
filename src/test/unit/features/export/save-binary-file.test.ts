import { describe, expect, it } from "vitest";
import { exportFilename } from "../../../../features/export/save-binary-file";

describe("exportFilename()", () => {
  it("slugifies a title with the given extension", () => {
    expect(exportFilename("My Chapter Title", "pdf")).toBe("my-chapter-title.pdf");
  });

  it("collapses non-alphanumeric runs into single hyphens", () => {
    expect(exportFilename("Hello,  World! #2", "png")).toBe("hello-world-2.png");
  });

  it("trims leading and trailing hyphens", () => {
    expect(exportFilename("  ...edge...  ", "pdf")).toBe("edge.pdf");
  });

  it("falls back to 'untitled' for empty/symbol-only titles", () => {
    expect(exportFilename("", "png")).toBe("untitled.png");
    expect(exportFilename("***", "pdf")).toBe("untitled.pdf");
  });
});
