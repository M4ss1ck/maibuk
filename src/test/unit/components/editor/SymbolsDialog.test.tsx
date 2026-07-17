import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StarterKit from "@tiptap/starter-kit";
import { Editor } from "@tiptap/react";
import { useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SymbolEntry } from "@/features/symbols/types";
import { useSymbolsStore } from "@/features/symbols/store";

const { i18nState } = vi.hoisted(() => ({
  i18nState: { language: "en" as "en" | "es" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
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
  categories: ["Smileys & Emotion", "General Punctuation"],
  entries: [
    entry("\u2014", "EM DASH", "U+2014", "General Punctuation"),
    entry("\u2013", "EN DASH", "U+2013", "General Punctuation"),
    entry("\u2020", "DAGGER", "U+2020", "General Punctuation"),
    entry("\uD83D\uDE00", "grinning face", "U+1F600", "Smileys & Emotion"),
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
  loadSymbolsCatalog: vi.fn(async (language: string) =>
    language === "es" ? spanishCatalog : catalog
  ),
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

function makeInsertSpyEditor(): { editor: Editor; inserted: string[] } {
  const inserted: string[] = [];
  const chain = {
    focus: () => chain,
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
    i18nState.language = "en";
    vi.mocked(loadSymbolsCatalog).mockClear();
    useSymbolsStore.setState({ recentGlyphs: [] });
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

  it("inserts on Enter via keyboard grid navigation, records recents, stays open", async () => {
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
    expect(useSymbolsStore.getState().recentGlyphs).toEqual(inserted);
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

  it("closes on Escape and restores focus to its keyboard trigger", async () => {
    const user = userEvent.setup();
    const { editor } = makeInsertSpyEditor();

    function Harness() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>
            Open symbols
          </button>
          <SymbolsDialog editor={editor} isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open symbols" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
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

  it("shows name and code point of the focused glyph in the footer", async () => {
    const user = userEvent.setup();
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    await screen.findByRole("option", { name: /EM DASH/ });
    await user.tab();
    await user.tab();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.getByText(/U\+20/)).toBeInTheDocument());
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
});
