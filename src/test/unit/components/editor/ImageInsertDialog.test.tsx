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

function renderDialog() {
  const editor = new Editor({ extensions: createRichTextExtensions(), content: "<p>Body</p>" });
  editors.push(editor);
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
});
