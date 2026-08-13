import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { CanvasRichContentMenu } from "@/features/canvas/nodes/CanvasRichContentMenu";

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
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
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

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<CanvasRichContentMenu editor={editor} />);
    const trigger = screen.getByRole("button", { name: "canvas.moreFormatting" });
    fireEvent.click(trigger);
    expect(screen.getByTestId("table-size-2-3")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("table-size-2-3")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on outside pointer-down", () => {
    render(<CanvasRichContentMenu editor={editor} />);
    fireEvent.click(screen.getByRole("button", { name: "canvas.moreFormatting" }));
    expect(screen.getByTestId("table-size-2-3")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("table-size-2-3")).not.toBeInTheDocument();
  });

  it("stays within the viewport edges on a narrow screen", () => {
    Object.defineProperty(window, "innerWidth", { value: 320, configurable: true });
    render(<CanvasRichContentMenu editor={editor} />);
    const trigger = screen.getByRole("button", { name: "canvas.moreFormatting" });
    Object.defineProperty(trigger, "getBoundingClientRect", {
      value: () => ({
        top: 40,
        bottom: 64,
        left: 300,
        right: 320,
        width: 20,
        height: 24,
      }),
      configurable: true,
    });

    fireEvent.click(trigger);
    const menu = document.querySelector<HTMLElement>(".canvas-rich-content-menu");
    expect(menu).not.toBeNull();
    expect(menu?.style.left).toBe("88px");
  });

  it("never clamps to a negative offset when the menu is taller than the viewport", () => {
    Object.defineProperty(window, "innerWidth", { value: 320, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 100, configurable: true });
    render(<CanvasRichContentMenu editor={editor} />);
    const trigger = screen.getByRole("button", { name: "canvas.moreFormatting" });
    Object.defineProperty(trigger, "getBoundingClientRect", {
      value: () => ({
        top: 40,
        bottom: 64,
        left: 300,
        right: 320,
        width: 20,
        height: 24,
      }),
      configurable: true,
    });

    fireEvent.click(trigger);
    const menu = document.querySelector<HTMLElement>(".canvas-rich-content-menu");
    expect(menu).not.toBeNull();
    expect(parseFloat(menu?.style.top ?? "")).toBe(8);
    expect(parseFloat(menu?.style.left ?? "")).toBe(88);
  });

  it("caps the menu height to the viewport and scrolls internally", () => {
    render(<CanvasRichContentMenu editor={editor} />);
    fireEvent.click(screen.getByRole("button", { name: "canvas.moreFormatting" }));
    const menu = document.querySelector<HTMLElement>(".canvas-rich-content-menu");
    expect(menu).not.toBeNull();
    expect(menu).toHaveClass("overflow-y-auto", "max-h-[calc(100vh-1rem)]");
    expect(menu?.style.maxHeight).toBe("calc(100dvh - 1rem)");
  });
});
