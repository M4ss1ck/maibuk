import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StarterKit from "@tiptap/starter-kit";
import { Editor } from "@tiptap/react";
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SymbolEntry } from "@/features/symbols/types";
import { useSymbolsStore } from "@/features/symbols/store";
import { toast } from "@/components/ui/Toast";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { DEFAULT_SHORTCUT_SETTINGS } from "@/lib/shortcut-resolve";

const { catalogState, i18nState, clipboard } = vi.hoisted(() => ({
  catalogState: { entryCount: null as number | null },
  i18nState: { language: "en" as "en" | "es" },
  clipboard: { written: [] as string[], fail: false },
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  getClipboard: async () => ({
    readText: async () => clipboard.written.at(-1) ?? "",
    writeText: async (text: string) => {
      if (clipboard.fail) throw new Error("Clipboard refused");
      clipboard.written.push(text);
    },
  }),
}));

vi.mock("@/lib/platform/detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform/detect")>()),
  isMac: () => false,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => (key === "symbols.allCategories" ? "all categories" : key),
    i18n: { language: i18nState.language },
  }),
}));

const entry = (
  glyph: string,
  label: string,
  code: string | null,
  category: string
): SymbolEntry => ({
  glyph,
  label,
  code,
  category,
  search: label.toLowerCase(),
});
const catalog = {
  categories: ["smileys & emotion", "general punctuation", "CJK Symbols and Punctuation"],
  entries: [
    entry("\u2014", "EM DASH", "U+2014", "general punctuation"),
    entry("\u2013", "EN DASH", "U+2013", "general punctuation"),
    entry("\u2020", "DAGGER", "U+2020", "general punctuation"),
    entry("\uD83D\uDE00", "grinning face", "U+1F600", "smileys & emotion"),
  ],
  rangesByCategory: new Map(),
};
const spanishCatalog = {
  ...catalog,
  entries: catalog.entries.map((item) =>
    item.glyph === "\uD83D\uDE00"
      ? { ...item, label: "cara sonriente", search: "cara sonriente sonrisa" }
      : item
  ),
};

vi.mock("@/features/symbols/load", () => ({
  loadSymbolsCatalog: vi.fn(async (language: string) => {
    if (catalogState.entryCount !== null) {
      return {
        ...catalog,
        entries: Array.from({ length: catalogState.entryCount }, (_, index) =>
          entry(String.fromCodePoint(0x1000 + index), `SYMBOL ${index}`, null, "Large")
        ),
      };
    }
    return language === "es" ? spanishCatalog : catalog;
  }),
  entriesForCategory: (c: typeof catalog, category: string | null) =>
    category === null ? c.entries : c.entries.filter((e) => e.category === category),
  lookupByCodePoint: (_c: typeof catalog, cp: number) =>
    cp === 0x4e2d
      ? {
          glyph: "\u4E2D",
          label: "CJK UNIFIED IDEOGRAPH-4E2D",
          code: "U+4E2D",
          category: "CJK",
          search: "cjk unified",
        }
      : null,
}));

import { loadSymbolsCatalog } from "@/features/symbols/load";
import { SymbolsDialog } from "@/components/editor/SymbolsDialog";

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 800 },
    clientHeight: { configurable: true, get: () => 400 },
  });
  (Element.prototype as any).getBoundingClientRect = () => ({
    width: 800,
    height: 400,
    top: 0,
    left: 0,
    bottom: 400,
    right: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

function makeInsertSpyEditor(onFocus?: () => void): { editor: Editor; inserted: string[] } {
  const inserted: string[] = [];
  const chain = {
    focus: () => {
      onFocus?.();
      return chain;
    },
    insertContent: (value: string) => {
      inserted.push(value);
      return chain;
    },
    run: () => true,
  };
  return { editor: { chain: () => chain } as unknown as Editor, inserted };
}

describe("SymbolsDialog", () => {
  beforeEach(() => {
    catalogState.entryCount = null;
    i18nState.language = "en";
    vi.mocked(loadSymbolsCatalog).mockClear();
    useSymbolsStore.setState({ recentGlyphs: [] });
    useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
    clipboard.written = [];
    clipboard.fail = false;
  });

  it("autofocuses search and filters as the user types", async () => {
    const user = userEvent.setup();
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    const search = await screen.findByRole("searchbox");
    await waitFor(() => expect(search).toHaveFocus());
    await user.keyboard("dagger");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /DAGGER/ })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /EM DASH/ })).not.toBeInTheDocument();
    });
  });

  it("shows the symbol name and code point when a grid glyph is hovered", async () => {
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    const option = await screen.findByRole("option", { name: /EM DASH/ });

    fireEvent.mouseEnter(within(option).getByText("\u2014"));

    const tooltip = await screen.findByText("EM DASH \u00b7 U+2014");
    await waitFor(() => expect(tooltip).toBeVisible());
  });

  it("limits broad result sets before handing them to the grid", async () => {
    catalogState.entryCount = 501;
    const { editor } = makeInsertSpyEditor();

    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);

    expect(await screen.findByText("symbols.resultLimit")).toBeInTheDocument();
  });

  it("filters by category using only the keyboard", async () => {
    const user = userEvent.setup();
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    const search = await screen.findByRole("searchbox");
    await waitFor(() => expect(search).toHaveFocus());
    const category = screen.getByRole("button", { name: /category/i });
    await user.tab();
    expect(category).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /grinning face/ })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /EM DASH/ })).not.toBeInTheDocument();
    });
  });

  it("widens and title-cases the category dropdown", async () => {
    const user = userEvent.setup();
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    const category = await screen.findByRole("button", { name: /category/i });

    expect(category.closest(".w-72")).toHaveClass("max-w-[55%]");
    await user.click(category);

    expect(screen.getByRole("option", { name: "Smileys & Emotion" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "General Punctuation" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "CJK Symbols And Punctuation" })).toBeInTheDocument();
  });

  it("keeps the search field and category dropdown the same height", async () => {
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);

    const search = await screen.findByRole("searchbox");
    const category = screen.getByRole("button", { name: /category/i });

    expect(search).toHaveClass("h-10");
    expect(category.parentElement).toHaveClass("[&>button]:h-10");
  });

  it("shows the full selected category label on hover and focus", async () => {
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    const category = await screen.findByRole("button", { name: /category/i });
    const tooltipTarget = category.closest(".w-72") as HTMLElement;

    fireEvent.mouseEnter(tooltipTarget);
    const hoverTooltip = await screen.findByRole("tooltip", { hidden: true });
    expect(hoverTooltip).toHaveTextContent("All Categories");

    fireEvent.mouseLeave(tooltipTarget);
    await waitFor(() => expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull());
    category.focus();

    expect(await screen.findByRole("tooltip", { hidden: true })).toHaveTextContent(
      "All Categories"
    );
  });

  it("inserts on Enter via keyboard grid navigation, records recents, and stays open", async () => {
    const user = userEvent.setup();
    const { editor, inserted } = makeInsertSpyEditor();
    const onClose = vi.fn();
    render(<SymbolsDialog editor={editor} isOpen onClose={onClose} />);
    await screen.findByRole("option", { name: /EM DASH/ });
    await user.tab(); // search -> category
    await user.tab(); // category -> grid (no recents yet)
    const firstFocusedOption = document.activeElement;
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).not.toBe(firstFocusedOption);
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /EN DASH/ }));
    await user.keyboard("{Enter}");
    expect(inserted).toHaveLength(1);
    expect(inserted).toEqual(["\u2013"]);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(useSymbolsStore.getState().recentGlyphs).toEqual(inserted);
  });

  it("moves from search to results and back using vertical arrows", async () => {
    const user = userEvent.setup();
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    const search = await screen.findByRole("searchbox");
    const firstResult = screen.getByRole("option", { name: /EM DASH/ });

    await waitFor(() => expect(search).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    expect(firstResult).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(search).toHaveFocus();
  });

  it("inserts an emoji and stays open when its glyph is clicked once", async () => {
    const user = userEvent.setup();
    const { editor, inserted } = makeInsertSpyEditor();
    const onClose = vi.fn();
    render(<SymbolsDialog editor={editor} isOpen onClose={onClose} />);

    const emoji = await screen.findByRole("option", { name: /grinning face/ });
    await user.click(within(emoji).getByText("\uD83D\uDE00"));

    expect(inserted).toEqual(["\uD83D\uDE00"]);
    expect(useSymbolsStore.getState().recentGlyphs).toEqual(["\uD83D\uDE00"]);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("inserts into a real TipTap editor", async () => {
    const user = userEvent.setup();
    const editor = new Editor({ extensions: [StarterKit], content: "<p>Hello</p>" });
    try {
      render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
      await user.click(await screen.findByRole("option", { name: /DAGGER/ }));
      expect(editor.getText()).toContain("\u2020");
      expect(editor.getHTML()).toContain("\u2020");
    } finally {
      editor.destroy();
    }
  });

  it("shows a recents row once glyphs were used", async () => {
    useSymbolsStore.setState({ recentGlyphs: ["\u2020"] });
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    const recents = await screen.findByRole("listbox", { name: /recent/i });
    expect(recents).toBeInTheDocument();
  });

  it("shows the symbol name and code point when a recent glyph is hovered", async () => {
    useSymbolsStore.setState({ recentGlyphs: ["\u2020"] });
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    const recents = await screen.findByRole("listbox", { name: /recent/i });

    fireEvent.mouseEnter(within(recents).getByText("\u2020"));

    const tooltip = await screen.findByText("DAGGER \u00b7 U+2020");
    await waitFor(() => expect(tooltip).toBeVisible());
  });

  it("navigates and activates recents using only the keyboard", async () => {
    useSymbolsStore.setState({ recentGlyphs: ["\u2020", "\u2014"] });
    const user = userEvent.setup();
    const { editor, inserted } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    const recents = await screen.findByRole("listbox", { name: /recent/i });
    const recentOptions = within(recents).getAllByRole("option");
    recentOptions.forEach((option, index) => {
      option.getBoundingClientRect = () => ({
        width: 36,
        height: 36,
        top: 0,
        left: index * 40,
        bottom: 36,
        right: index * 40 + 36,
        x: index * 40,
        y: 0,
        toJSON: () => ({}),
      });
    });

    await user.tab(); // search -> category
    await user.tab(); // category -> recents
    await user.keyboard("{Home}");
    const firstFocusedRecent = document.activeElement;
    expect(firstFocusedRecent).toBe(recentOptions[0]);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).not.toBe(firstFocusedRecent);
    expect(document.activeElement).toBe(recentOptions[1]);
    await user.keyboard("{Enter}");

    expect(inserted).toEqual(["\u2014"]);
  });

  it("moves between recents and search results using vertical arrows", async () => {
    useSymbolsStore.setState({ recentGlyphs: ["\u2020", "\u2014"] });
    const user = userEvent.setup();
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    const recents = await screen.findByRole("listbox", { name: /recent/i });
    const firstRecent = within(recents).getAllByRole("option")[0];
    const results = screen.getByRole("listbox", { name: "symbols.grid" });
    const firstResult = within(results).getByRole("option", { name: /EM DASH/ });

    firstRecent.focus();
    await user.keyboard("{ArrowDown}");
    expect(firstResult).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(firstRecent).toHaveFocus();
  });

  it("closes on Escape and restores focus to the editor", async () => {
    const user = userEvent.setup();
    let editorElement: HTMLInputElement | null = null;
    const { editor } = makeInsertSpyEditor(() => editorElement?.focus());

    function Harness() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <>
          <input
            ref={(element) => {
              editorElement = element;
            }}
            type="text"
            aria-label="Editor"
            tabIndex={-1}
          />
          <button type="button" onClick={() => setIsOpen(true)}>
            Open symbols
          </button>
          <SymbolsDialog editor={editor} isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </>
      );
    }

    render(<Harness />);
    const editorTarget = screen.getByRole("textbox", { name: "Editor" });
    const trigger = screen.getByRole("button", { name: "Open symbols" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(editorTarget).toHaveFocus();
    });
  });

  it("searches localized Spanish names at dialog level", async () => {
    i18nState.language = "es";
    const user = userEvent.setup();
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    const search = await screen.findByRole("searchbox");
    await user.type(search, "sonrisa");

    await waitFor(() => {
      expect(loadSymbolsCatalog).toHaveBeenCalledWith("es");
      expect(screen.getByRole("option", { name: "cara sonriente" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /EM DASH/ })).not.toBeInTheDocument();
    });
  });

  it("keeps the footer mounted and shows the focused glyph details in it", async () => {
    const user = userEvent.setup();
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    await screen.findByRole("option", { name: /EM DASH/ });
    const footer = screen.getByRole("status");
    expect(footer).toHaveTextContent("");
    await user.tab();
    await user.tab();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(footer).toHaveTextContent("EN DASH · U+2013"));
    expect(screen.getByRole("status")).toBe(footer);
  });

  it("resolves recents from range-backed categories by code point lookup", async () => {
    const rangeGlyph = "\u4E2D";
    useSymbolsStore.setState({ recentGlyphs: [rangeGlyph] });
    const user = userEvent.setup();
    const { editor, inserted } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    await screen.findByRole("listbox", { name: /recent/i });
    const recentOption = screen.getByRole("option", { name: /CJK UNIFIED/ });
    expect(recentOption).toBeInTheDocument();
    await user.click(recentOption);
    expect(inserted).toEqual([rangeGlyph]);
  });

  it("shows an error message when the symbol catalog fails to load", async () => {
    vi.mocked(loadSymbolsCatalog).mockRejectedValueOnce(new Error("Load failed"));
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    await screen.findByText("symbols.loadError");
    expect(screen.queryByText("symbols.loading")).not.toBeInTheDocument();
  });
  describe("copying a Symbol", () => {
    let success: ReturnType<typeof vi.spyOn>;
    let error: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      success = vi.spyOn(toast, "success").mockImplementation(() => {});
      error = vi.spyOn(toast, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      success.mockRestore();
      error.mockRestore();
    });

    const renderDialog = () => {
      const spy = makeInsertSpyEditor();
      render(<SymbolsDialog editor={spy.editor} isOpen onClose={() => {}} />);
      return spy;
    };

    it("copies a clicked Symbol as well as inserting it, and says so", async () => {
      const user = userEvent.setup();
      const { inserted } = renderDialog();

      const emoji = await screen.findByRole("option", { name: /grinning face/ });
      await user.click(within(emoji).getByText("\uD83D\uDE00"));

      expect(inserted).toEqual(["\uD83D\uDE00"]);
      await waitFor(() => expect(clipboard.written).toEqual(["\uD83D\uDE00"]));
      await waitFor(() => expect(success).toHaveBeenCalledWith("common.copied"));
      expect(useSymbolsStore.getState().recentGlyphs).toEqual(["\uD83D\uDE00"]);
    });

    it("copies a Symbol picked with Enter, from the grid and from Recent", async () => {
      useSymbolsStore.setState({ recentGlyphs: ["\u2020"] });
      const user = userEvent.setup();
      const { inserted } = renderDialog();
      const recents = await screen.findByRole("listbox", { name: /recent/i });
      const results = screen.getByRole("listbox", { name: "symbols.grid" });

      within(results).getByRole("option", { name: /EN DASH/ }).focus();
      await user.keyboard("{Enter}");
      within(recents).getByRole("option", { name: /DAGGER/ }).focus();
      await user.keyboard("{Enter}");

      expect(inserted).toEqual(["\u2013", "\u2020"]);
      await waitFor(() => expect(clipboard.written).toEqual(["\u2013", "\u2020"]));
    });

    it("still inserts when the clipboard refuses, and reports the failed copy", async () => {
      clipboard.fail = true;
      const user = userEvent.setup();
      const { inserted } = renderDialog();

      const option = await screen.findByRole("option", { name: /EM DASH/ });
      option.focus();
      await user.keyboard("{Enter}");

      expect(inserted).toEqual(["\u2014"]);
      await waitFor(() => expect(error).toHaveBeenCalledWith("symbols.copyFailed"));
      expect(success).not.toHaveBeenCalled();
    });

    it("copies the focused Symbol with Ctrl+C without inserting it", async () => {
      const user = userEvent.setup();
      const { inserted } = renderDialog();

      const option = await screen.findByRole("option", { name: /DAGGER/ });
      option.focus();
      await user.keyboard("{Control>}c{/Control}");

      await waitFor(() => expect(clipboard.written).toEqual(["\u2020"]));
      expect(inserted).toEqual([]);
      expect(useSymbolsStore.getState().recentGlyphs).toEqual(["\u2020"]);
      await waitFor(() => expect(success).toHaveBeenCalledWith("common.copied"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("leaves Ctrl+C in the search field to the field", async () => {
      const user = userEvent.setup();
      renderDialog();
      const search = await screen.findByRole("searchbox");
      await waitFor(() => expect(search).toHaveFocus());

      // Focus a Symbol first, so a stale focused Symbol cannot leak into the search field.
      screen.getByRole("option", { name: /DAGGER/ }).focus();
      search.focus();
      await user.keyboard("{Control>}c{/Control}");

      expect(clipboard.written).toEqual([]);
    });

    it("follows a Custom Shortcut for copying the focused Symbol", async () => {
      useShortcutSettingsStore.setState({
        shortcuts: {
          ...structuredClone(DEFAULT_SHORTCUT_SETTINGS),
          custom: { "symbolItem.copy": [["Mod+Shift+k"]] },
        },
      });
      const user = userEvent.setup();
      renderDialog();

      const option = await screen.findByRole("option", { name: /DAGGER/ });
      option.focus();
      await user.keyboard("{Control>}c{/Control}");
      expect(clipboard.written).toEqual([]);

      await user.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
      await waitFor(() => expect(clipboard.written).toEqual(["\u2020"]));
    });

    it("opens a Symbol's Item Menu on right click and copies without inserting", async () => {
      const user = userEvent.setup();
      const { inserted } = renderDialog();

      const option = await screen.findByRole("option", { name: /DAGGER/ });
      await user.pointer({ keys: "[MouseRight]", target: option });
      const menu = await screen.findByRole("menu");
      expect(within(menu).getByRole("menuitem", { name: /common.insert/ })).toBeInTheDocument();
      await user.click(within(menu).getByRole("menuitem", { name: /common.copy/ }));

      await waitFor(() => expect(clipboard.written).toEqual(["\u2020"]));
      expect(inserted).toEqual([]);
      expect(useSymbolsStore.getState().recentGlyphs).toEqual(["\u2020"]);
      await waitFor(() => expect(success).toHaveBeenCalledWith("common.copied"));
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("opens the Item Menu with Shift+F10 and inserts from it by keyboard", async () => {
      const user = userEvent.setup();
      const { inserted } = renderDialog();

      const option = await screen.findByRole("option", { name: /EM DASH/ });
      option.focus();
      await user.keyboard("{Shift>}{F10}{/Shift}");
      const menu = await screen.findByRole("menu");
      await waitFor(() =>
        expect(within(menu).getByRole("menuitem", { name: /common.insert/ })).toHaveFocus()
      );
      await user.keyboard("{Enter}");

      expect(inserted).toEqual(["\u2014"]);
      await waitFor(() => expect(clipboard.written).toEqual(["\u2014"]));
    });

    it("closes only the Item Menu on Escape and returns focus to the Symbol", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      const { editor } = makeInsertSpyEditor();
      render(<SymbolsDialog editor={editor} isOpen onClose={onClose} />);

      const option = await screen.findByRole("option", { name: /EM DASH/ });
      option.focus();
      await user.keyboard("{Shift>}{F10}{/Shift}");
      await screen.findByRole("menu");
      await user.keyboard("{Escape}");

      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
      expect(option).toHaveFocus();
    });
  });
});
