import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { ImageInsertDialog } from "@/components/editor/ImageInsertDialog";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function renderDialog(content = "<p>Body</p>", caret?: number) {
  const editor = new Editor({ extensions: createRichTextExtensions(), content });
  editors.push(editor);
  if (caret !== undefined) editor.commands.setTextSelection(caret);
  render(
    <>
      <EditorContent editor={editor} />
      <ImageInsertDialog editor={editor} isOpen onClose={() => {}} />
    </>
  );
  return editor;
}

describe("ImageInsertDialog", () => {
  it("selects the inserted image so its keyboard menu is one shortcut away", async () => {
    const user = userEvent.setup();
    const editor = renderDialog();

    const url = screen.getByRole("textbox", { name: "editor.imageUrl" });
    await user.type(url, "data:image/png;base64,AAAA");
    await user.click(screen.getByRole("button", { name: "common.insert" }));

    expect(editor.getHTML()).toContain("<img");
    const selected = (editor.state.selection as unknown as { node?: { type: { name: string } } })
      .node;
    expect(selected?.type.name).toBe("image");
  });

  // Picking the image nearest the caret chose an existing neighbour whenever
  // one sat closer than the inserted image (audit of #225).
  it.each([
    ["at the start of a short paragraph before an image", '<p>x</p><img src="old.png">', 1],
    ["right after an existing image", '<img src="old.png"><p>x</p>', 3],
    ["between two existing images", '<img src="before.png"><p>ab</p><img src="after.png">', 3],
  ])("selects the inserted image, not a neighbour, %s", async (_case, content, caret) => {
    const user = userEvent.setup();
    const editor = renderDialog(content, caret);

    await user.type(
      screen.getByRole("textbox", { name: "editor.imageUrl" }),
      "data:image/png;base64,AAAA"
    );
    await user.click(screen.getByRole("button", { name: "common.insert" }));

    const selected = (
      editor.state.selection as unknown as {
        node?: { type: { name: string }; attrs: { src: string } };
      }
    ).node;
    expect(selected?.type.name).toBe("image");
    expect(selected?.attrs.src).toBe("data:image/png;base64,AAAA");
  });

  it("selects the inserted image when a neighbour shows the same picture", async () => {
    const user = userEvent.setup();
    const src = "data:image/png;base64,AAAA";
    const editor = renderDialog(`<p>x</p><img src="${src}">`, 1);

    await user.type(screen.getByRole("textbox", { name: "editor.imageUrl" }), src);
    await user.click(screen.getByRole("button", { name: "common.insert" }));

    const imagePositions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") imagePositions.push(pos);
    });
    expect(imagePositions).toHaveLength(2);
    // The new image lands before the paragraph; the old one stays after it.
    expect(editor.state.selection.from).toBe(imagePositions[0]);
  });
});
