import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { ChapterOutline } from "@/components/editor/ChapterOutline";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/components/ui", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function makeEditor(headings: { level: number; text: string }[]): TiptapEditor {
  const nodes = headings.map((h) => ({
    type: { name: "heading" },
    attrs: { level: h.level },
    textContent: h.text,
  }));
  return {
    state: {
      doc: {
        forEach: (cb: (node: unknown, offset: number) => void) => {
          nodes.forEach((node, index) => {
            cb(node, index);
          });
        },
      },
      selection: { from: 0 },
    },
    on: () => {},
    off: () => {},
    view: { nodeDOM: () => null },
    commands: { setTextSelection: () => {} },
  } as unknown as TiptapEditor;
}

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("ChapterOutline", () => {
  it("moves focus between headings with ArrowDown/ArrowUp and clamps at the ends", async () => {
    const user = userEvent.setup();
    render(
      <ChapterOutline
        editor={makeEditor([
          { level: 1, text: "One" },
          { level: 1, text: "Two" },
          { level: 1, text: "Three" },
        ])}
      />
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);

    buttons[0].focus();
    await user.keyboard("{ArrowDown}");
    expect(buttons[1]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(buttons[2]).toHaveFocus();

    // Clamps at the last heading instead of scrolling away.
    await user.keyboard("{ArrowDown}");
    expect(buttons[2]).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(buttons[1]).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(buttons[0]).toHaveFocus();

    // Clamps at the first heading.
    await user.keyboard("{ArrowUp}");
    expect(buttons[0]).toHaveFocus();
  });

  it("Enter on an outline item puts the caret at that heading in the editor", async () => {
    const user = userEvent.setup();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    const editor = new Editor({
      extensions: createRichTextExtensions(),
      content: "<p>Intro</p><h1>Chapter One</h1><p>Body</p>",
    });
    editors.push(editor);
    render(
      <>
        <EditorContent editor={editor} />
        <ChapterOutline editor={editor} />
      </>
    );

    screen.getByRole("button", { name: "Chapter One" }).focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
    let headingPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading" && node.textContent === "Chapter One") headingPos = pos;
    });
    expect(editor.state.selection.from).toBe(headingPos + 1);
  });
});
