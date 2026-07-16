import type { Editor } from "@tiptap/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../components/editor/clipboard", () => ({
  readClipboardSnapshot: vi.fn(),
  readClipboardImageDataUrl: vi.fn(),
  hasRichFormatting: (html: string) => html.includes("<b"),
  snapshotToPlainText: (snap: { text: string; html: string | null }) =>
    snap.text || (snap.html ? "stripped" : ""),
  plainTextToHtml: (text: string) => `<p>${text}</p>`,
}));

vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: { getState: () => ({ pasteCleanup: {} }) },
}));

vi.mock("../../../../components/editor/paste-cleanup", () => ({
  cleanPastedHtml: (html: string) => html,
}));

import { readClipboardSnapshot } from "@/components/editor/clipboard";
import { fallbackPaste, pasteWithoutFormatting } from "@/components/editor/useClipboardProbe";

function buildEditor() {
  const run = vi.fn();
  const insertContent = vi.fn(() => ({ run }));
  const focus = vi.fn(() => ({ insertContent, run }));
  const chain = vi.fn(() => ({ focus, insertContent, run }));
  return {
    insertContent,
    editor: { chain } as unknown as Editor,
  };
}

const mockSnap = readClipboardSnapshot as unknown as ReturnType<typeof vi.fn>;

describe("pasteWithoutFormatting", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts clipboard text as escaped plain-text HTML", async () => {
    mockSnap.mockResolvedValue({
      text: "hello",
      html: "<b>x</b>",
      hasImage: false,
    });
    const { editor, insertContent } = buildEditor();
    await pasteWithoutFormatting(editor);
    expect(insertContent).toHaveBeenCalledWith("<p>hello</p>");
  });

  it("does nothing when there is no text", async () => {
    mockSnap.mockResolvedValue({ text: "", html: null, hasImage: false });
    const { editor, insertContent } = buildEditor();
    await pasteWithoutFormatting(editor);
    expect(insertContent).not.toHaveBeenCalled();
  });
});

describe("fallbackPaste", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cleans and inserts html", async () => {
    mockSnap.mockResolvedValue({ text: "", html: "<b>x</b>", hasImage: false });
    const { editor, insertContent } = buildEditor();
    await fallbackPaste(editor);
    expect(insertContent).toHaveBeenCalledWith("<b>x</b>");
  });
});
