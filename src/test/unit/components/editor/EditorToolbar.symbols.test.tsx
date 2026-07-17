import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EditorToolbarGroups,
  type ToolbarGroupCallbacks,
} from "@/components/editor/toolbar/EditorToolbarGroups";
import { makeToolbarEditor } from "@/test/support/toolbar-editor";

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

vi.mock("@/components/editor/toolbar/ResponsiveEditorToolbar", () => ({
  ResponsiveEditorToolbar: ({
    utilityCluster,
    fixedUtilities,
  }: {
    utilityCluster: ReactNode;
    fixedUtilities: ReactNode;
  }) => (
    <div>
      {utilityCluster}
      {fixedUtilities}
    </div>
  ),
}));

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

vi.mock("@/components/editor/SymbolsDialog", () => ({
  SymbolsDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? (
      <div role="dialog" aria-label="insert symbol" data-testid="symbols-dialog">
        symbols
      </div>
    ) : null,
}));

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
    return {
      view: { dom },
      state: {
        selection: { from: 0, to: 0 },
        doc: { textBetween: () => "" },
      },
      commands: { setSpellCheckLanguage: vi.fn() },
      getHTML: () => "<p>Text</p>",
    } as unknown as Editor;
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
  });

  it("opens the symbols dialog on Ctrl+Shift+O", async () => {
    const user = userEvent.setup();
    enableRealShortcuts();
    renderShortcutToolbar();

    await user.keyboard("{Control>}{Shift>}o{/Shift}{/Control}");

    expect(await screen.findByRole("dialog", { name: "insert symbol" })).toBeInTheDocument();
  });
});
