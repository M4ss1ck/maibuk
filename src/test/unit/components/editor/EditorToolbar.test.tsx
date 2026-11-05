import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { useSettingsStore } from "@/features/settings/store";
import { computeChecksum } from "@/lib/checksum";
import { dictionaryFor } from "@/features/spell-check-dictionaries/catalog";
import { useSpellCheckDictionaries } from "@/features/spell-check-dictionaries/store";
import type { DownloadedFiles } from "@/lib/verified-download";

interface ShortcutBinding {
  id: string;
  onTrigger: () => void;
}

const { shortcutBindings } = vi.hoisted(() => ({
  shortcutBindings: [] as ShortcutBinding[],
}));

const { mockOpenExternal, mockGetFiles } = vi.hoisted(() => ({
  mockOpenExternal: vi.fn(),
  mockGetFiles: vi.fn(),
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  openExternal: mockOpenExternal,
  getSpellCheckDictionaryFiles: mockGetFiles,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks", () => ({
  useModalScope: () => "mock-modal-id",
}));

vi.mock("@/lib/shortcuts", () => ({
  useShortcuts: (bindings: ShortcutBinding[]) => {
    shortcutBindings.splice(0, shortcutBindings.length, ...bindings);
  },
}));

vi.mock("@/components/shortcuts/ShortcutEditorDialog", () => ({
  ShortcutEditorDialog: () => null,
}));

vi.mock("@/components/editor/toolbar/ResponsiveEditorToolbar", () => ({
  ResponsiveEditorToolbar: ({
    callbacks,
    utilityCluster,
    fixedUtilities,
  }: {
    callbacks: {
      openFindReplace: () => void;
      openImageDialog: () => void;
      openFootnote: () => void;
      openLinkDialog: () => void;
      openHtmlPanel: () => void;
      openDictionary: () => void;
    };
    utilityCluster: ReactNode;
    fixedUtilities: ReactNode;
  }) => (
    <div>
      <div data-testid="utility-order">
        {utilityCluster}
        {fixedUtilities}
      </div>
      <button type="button" onClick={callbacks.openFindReplace}>
        find callback
      </button>
      <button type="button" onClick={callbacks.openImageDialog}>
        image callback
      </button>
      <button type="button" onClick={callbacks.openFootnote}>
        footnote callback
      </button>
      <button type="button" onClick={callbacks.openLinkDialog}>
        link callback
      </button>
      <button type="button" onClick={callbacks.openHtmlPanel}>
        html callback
      </button>
      <button type="button" onClick={callbacks.openDictionary}>
        dictionary callback
      </button>
    </div>
  ),
}));

vi.mock("@/components/editor/ZoomControl", () => ({
  ZoomControl: () => <button type="button">zoom utility</button>,
}));
vi.mock("@/components/editor/WidthControl", () => ({
  WidthControl: () => <button type="button">width utility</button>,
}));

vi.mock("@/components/editor/FindReplace", () => ({
  FindReplace: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>find dialog open</div> : null),
}));
vi.mock("@/components/editor/ImageInsertDialog", () => ({
  ImageInsertDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div>image dialog open</div> : null,
}));
vi.mock("@/components/editor/FootnoteDialog", () => ({
  FootnoteDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div>footnote dialog open</div> : null,
}));
vi.mock("@/components/editor/LinkDialog", () => ({
  LinkDialog: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>link dialog open</div> : null),
}));
vi.mock("@/components/editor/HtmlViewPanel", () => ({
  HtmlViewPanel: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>html panel open</div> : null),
}));
vi.mock("@/components/editor/DictionaryDialog", () => ({ DictionaryDialog: () => null }));
vi.mock("@/components/editor/DictionaryPromptDialog", () => ({
  DictionaryPromptDialog: () => null,
}));
vi.mock("@/components/editor/SymbolsDialog", () => ({ SymbolsDialog: () => null }));
vi.mock("@/components/ShortcutsHelpDialog", () => ({ ShortcutsHelpDialog: () => null }));
vi.mock("@/components/editor/EditorContextMenu", () => ({ EditorContextMenu: () => null }));
vi.mock("@/components/editor/toolbar/ToolbarSettingsDialog", () => ({
  ToolbarSettingsDialog: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div>
        toolbar settings open
        <button type="button" onClick={onClose}>
          close settings
        </button>
      </div>
    ) : null,
}));

function makeEditor(selectedText = "") {
  const dom = document.createElement("div");
  return {
    view: { dom },
    state: {
      selection: { from: 0, to: selectedText.length },
      doc: { textBetween: () => selectedText },
    },
    commands: { setSpellCheckLanguage: vi.fn() },
    getHTML: () => "<p>Text</p>",
  } as unknown as Editor;
}

function renderToolbar() {
  const editor = makeEditor();
  render(<EditorToolbar editor={editor} spellCheckLanguage="en" />);
  return editor;
}

beforeEach(() => {
  shortcutBindings.length = 0;
  mockOpenExternal.mockClear();
  useSettingsStore.setState({
    toolbarExpanded: false,
    showNotesChapter: false,
    bookSidePanelTab: "notes",
    dictionaryOpenInBrowser: false,
  });
});

describe("EditorToolbar", () => {
  it("keeps shortcuts, divider, settings, width, zoom, and expand utilities in order", () => {
    renderToolbar();
    const cluster = screen.getByTestId("utility-order");
    const controls = Array.from(cluster.querySelectorAll("button")).map(
      (button) => button.getAttribute("aria-label") ?? button.textContent
    );

    expect(controls).toEqual([
      "shortcuts.title",
      "toolbar.settings.open",
      "width utility",
      "zoom utility",
      "editor.showToolbar",
    ]);
    expect(cluster.children[1]).toHaveClass("w-px", "h-6", "bg-border");
  });

  it("opens toolbar settings from the gear and registered shortcut", () => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "toolbar.settings.open" }));
    expect(screen.getByText("toolbar settings open")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "close settings" }));
    expect(screen.queryByText("toolbar settings open")).not.toBeInTheDocument();
    const binding = shortcutBindings.find((item) => item.id === "editor.toolbarSettings");
    expect(binding).toBeDefined();
    act(() => binding?.onTrigger());
    expect(screen.getByText("toolbar settings open")).toBeInTheDocument();
  });

  it.each([
    ["find callback", "find dialog open"],
    ["image callback", "image dialog open"],
    ["link callback", "link dialog open"],
    ["html callback", "html panel open"],
  ])("preserves the %s behavior", (callbackName, openContent) => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: callbackName }));
    expect(screen.getByText(openContent)).toBeInTheDocument();
  });

  it("opens the writing language's Wiktionary when lookups go to the browser", () => {
    useSettingsStore.setState({ dictionaryOpenInBrowser: true });
    render(<EditorToolbar editor={makeEditor("palavra")} spellCheckLanguage="pt-BR" />);

    fireEvent.click(screen.getByRole("button", { name: "dictionary callback" }));

    expect(mockOpenExternal).toHaveBeenCalledWith("https://pt.wiktionary.org/wiki/palavra");
  });

  it("opens the footnote dialog when the editor had focus", () => {
    const editor = renderToolbar();
    fireEvent.focus(editor.view.dom);
    fireEvent.click(screen.getByRole("button", { name: "footnote callback" }));
    expect(screen.getByText("footnote dialog open")).toBeInTheDocument();
  });

  it("opens the footnote dialog from the toolbar even when the editor never had focus", () => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "footnote callback" }));
    expect(screen.getByText("footnote dialog open")).toBeInTheDocument();
  });
});

const DICT_AFF = new TextEncoder().encode("AFF");
const DICT_DIC = new TextEncoder().encode("DIC");
const dictAffSha256 = await computeChecksum(DICT_AFF);
const dictDicSha256 = await computeChecksum(DICT_DIC);
const frEntry = dictionaryFor("fr");
if (!frEntry) throw new Error("the catalog has no French entry");
const frOriginalAff = { ...frEntry.aff };
const frOriginalDic = { ...frEntry.dic };

describe("download Spell Check dictionary shortcut", () => {
  function memoryFiles(): DownloadedFiles {
    const store = new Map<string, Uint8Array>();
    return {
      read: vi.fn(async (language, name) => store.get(`${language}/${name}`) ?? null),
      write: vi.fn(async (language, name, data) => {
        store.set(`${language}/${name}`, data);
      }),
      remove: vi.fn(async (language) => {
        for (const key of [...store.keys()]) {
          if (key.startsWith(`${language}/`)) store.delete(key);
        }
      }),
    };
  }

  beforeEach(() => {
    frEntry.aff = { ...frOriginalAff, bytes: DICT_AFF.length, sha256: dictAffSha256 };
    frEntry.dic = { ...frOriginalDic, bytes: DICT_DIC.length, sha256: dictDicSha256 };
    mockGetFiles.mockClear();
    mockGetFiles.mockResolvedValue(memoryFiles());
    useSpellCheckDictionaries.setState({
      installed: [],
      downloading: [],
      failed: [],
      loaded: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === frEntry.aff.url) return new Response(DICT_AFF);
        if (url === frEntry.dic.url) return new Response(DICT_DIC);
        return new Response(null, { status: 404 });
      })
    );
  });

  afterEach(() => {
    frEntry.aff = frOriginalAff;
    frEntry.dic = frOriginalDic;
    vi.unstubAllGlobals();
  });

  function fireDownloadShortcut() {
    const binding = shortcutBindings.find(
      (item) => item.id === "editor.downloadSpellCheckDictionary"
    );
    expect(binding).toBeDefined();
    act(() => binding?.onTrigger());
  }

  it("downloads the dictionary when the active language has one available", async () => {
    render(<EditorToolbar editor={makeEditor()} spellCheckLanguage="fr" />);

    fireDownloadShortcut();

    await waitFor(() => expect(useSpellCheckDictionaries.getState().installed).toContain("fr"));
  });

  it("announces the active language's dictionary state once, and says nothing when it is ready", async () => {
    const { rerender } = render(<EditorToolbar editor={makeEditor()} spellCheckLanguage="fr" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "editor.spellCheckDictionaryStatusAvailable"
    );

    rerender(<EditorToolbar editor={makeEditor()} spellCheckLanguage="ja" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "editor.spellCheckDictionaryStatusUnavailable"
    );

    rerender(<EditorToolbar editor={makeEditor()} spellCheckLanguage="en" />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it.each([
    ["en", "is ready"],
    ["ja", "has none"],
  ])("does nothing when %s %s", async (language) => {
    render(<EditorToolbar editor={makeEditor()} spellCheckLanguage={language} />);

    fireDownloadShortcut();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetFiles).not.toHaveBeenCalled();
    expect(useSpellCheckDictionaries.getState().installed).toEqual([]);
  });
});
