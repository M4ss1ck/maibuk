import { Editor } from "@tiptap/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LineHeightSelect } from "@/components/editor/LineHeightSelect";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
  }
});

function makeEditor(): Editor {
  const editor = new Editor({
    extensions: createRichTextExtensions(),
    content: "<p>Hello</p>",
  });
  editors.push(editor);
  editor.commands.setTextSelection(1);
  return editor;
}

function html(editor: Editor): string {
  return editor.getHTML().replace(/;"/g, '"');
}

describe("LineHeightSelect", () => {
  it("sets the block attribute when the arrow keys choose 1", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    render(<LineHeightSelect editor={editor} value="1.75" />);

    await user.tab();
    expect(screen.getByRole("combobox")).toHaveFocus();
    // Open the list, walk up from the current 1.75 to 1, then choose it.
    await user.keyboard("{ArrowDown}{ArrowUp}{ArrowUp}{ArrowUp}{Enter}");

    expect(html(editor)).toContain('<p style="line-height: 1; --line-height: 1">Hello</p>');
  });

  it("removes the block attribute when 1.75 is entered", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    editor.chain().setLineHeight("1").run();
    render(<LineHeightSelect editor={editor} value="" />);

    await user.tab();
    expect(screen.getByRole("combobox")).toHaveFocus();
    await user.keyboard("1.75{Enter}");

    expect(html(editor)).toBe("<p>Hello</p>");
  });

  it("accepts a typed custom value", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    render(<LineHeightSelect editor={editor} value="" />);

    await user.tab();
    expect(screen.getByRole("combobox")).toHaveFocus();
    await user.keyboard("1.3{Enter}");

    expect(html(editor)).toContain('<p style="line-height: 1.3; --line-height: 1.3">Hello</p>');
  });
});
