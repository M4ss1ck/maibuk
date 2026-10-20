import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
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

// Resolves after the frames already scheduled have run, and the one they
// schedule: the close refocuses in a frame, and TipTap's focus in the next.
function waitForFrames() {
  return act(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
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

  it("keeps the menu alive when a later suggestion lookup reorders the list", async () => {
    // Regression: suggestion items were keyed by word but identified by index,
    // so a re-render that moved a word to another index threw
    // "Cannot change the id of an item" and blanked the app.
    const { spellCheckService } = await import("@/lib/spellcheck");
    const resolvers: Array<(value: string[]) => void> = [];
    vi.mocked(spellCheckService.suggest).mockImplementation(
      () => new Promise<string[]>((resolve) => resolvers.push(resolve))
    );
    // No delay between presses: the reopen lands inside the frame after the
    // first menu closes, the timing that once let a late refocus close it.
    const user = userEvent.setup({ delay: null });
    const editor = renderRealEditor("<p>teh</p>");
    editor.storage.spellCheck = {
      getMisspellingAt: () => ({ from: 1, to: 4, word: "teh" }),
    } as never;

    await user.keyboard("{Shift>}{F10}{/Shift}");
    editor.view.dom.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    await waitForFrames();
    expect(resolvers).toHaveLength(2);
    expect(screen.getByRole("menu", { name: "editor.contextMenu" })).toBeInTheDocument();

    await act(async () => resolvers[1](["the", "ten"]));
    await screen.findByRole("menuitem", { name: "the" });
    await act(async () => resolvers[0](["ten", "the"]));

    const items = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent)
      .filter((text) => text === "the" || text === "ten");
    expect(items).toEqual(["the", "ten"]);
  });

  it("leaves focus on the control the author moved to when the menu closes", async () => {
    // Regression: closing on blur refocused the editor a frame later, pulling
    // focus back from wherever the author had clicked or tabbed to.
    const user = userEvent.setup();
    renderRealEditor("<p>Plain text</p>");
    render(<button type="button">Elsewhere</button>);
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });

    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(screen.getByRole("menu", { name: "editor.contextMenu" })).toBeInTheDocument();

    act(() => elsewhere.focus());
    await waitForFrames();

    expect(screen.queryByRole("menu", { name: "editor.contextMenu" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("shows no suggestions after loading when the lookup finds none", async () => {
    // Regression: the loading and empty items shared an unkeyed slot, so React
    // reused the loading item and React Aria threw "Cannot change the id of an
    // item" when the lookup came back empty, blanking the app.
    const { spellCheckService } = await import("@/lib/spellcheck");
    vi.mocked(spellCheckService.suggest).mockResolvedValue([]);
    const user = userEvent.setup();
    const editor = renderRealEditor("<p>qzxv</p>");
    editor.storage.spellCheck = {
      getMisspellingAt: () => ({ from: 1, to: 5, word: "qzxv" }),
    } as never;

    await user.keyboard("{Shift>}{F10}{/Shift}");

    expect(await screen.findByRole("menuitem", { name: "editor.noSuggestions" })).toBeInTheDocument();
  });

  it("renders duplicate suggestions without crashing and applies the chosen one", async () => {
    const { spellCheckService } = await import("@/lib/spellcheck");
    vi.mocked(spellCheckService.suggest).mockResolvedValue(["the", "the", "ten"]);
    const user = userEvent.setup();
    const editor = renderRealEditor("<p>teh</p>");
    editor.storage.spellCheck = {
      getMisspellingAt: () => ({ from: 1, to: 4, word: "teh" }),
    } as never;

    await user.keyboard("{Shift>}{F10}{/Shift}");
    const ten = await screen.findByRole("menuitem", { name: "ten" });
    ten.focus();
    await user.keyboard("{Enter}");

    expect(editor.getHTML()).toContain("ten");
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
