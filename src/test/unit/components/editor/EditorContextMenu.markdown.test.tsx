import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorContextMenu } from "../../../../components/editor/EditorContextMenu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../../components/editor/useClipboardProbe", () => ({
  fallbackPaste: vi.fn(),
  useClipboardProbe: () => vi.fn().mockResolvedValue(false),
}));

vi.mock("../../../../lib/spellcheck", () => ({
  spellCheckService: { suggest: vi.fn().mockResolvedValue([]) },
}));

/** Builds an editor mock whose current block yields `blockText`. */
function buildEditor(blockText: string) {
  const dom = document.createElement("div");
  dom.innerHTML = "<p>some text</p>";

  const $pos = {
    depth: 1,
    node: () => ({ isBlock: true, isLeaf: false, childCount: 1 }),
    before: () => 0,
    after: () => 20,
    parent: { isTextblock: true, parentOffset: 0, textContent: blockText },
  };

  const run = vi.fn();
  const insertContentAt = vi.fn(() => ({ run }));
  const focus = vi.fn(() => ({ insertContentAt, run }));
  const chain = vi.fn(() => ({ focus, insertContentAt, run }));

  return {
    dom,
    paragraph: dom.querySelector("p") as HTMLParagraphElement,
    insertContentAt,
    editor: {
      view: { dom, posAtCoords: vi.fn(() => ({ pos: 5 })) },
      chain,
      state: {
        selection: { empty: true, from: 5, to: 5 },
        doc: {
          resolve: vi.fn(() => $pos),
          descendants: vi.fn(),
          textBetween: vi.fn(() => blockText),
          content: { size: 20 },
        },
      },
      storage: { spellCheck: {} },
      commands: { focus: vi.fn(), addToDictionary: vi.fn() },
    } as unknown as import("@tiptap/react").Editor,
  };
}

describe("EditorContextMenu — Format as Markdown", () => {
  it("shows the item when the block text looks like Markdown", async () => {
    const setup = buildEditor("## Heading\n\n- a list item");

    render(
      <EditorContextMenu
        editor={setup.editor}
        onInspect={vi.fn()}
        onLookup={vi.fn()}
      />,
    );

    fireEvent.contextMenu(setup.paragraph, { clientX: 10, clientY: 10 });

    await waitFor(() =>
      expect(screen.getByText("editor.formatAsMarkdown")).toBeInTheDocument(),
    );
  });

  it("hides the item for plain prose", async () => {
    const setup = buildEditor("Just an ordinary sentence with no markup.");

    render(
      <EditorContextMenu
        editor={setup.editor}
        onInspect={vi.fn()}
        onLookup={vi.fn()}
      />,
    );

    fireEvent.contextMenu(setup.paragraph, { clientX: 10, clientY: 10 });

    await waitFor(() =>
      expect(screen.getByText("editor.inspectInHtml")).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("editor.formatAsMarkdown"),
    ).not.toBeInTheDocument();
  });

  it("converts the block on click", async () => {
    const setup = buildEditor("## Heading\n\n- a list item");

    render(
      <EditorContextMenu
        editor={setup.editor}
        onInspect={vi.fn()}
        onLookup={vi.fn()}
      />,
    );

    fireEvent.contextMenu(setup.paragraph, { clientX: 10, clientY: 10 });
    const item = await screen.findByText("editor.formatAsMarkdown");
    fireEvent.click(item);

    expect(setup.insertContentAt).toHaveBeenCalledWith(
      { from: 0, to: 20 },
      expect.stringContaining("<h2>Heading</h2>"),
    );
  });
});
