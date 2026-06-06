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

describe("EditorContextMenu", () => {
  it("opens link editing instead of the generic context menu when right-clicking an internal link", async () => {
    const setup = buildEditor("maibuk://chapter/c1");
    const onEditLink = vi.fn();

    render(
      <EditorContextMenu
        editor={setup.editor}
        onInspect={vi.fn()}
        onLookup={vi.fn()}
        onEditLink={onEditLink}
      />,
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
      />,
    );

    fireEvent.contextMenu(setup.link, { clientX: 10, clientY: 10 });

    await waitFor(() => expect(onEditLink).toHaveBeenCalledTimes(1));
    expect(setup.setTextSelection).toHaveBeenCalledWith(7);
    expect(setup.extendMarkRange).toHaveBeenCalledWith("link");
    expect(screen.queryByText("common.copy")).not.toBeInTheDocument();
  });
});
