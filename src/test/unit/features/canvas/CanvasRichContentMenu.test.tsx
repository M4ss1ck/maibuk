import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { createRichTextExtensions } from "../../../../components/editor/extensions/createRichTextExtensions";
import { CanvasRichContentMenu } from "../../../../features/canvas/nodes/CanvasRichContentMenu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../components/editor/ImageInsertDialog", () => ({
  ImageInsertDialog: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <button type="button" data-testid="image-dialog" onClick={onClose}>
        image
      </button>
    ) : null,
}));

vi.mock("../../../../components/editor/FootnoteDialog", () => ({
  FootnoteDialog: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <button type="button" data-testid="footnote-dialog" onClick={onClose}>
        footnote
      </button>
    ) : null,
}));

describe("CanvasRichContentMenu", () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor({ extensions: createRichTextExtensions(), content: "<p>hi</p>" });
  });

  afterEach(() => {
    editor.destroy();
  });

  it("inserts a table from the size picker", () => {
    render(<CanvasRichContentMenu editor={editor} />);
    fireEvent.click(screen.getByRole("button", { name: "canvas.moreFormatting" }));
    fireEvent.click(screen.getByTestId("table-size-2-3"));
    expect(editor.getHTML()).toContain("<table");
  });

  it("opens the image insertion dialog", () => {
    render(<CanvasRichContentMenu editor={editor} />);
    fireEvent.click(screen.getByRole("button", { name: "canvas.moreFormatting" }));
    fireEvent.click(screen.getByRole("button", { name: "editor.insertImage" }));
    expect(screen.getByTestId("image-dialog")).toBeInTheDocument();
  });

  it("opens the footnote insertion dialog", () => {
    render(<CanvasRichContentMenu editor={editor} />);
    fireEvent.click(screen.getByRole("button", { name: "canvas.moreFormatting" }));
    fireEvent.click(screen.getByRole("button", { name: "editor.insertFootnote" }));
    expect(screen.getByTestId("footnote-dialog")).toBeInTheDocument();
  });

  it("reports overlay open and close transitions", () => {
    const onOverlayOpenChange = vi.fn();
    render(<CanvasRichContentMenu editor={editor} onOverlayOpenChange={onOverlayOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "canvas.moreFormatting" }));
    expect(onOverlayOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "editor.insertImage" }));
    expect(onOverlayOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByTestId("image-dialog"));
    expect(onOverlayOpenChange).toHaveBeenLastCalledWith(false);
  });
});
