import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorContextMenu } from "../../../../components/editor/EditorContextMenu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const pasteWithoutFormatting = vi.fn();
vi.mock("../../../../components/editor/useClipboardProbe", () => ({
  fallbackPaste: vi.fn(),
  pasteWithoutFormatting: (...args: unknown[]) =>
    pasteWithoutFormatting(...args),
  useClipboardProbe: () =>
    vi.fn().mockResolvedValue({ canPaste: true, hasFormatting: true }),
}));

vi.mock("../../../../lib/spellcheck", () => ({
  spellCheckService: { suggest: vi.fn().mockResolvedValue([]) },
}));

function buildEditor() {
  const dom = document.createElement("div");
  dom.innerHTML = "<p>some text</p>";
  const $pos = {
    depth: 1,
    node: () => ({ isBlock: true, isLeaf: false, childCount: 1 }),
    before: () => 0,
    after: () => 20,
    parent: { isTextblock: true, textContent: "some text" },
    parentOffset: 0,
  };
  const run = vi.fn();
  const insertContentAt = vi.fn(() => ({ run }));
  const focus = vi.fn(() => ({ insertContentAt, run }));
  const chain = vi.fn(() => ({ focus, insertContentAt, run }));
  return {
    paragraph: dom.querySelector("p") as HTMLParagraphElement,
    editor: {
      view: { dom, posAtCoords: vi.fn(() => ({ pos: 5 })) },
      chain,
      state: {
        selection: { empty: true, from: 5, to: 5 },
        doc: {
          resolve: vi.fn(() => $pos),
          descendants: vi.fn(),
          textBetween: vi.fn(() => "some text"),
          content: { size: 20 },
        },
      },
      storage: { spellCheck: {} },
      commands: { focus: vi.fn(), addToDictionary: vi.fn() },
    } as unknown as import("@tiptap/react").Editor,
  };
}

describe("EditorContextMenu - Paste without formatting", () => {
  it("shows the item when the clipboard is formatted and pastes plain text on click", async () => {
    const setup = buildEditor();
    render(
      <EditorContextMenu
        editor={setup.editor}
        onInspect={vi.fn()}
        onLookup={vi.fn()}
      />,
    );
    fireEvent.contextMenu(setup.paragraph, { clientX: 10, clientY: 10 });
    const item = await screen.findByText("editor.pasteWithoutFormatting");
    fireEvent.click(item);
    expect(pasteWithoutFormatting).toHaveBeenCalledWith(setup.editor);
  });
});
