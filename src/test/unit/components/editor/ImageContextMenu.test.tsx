import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { ImageContextMenu } from "@/components/editor/ImageContextMenu";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const IMAGE_HTML =
  '<p>before</p><figure data-image data-alignment="center"><img src="data:image/png;base64,AAAA" alt="A lamp"><figcaption></figcaption></figure><p>after</p>';

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function renderMenu() {
  const editor = new Editor({ extensions: createRichTextExtensions(), content: IMAGE_HTML });
  editors.push(editor);
  render(
    <>
      <EditorContent editor={editor} />
      <ImageContextMenu editor={editor} />
    </>
  );
  const imagePos = imageNodePos(editor);
  editor.commands.setNodeSelection(imagePos);
  editor.view.dom.focus();
  return { editor, imagePos };
}

function imageNodePos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.descendants((node, nodePos) => {
    if (node.type.name === "image") pos = nodePos;
  });
  return pos;
}

describe("ImageContextMenu", () => {
  it("opens a named menu with Shift+F10 on a selected image", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.keyboard("{Shift>}{F10}{/Shift}");

    expect(screen.getByRole("menu", { name: "editor.imageOptions" })).toBeInTheDocument();
  });

  it("runs an alignment action from the keyboard", async () => {
    const user = userEvent.setup();
    const { editor } = renderMenu();

    await user.keyboard("{Shift>}{F10}{/Shift}");
    const menu = screen.getByRole("menu", { name: "editor.imageOptions" });
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "editor.alignRight" })).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(editor.getHTML()).toContain('data-alignment="right"'));
    expect(screen.queryByRole("menu", { name: "editor.imageOptions" })).not.toBeInTheDocument();
  });

  it("Escape closes the menu and hands focus back to the editor", async () => {
    const user = userEvent.setup();
    const { editor } = renderMenu();

    await user.keyboard("{Shift>}{F10}{/Shift}");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu", { name: "editor.imageOptions" })).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
  });

  it("does nothing when the selection is not on an image", async () => {
    const user = userEvent.setup();
    const { editor } = renderMenu();
    editor.commands.setTextSelection(1);

    await user.keyboard("{Shift>}{F10}{/Shift}");

    expect(screen.queryByRole("menu", { name: "editor.imageOptions" })).not.toBeInTheDocument();
  });
});
