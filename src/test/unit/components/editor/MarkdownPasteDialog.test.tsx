import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { MarkdownPasteDialog } from "@/components/editor/MarkdownPasteDialog";
import { plainTextToEditorHtml } from "@/components/editor/plain-text-html";
import { markdownToEditorHtml } from "@/features/markdown";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function createEditorStub() {
  const chainApi = {
    focus: vi.fn(() => chainApi),
    insertContent: vi.fn(() => chainApi),
    run: vi.fn(),
  };
  const editor = { chain: vi.fn(() => chainApi) } as unknown as Editor;
  return { editor, chainApi };
}

const markdown = "# Title\n\nbody";

describe("MarkdownPasteDialog", () => {
  it("pastes the markdown as plain text and closes", () => {
    const { editor, chainApi } = createEditorStub();
    const onClose = vi.fn();
    render(<MarkdownPasteDialog editor={editor} markdown={markdown} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "editor.pasteAsIs" }));

    expect(chainApi.focus).toHaveBeenCalled();
    expect(chainApi.insertContent).toHaveBeenCalledWith(plainTextToEditorHtml(markdown));
    expect(chainApi.run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("converts the markdown to rich content and closes", () => {
    const { editor, chainApi } = createEditorStub();
    const onClose = vi.fn();
    render(<MarkdownPasteDialog editor={editor} markdown={markdown} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "editor.convert" }));

    expect(chainApi.focus).toHaveBeenCalled();
    expect(chainApi.insertContent).toHaveBeenCalledWith(markdownToEditorHtml(markdown));
    expect(chainApi.run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when there is no pending markdown", () => {
    const { editor } = createEditorStub();
    render(<MarkdownPasteDialog editor={editor} markdown={null} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "editor.convert" })).toBeNull();
  });
});
