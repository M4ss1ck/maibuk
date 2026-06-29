import { describe, expect, it, vi } from "vitest";
import { createRichTextExtensions } from "../../../../components/editor/extensions/createRichTextExtensions";

describe("createRichTextExtensions", () => {
  it("returns the canonical rich-text schema with unique extension names", () => {
    const extensions = createRichTextExtensions({
      onMarkdownPaste: vi.fn(),
      footnoteStartIndex: 1,
      spellCheck: { enabled: true, language: "en" },
    });
    const names = extensions.map((extension) => extension.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "starterKit",
        "italic",
        "highlight",
        "typography",
        "table",
        "image",
        "link",
        "pasteHandler",
        "copyHandler",
        "footnote",
        "spellCheck",
      ])
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("omits the spell-check extension when no spell-check options are given", () => {
    const names = createRichTextExtensions().map((extension) => extension.name);
    expect(names).not.toContain("spellCheck");
  });

  it("configures the paste handler with the provided markdown callback", () => {
    const onMarkdownPaste = vi.fn();
    const extensions = createRichTextExtensions({ onMarkdownPaste });
    const pasteHandler = extensions.find((extension) => extension.name === "pasteHandler");
    expect(pasteHandler?.options.onMarkdownPaste).toBe(onMarkdownPaste);
  });
});
