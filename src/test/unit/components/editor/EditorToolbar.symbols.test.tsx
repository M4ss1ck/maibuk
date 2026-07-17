import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EditorToolbarGroups,
  type ToolbarGroupCallbacks,
} from "@/components/editor/toolbar/EditorToolbarGroups";
import { makeToolbarEditor } from "@/test/support/toolbar-editor";
import { isTypingTarget } from "@/lib/keyboard";

const { mockUseShortcuts } = vi.hoisted(() => ({
  mockUseShortcuts: vi.fn(),
}));

vi.mock("@/lib/shortcuts", () => ({
  useShortcuts: mockUseShortcuts,
}));

vi.mock("@tiptap/react", () => ({
  useEditorState: ({
    editor,
    selector,
  }: {
    editor: unknown;
    selector: (value: { editor: unknown }) => unknown;
  }) => selector({ editor }),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/editor/toolbar/ResponsiveEditorToolbar", async () => {
  const { EditorToolbarGroups } = await vi.importActual<
    typeof import("@/components/editor/toolbar/EditorToolbarGroups")
  >("@/components/editor/toolbar/EditorToolbarGroups");

  return {
    ResponsiveEditorToolbar: ({
      editor,
      callbacks,
      utilityCluster,
      fixedUtilities,
    }: {
      editor: Editor;
      callbacks: ToolbarGroupCallbacks;
      utilityCluster: ReactNode;
      fixedUtilities: ReactNode;
    }) => (
      <div>
        <EditorToolbarGroups editor={editor} groupIds={["symbols"]} callbacks={callbacks} />
        {utilityCluster}
        {fixedUtilities}
      </div>
    ),
  };
});

vi.mock("@/components/editor/ZoomControl", () => ({ ZoomControl: () => null }));
vi.mock("@/components/editor/WidthControl", () => ({ WidthControl: () => null }));
vi.mock("@/components/editor/FindReplace", () => ({ FindReplace: () => null }));
vi.mock("@/components/editor/ImageInsertDialog", () => ({ ImageInsertDialog: () => null }));
vi.mock("@/components/editor/FootnoteDialog", () => ({ FootnoteDialog: () => null }));
vi.mock("@/components/editor/LinkDialog", () => ({ LinkDialog: () => null }));
vi.mock("@/components/editor/HtmlViewPanel", () => ({ HtmlViewPanel: () => null }));
vi.mock("@/components/editor/DictionaryDialog", () => ({ DictionaryDialog: () => null }));
vi.mock("@/components/editor/DictionaryPromptDialog", () => ({
  DictionaryPromptDialog: () => null,
}));
vi.mock("@/components/editor/EditorContextMenu", () => ({ EditorContextMenu: () => null }));
vi.mock("@/components/editor/toolbar/ToolbarSettingsDialog", () => ({
  ToolbarSettingsDialog: () => null,
}));
vi.mock("@/components/ShortcutsHelpDialog", () => ({ ShortcutsHelpDialog: () => null }));

vi.mock("@/components/editor/SymbolsDialog", async () => {
  const { Modal } =
    await vi.importActual<typeof import("@/components/ui/Modal")>("@/components/ui/Modal");

  return {
    SymbolsDialog: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
      <Modal isOpen={isOpen} onClose={onClose} title="insert symbol">
        <p>symbols</p>
      </Modal>
    ),
  };
});

const { useShortcuts: useRealShortcuts } =
  await vi.importActual<typeof import("@/lib/shortcuts")>("@/lib/shortcuts");

type ShortcutConfig = Parameters<typeof useRealShortcuts>[0][number];

// Import EditorToolbar after mocks that it depends on
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { useModalStore } from "@/components/ui/modal-store";
import { useSettingsStore } from "@/features/settings/store";

const callbacks: ToolbarGroupCallbacks = {
  spellCheckLanguage: "en",
  onSpellCheckLanguageChange: vi.fn(),
  openFindReplace: vi.fn(),
  isFindReplaceOpen: false,
  onToggleFindReplace: vi.fn(),
  openImageDialog: vi.fn(),
  openFootnote: vi.fn(),
  openLinkDialog: vi.fn(),
  openDictionary: vi.fn(),
  openHtmlPanel: vi.fn(),
  openSymbols: vi.fn(),
};

describe("symbols toolbar group", () => {
  beforeEach(() => {
    mockUseShortcuts.mockClear();
    mockUseShortcuts.mockImplementation(() => undefined);
  });

  it("renders the symbols button and fires openSymbols", async () => {
    const user = userEvent.setup();
    const openSymbols = vi.fn();

    render(
      <EditorToolbarGroups
        editor={makeToolbarEditor()}
        groupIds={["symbols"]}
        callbacks={{ ...callbacks, openSymbols }}
      />
    );

    await user.click(screen.getByRole("button", { name: /symbols|símbolos/i }));
    expect(openSymbols).toHaveBeenCalledTimes(1);
  });
});

describe("editor.insertSymbol shortcut", () => {
  const dom = document.createElement("div");

  function enableRealShortcuts() {
    mockUseShortcuts.mockImplementation(
      (configs: ShortcutConfig[], options?: Parameters<typeof useRealShortcuts>[1]) =>
        useRealShortcuts(configs, options)
    );
  }

  function makeShortcutEditor() {
    const editor = makeToolbarEditor();
    return Object.assign(editor, {
      view: { dom },
      state: {
        selection: { from: 0, to: 0 },
        doc: { textBetween: () => "" },
      },
      commands: { ...editor.commands, setSpellCheckLanguage: vi.fn() },
      getHTML: () => "<p>Text</p>",
    }) as Editor;
  }

  function renderShortcutToolbar() {
    render(
      <MemoryRouter initialEntries={["/book/test-book"]}>
        <EditorToolbar editor={makeShortcutEditor()} spellCheckLanguage="en" />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    mockUseShortcuts.mockClear();
    mockUseShortcuts.mockImplementation(() => undefined);
    useModalStore.setState({ modalIds: [], openCount: 0 });
    useSettingsStore.setState({
      toolbarExpanded: false,
      showNotesChapter: false,
      bookSidePanelTab: "notes",
      dictionaryOpenInBrowser: false,
    });
    dom.setAttribute("contenteditable", "true");
    dom.tabIndex = 0;
    document.body.append(dom);
  });

  afterEach(() => {
    dom.remove();
  });

  it("opens from a focused editor typing target and restores editor focus on Escape", async () => {
    const user = userEvent.setup();
    enableRealShortcuts();
    renderShortcutToolbar();
    dom.focus();
    expect(dom).toHaveFocus();
    expect(isTypingTarget(dom)).toBe(true);

    await user.keyboard("{Control>}{Shift>}o{/Shift}{/Control}");

    expect(await screen.findByRole("dialog", { name: "insert symbol" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "insert symbol" })).not.toBeInTheDocument();
      expect(dom).toHaveFocus();
    });
  });

  it("opens from the real toolbar button by keyboard and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    renderShortcutToolbar();
    const symbolsButton = screen.getByRole("button", { name: /symbols/i });
    dom.focus();

    await user.tab();
    expect(symbolsButton).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("dialog", { name: "insert symbol" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "insert symbol" })).not.toBeInTheDocument();
      expect(symbolsButton).toHaveFocus();
    });
  });
});
