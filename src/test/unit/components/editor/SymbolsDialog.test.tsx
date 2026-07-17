import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import type { SymbolEntry } from "@/features/symbols/types";
import { useSymbolsStore } from "@/features/symbols/store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const entry = (glyph: string, label: string, code: string | null, category: string): SymbolEntry => ({
  glyph, label, code, category, search: label.toLowerCase(),
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

vi.mock("@/features/symbols/load", () => ({
  loadSymbolsCatalog: vi.fn(async () => catalog),
  entriesForCategory: (c: typeof catalog, category: string | null) =>
    category === null ? c.entries : c.entries.filter((e) => e.category === category),
  lookupByCodePoint: () => null,
}));

import { SymbolsDialog } from "@/components/editor/SymbolsDialog";

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 800 },
    clientHeight: { configurable: true, get: () => 400 },
  });
  (Element.prototype as any).getBoundingClientRect = () => ({ width: 800, height: 400, top: 0, left: 0, bottom: 400, right: 800, x: 0, y: 0, toJSON: () => ({}) });
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

  it("filters by category via the dropdown", async () => {
    const user = userEvent.setup();
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    await screen.findByRole("searchbox");
    await user.click(screen.getByRole("button", { name: /category/i }));
    await user.click(await screen.findByRole("option", { name: "Smileys & Emotion" }));
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
    await user.keyboard("{ArrowRight}{Enter}");
    expect(inserted).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(useSymbolsStore.getState().recentGlyphs).toEqual(inserted);
  });

  it("inserts on click", async () => {
    const user = userEvent.setup();
    const { editor, inserted } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    await user.click(await screen.findByRole("option", { name: /DAGGER/ }));
    expect(inserted).toEqual(["\u2020"]);
  });

  it("shows a recents row once glyphs were used", async () => {
    useSymbolsStore.setState({ recentGlyphs: ["\u2020"] });
    const { editor } = makeInsertSpyEditor();
    render(<SymbolsDialog editor={editor} isOpen onClose={() => {}} />);
    const recents = await screen.findByRole("listbox", { name: /recent/i });
    expect(recents).toBeInTheDocument();
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
});
