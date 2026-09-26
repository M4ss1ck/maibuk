import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { EditorContextMenu } from "@/components/editor/EditorContextMenu";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../components/editor/useClipboardProbe", () => ({
  fallbackPaste: vi.fn(),
  pasteWithoutFormatting: vi.fn(),
  probeClipboard: vi.fn().mockResolvedValue({ canPaste: false, hasFormatting: false }),
  useClipboardProbe: () => vi.fn().mockResolvedValue({ canPaste: false, hasFormatting: false }),
}));

vi.mock("../../../../lib/spellcheck", () => ({
  spellCheckService: { suggest: vi.fn().mockResolvedValue([]) },
}));

function buildEditor(href: string) {
  const dom = document.createElement("div");
  dom.innerHTML = `<p><a class="editor-link" href="${href}">Linked text</a></p>`;

  const run = vi.fn();
  const extendMarkRange = vi.fn(() => ({ run }));
  const setTextSelection = vi.fn(() => ({ extendMarkRange, run }));
  const chain = vi.fn(() => ({ setTextSelection, extendMarkRange, run }));

  return {
    dom,
    link: dom.querySelector("a.editor-link") as HTMLAnchorElement,
    run,
    extendMarkRange,
    setTextSelection,
    chain,
    editor: {
      view: {
        dom,
        posAtCoords: vi.fn(() => ({ pos: 7 })),
      },
      chain,
      state: {
        doc: {
          resolve: vi.fn(),
          descendants: vi.fn(),
        },
      },
      storage: { spellCheck: {} },
      commands: {
        focus: vi.fn(),
        addToDictionary: vi.fn(),
      },
    } as unknown as import("@tiptap/react").Editor,
  };
}

const realEditors: Editor[] = [];

afterEach(() => {
  for (const editor of realEditors.splice(0)) editor.destroy();
});

function renderRealEditor(content: string) {
  const editor = new Editor({ extensions: createRichTextExtensions(), content });
  realEditors.push(editor);
  render(
    <>
      <EditorContent editor={editor} />
      <EditorContextMenu editor={editor} onInspect={vi.fn()} onLookup={vi.fn()} />
    </>
  );
  editor.view.dom.focus();
  return editor;
}

describe("EditorContextMenu", () => {
  it("Shift+F10 opens the menu at the caret and Esc returns focus to the editor", async () => {
    const user = userEvent.setup();
    const editor = renderRealEditor("<p>Plain text</p>");

    await user.keyboard("{Shift>}{F10}{/Shift}");
    const menu = screen.getByRole("menu", { name: "editor.contextMenu" });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "editor.inspectInHtml" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
  });

  it("replaces a misspelled word from the keyboard", async () => {
    const { spellCheckService } = await import("@/lib/spellcheck");
    vi.mocked(spellCheckService.suggest).mockResolvedValue(["receive"]);
    const user = userEvent.setup();
    const editor = renderRealEditor("<p>recieve</p>");
    editor.storage.spellCheck = {
      getMisspellingAt: () => ({ from: 1, to: 8, word: "recieve" }),
    } as never;

    await user.keyboard("{Shift>}{F10}{/Shift}");
    const suggestion = await screen.findByRole("menuitem", { name: "receive" });
    suggestion.focus();
    await user.keyboard("{Enter}");

    expect(editor.getHTML()).toContain("receive");
  });

  it("opens link editing instead of the generic context menu when right-clicking an internal link", async () => {
    const setup = buildEditor("maibuk://chapter/c1");
    const onEditLink = vi.fn();

    render(
      <EditorContextMenu
        editor={setup.editor}
        onInspect={vi.fn()}
        onLookup={vi.fn()}
        onEditLink={onEditLink}
      />
    );

    fireEvent.contextMenu(setup.link, { clientX: 10, clientY: 10 });

    await waitFor(() => expect(onEditLink).toHaveBeenCalledTimes(1));
    expect(setup.setTextSelection).toHaveBeenCalledWith(7);
    expect(setup.extendMarkRange).toHaveBeenCalledWith("link");
    expect(screen.queryByText("common.copy")).not.toBeInTheDocument();
  });

  it("opens link editing instead of the generic context menu when right-clicking an external link", async () => {
    const setup = buildEditor("https://example.com");
    const onEditLink = vi.fn();

    render(
      <EditorContextMenu
        editor={setup.editor}
        onInspect={vi.fn()}
        onLookup={vi.fn()}
        onEditLink={onEditLink}
      />
    );

    fireEvent.contextMenu(setup.link, { clientX: 10, clientY: 10 });

    await waitFor(() => expect(onEditLink).toHaveBeenCalledTimes(1));
    expect(setup.setTextSelection).toHaveBeenCalledWith(7);
    expect(setup.extendMarkRange).toHaveBeenCalledWith("link");
    expect(screen.queryByText("common.copy")).not.toBeInTheDocument();
  });
});
