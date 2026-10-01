import { describe, expect, it } from "vitest";
import {
  PALETTE_EMPTY_ROOT_LIMIT,
  PALETTE_SECTION_CAP,
  PALETTE_SUGGESTED_KEYS,
  liveRecentKeys,
  preparePaletteIndex,
  searchPalette,
} from "@/features/command-palette/palette-index";
import type {
  PaletteItem,
  PaletteItemKind,
  PalettePage,
  PaletteQuery,
} from "@/features/command-palette/palette-index";

function item(
  kind: PaletteItemKind,
  id: string,
  label: string,
  extra?: Partial<PaletteItem>
): PaletteItem {
  return {
    key: `${kind}:${id}`,
    kind,
    id,
    label,
    terms: [],
    state: "runnable",
    ...extra,
  };
}

function rootQuery(query: string, extra?: Partial<PaletteQuery>): PaletteQuery {
  return { query, page: "root", recent: [], ...extra };
}

function sectionIds(results: { id: string }[]): string[] {
  return results.map((section) => section.id);
}

describe("palette-index ranking", () => {
  it("exact beats prefix beats fuzzy", () => {
    const items = [
      item("command", "c", "Book list bold"),
      item("command", "b", "Bold italic"),
      item("command", "a", "Bold"),
    ];
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, rootQuery("bold"));
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("commands");
    expect(sections[0].results.map((r) => r.item.label)).toEqual([
      "Bold",
      "Bold italic",
      "Book list bold",
    ]);
    const scores = sections[0].results.map((r) => r.score);
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[1]).toBeGreaterThan(scores[2]);
  });

  it("finds a fuzzy acronym across words", () => {
    const items = [item("command", "a", "Toggle always on top"), item("command", "b", "Export book")];
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, rootQuery("alwtop"));
    expect(sections).toHaveLength(1);
    expect(sections[0].results.map((r) => r.item.label)).toEqual(["Toggle always on top"]);
  });

  it("finds a term-only match with empty highlights", () => {
    const items = [
      item("command", "a", "Toggle bold", { terms: ["put the title in strong"] }),
      item("command", "b", "Export book"),
    ];
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, rootQuery("strong"));
    expect(sections).toHaveLength(1);
    expect(sections[0].results).toHaveLength(1);
    expect(sections[0].results[0].item.label).toBe("Toggle bold");
    expect(sections[0].results[0].highlights).toEqual([]);
  });

  it("matches diacritics-insensitively", () => {
    const items = [item("note", "a", "Nota sobre la canción"), item("note", "b", "Shopping list")];
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, rootQuery("cancion"));
    expect(sections).toHaveLength(1);
    expect(sections[0].results.map((r) => r.item.label)).toEqual(["Nota sobre la canción"]);
  });

  it("ranks an open-Book chapter above an equal chapter of another Book", () => {
    const items = [
      item("chapter", "other", "The arrival", { bookId: "book-b" }),
      item("chapter", "open", "The arrival", { bookId: "book-a" }),
    ];
    const index = preparePaletteIndex(items);
    const sections = searchPalette(
      index,
      rootQuery("arrival", { openBookId: "book-a" })
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("chapters");
    expect(sections[0].results.map((r) => r.item.id)).toEqual(["open", "other"]);
  });
});

describe("palette-index sections and caps", () => {
  it("caps every section at PALETTE_SECTION_CAP", () => {
    expect(PALETTE_SECTION_CAP).toBe(50);
    const items = Array.from({ length: 60 }, (_, n) =>
      item("note", `n${n}`, `Meeting note number ${n}`)
    );
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, rootQuery("note"));
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("notes");
    expect(sections[0].results).toHaveLength(50);
  });

  it("orders sections in PALETTE_SECTION_ORDER", () => {
    const items = [
      item("settingsRow", "s", "Accent color setting"),
      item("canvas", "c", "Accent wall canvas"),
      item("book", "b", "Accent book of poems"),
      item("note", "n", "Accent note"),
      item("chapter", "h", "Accent chapter", { bookId: "book-x" }),
      item("command", "m", "Accent command"),
    ];
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, rootQuery("accent"));
    expect(sectionIds(sections)).toEqual([
      "commands",
      "chapters",
      "notes",
      "books",
      "canvases",
      "settings",
    ]);
  });

  it("moves a matching recent item into recent without duplicating it", () => {
    const bold = item("command", "bold", "Toggle bold");
    const other = item("command", "export", "Export bold draft");
    const index = preparePaletteIndex([bold, other]);
    const sections = searchPalette(index, rootQuery("bold", { recent: [bold.key] }));
    expect(sectionIds(sections)).toEqual(["recent", "commands"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual([bold.key]);
    expect(sections[1].results.map((r) => r.item.key)).toEqual([other.key]);
  });

  it("orders the recent section by recent position, not score", () => {
    const exact = item("command", "exact", "Export");
    const fuzzy = item("command", "fuzzy", "Export summary report");
    const index = preparePaletteIndex([exact, fuzzy]);
    const sections = searchPalette(
      index,
      rootQuery("export", { recent: [fuzzy.key, exact.key] })
    );
    expect(sectionIds(sections)).toEqual(["recent"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual([fuzzy.key, exact.key]);
  });

  it("lists disabled items like runnable ones", () => {
    const items = [item("command", "a", "Toggle bold", { state: "disabled" })];
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, rootQuery("bold"));
    expect(sections[0].results).toHaveLength(1);
    expect(sections[0].results[0].item.state).toBe("disabled");
  });
});

describe("palette-index empty query", () => {
  it("returns only recent on root, in recent order, dropping unknown keys", () => {
    const a = item("command", "a", "Toggle bold");
    const b = item("note", "b", "Shopping list");
    const c = item("book", "c", "My novel");
    const index = preparePaletteIndex([a, b, c]);
    const sections = searchPalette(
      index,
      rootQuery("   ", { recent: [b.key, "note:missing", a.key] })
    );
    expect(sectionIds(sections)).toEqual(["recent"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual([b.key, a.key]);
    for (const result of sections[0].results) {
      expect(result.score).toBe(0);
      expect(result.highlights).toEqual([]);
    }
  });

  it("returns no sections on root when nothing recent resolves", () => {
    const index = preparePaletteIndex([item("command", "a", "Toggle bold")]);
    expect(searchPalette(index, rootQuery("", { recent: ["note:ghost"] }))).toEqual([]);
    expect(searchPalette(index, rootQuery(""))).toEqual([]);
  });

  /** An item for a suggested key, so the index holds what the screen offers. */
  function suggestedItem(key: string, extra?: Partial<PaletteItem>): PaletteItem {
    const [kind, ...rest] = key.split(":");
    const id = rest.join(":");
    return item(kind as PaletteItemKind, id, `Label ${id}`, {
      ...(kind === "page" ? { targetPage: id as PalettePage } : {}),
      ...extra,
    });
  }

  it("suggests useful items on root when nothing is recent, in suggestion order", () => {
    const items = PALETTE_SUGGESTED_KEYS.map((key) => suggestedItem(key));
    const index = preparePaletteIndex([item("command", "zz", "Not suggested"), ...items]);
    const sections = searchPalette(index, rootQuery(""));
    expect(sectionIds(sections)).toEqual(["suggested"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual(
      PALETTE_SUGGESTED_KEYS.slice(0, PALETTE_EMPTY_ROOT_LIMIT)
    );
  });

  it("fills up to the limit after Recent, never repeating a Recent item", () => {
    const items = PALETTE_SUGGESTED_KEYS.map((key) => suggestedItem(key));
    const extra = [item("note", "n1", "One"), item("note", "n2", "Two")];
    const index = preparePaletteIndex([...extra, ...items]);
    const recent = [extra[0].key, PALETTE_SUGGESTED_KEYS[0], extra[1].key];
    const sections = searchPalette(index, rootQuery("", { recent }));
    expect(sectionIds(sections)).toEqual(["recent", "suggested"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual(recent);
    const suggested = sections[1].results.map((r) => r.item.key);
    expect(suggested).not.toContain(PALETTE_SUGGESTED_KEYS[0]);
    expect(suggested).toEqual(
      PALETTE_SUGGESTED_KEYS.slice(1, 1 + PALETTE_EMPTY_ROOT_LIMIT - recent.length)
    );
  });

  it("skips suggestions this screen does not offer or cannot run", () => {
    const [first, second, third] = PALETTE_SUGGESTED_KEYS;
    const index = preparePaletteIndex([
      suggestedItem(first, { state: "disabled" }),
      suggestedItem(third),
    ]);
    const sections = searchPalette(index, rootQuery(""));
    expect(sectionIds(sections)).toEqual(["suggested"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual([third]);
    expect(sections[0].results.map((r) => r.item.key)).not.toContain(second);
  });

  it("suggests nothing once Recent reaches the limit", () => {
    const notes = Array.from({ length: PALETTE_EMPTY_ROOT_LIMIT }, (_, n) =>
      item("note", `n${n}`, `Note ${n}`)
    );
    const index = preparePaletteIndex([
      ...notes,
      ...PALETTE_SUGGESTED_KEYS.map((key) => suggestedItem(key)),
    ]);
    const sections = searchPalette(
      index,
      rootQuery("", { recent: notes.map((note) => note.key) })
    );
    expect(sectionIds(sections)).toEqual(["recent"]);
  });

  it("never suggests on a typed query or a nested page", () => {
    const index = preparePaletteIndex(PALETTE_SUGGESTED_KEYS.map((key) => suggestedItem(key)));
    expect(sectionIds(searchPalette(index, rootQuery("label")))).not.toContain("suggested");
    expect(searchPalette(index, { query: "", page: "notes", recent: [] })).toEqual([]);
  });

  it("lists a page's items uncapped and in input order", () => {
    const items = Array.from({ length: 60 }, (_, n) =>
      item("note", `n${n}`, `Zebra note ${59 - n}`)
    );
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, {
      query: "",
      page: "notes",
      recent: [],
    });
    expect(sectionIds(sections)).toEqual(["notes"]);
    expect(sections[0].results).toHaveLength(60);
    expect(sections[0].results.map((r) => r.item.id)).toEqual(
      items.map((entry) => entry.id)
    );
  });
});

describe("palette-index page filtering", () => {
  const mixed: PaletteItem[] = [
    item("command", "cmd", "Open settings"),
    item("page", "p", "Go to books", { targetPage: "books" }),
    item("book", "b", "Great book"),
    item("chapter", "h1", "Great chapter one", { bookId: "book-a" }),
    item("chapter", "h2", "Great chapter two", { bookId: "book-b" }),
    item("note", "n", "Great note"),
    item("canvas", "c", "Great canvas"),
    item("settingsRow", "s", "Great row"),
  ];

  const pages: { page: PalettePage; section: string; kinds: string[] }[] = [
    { page: "books", section: "books", kinds: ["book:b"] },
    { page: "notes", section: "notes", kinds: ["note:n"] },
    { page: "canvases", section: "canvases", kinds: ["canvas:c"] },
  ];

  it.each(pages)("page $page only lists its kind", ({ page, section, kinds }) => {
    const index = preparePaletteIndex(mixed);
    const sections = searchPalette(index, { query: "", page, recent: [] });
    expect(sectionIds(sections)).toEqual([section]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual(kinds);
  });

  it("filters each page on a non-empty query too", () => {
    const index = preparePaletteIndex(mixed);
    const sections = searchPalette(index, { query: "great", page: "notes", recent: [] });
    expect(sectionIds(sections)).toEqual(["notes"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual(["note:n"]);
  });

  it("shows no chapters when openBookId is missing", () => {
    const index = preparePaletteIndex(mixed);
    expect(searchPalette(index, { query: "", page: "chapters", recent: [] })).toEqual([]);
    expect(
      searchPalette(index, { query: "great", page: "chapters", recent: [] })
    ).toEqual([]);
  });

  it("chapters page only lists chapters of the open Book", () => {
    const index = preparePaletteIndex(mixed);
    const sections = searchPalette(index, {
      query: "",
      page: "chapters",
      recent: [],
      openBookId: "book-a",
    });
    expect(sectionIds(sections)).toEqual(["chapters"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual(["chapter:h1"]);
  });

  it("never shows recent on a non-root page", () => {
    const index = preparePaletteIndex(mixed);
    const sections = searchPalette(index, {
      query: "great",
      page: "books",
      recent: ["note:n", "book:b"],
    });
    expect(sectionIds(sections)).toEqual(["books"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual(["book:b"]);
  });
});

describe("palette-index highlights", () => {
  it("reports contiguous label ranges for a simple prefix", () => {
    const index = preparePaletteIndex([item("command", "a", "Bold")]);
    const sections = searchPalette(index, rootQuery("bo"));
    expect(sections[0].results[0].highlights).toEqual([[0, 2]]);
  });

  it("merges fuzzy indexes into contiguous ranges", () => {
    const index = preparePaletteIndex([item("command", "a", "Toggle always on top")]);
    const sections = searchPalette(index, rootQuery("alwtop"));
    expect(sections[0].results[0].highlights).toEqual([
      [7, 10],
      [17, 20],
    ]);
  });
});

describe("liveRecentKeys", () => {
  it("keeps order and drops keys that resolve to nothing", () => {
    const index = preparePaletteIndex([
      item("command", "a", "Toggle bold"),
      item("note", "b", "Shopping list"),
    ]);
    expect(liveRecentKeys(index, ["note:b", "note:ghost", "command:a"])).toEqual([
      "note:b",
      "command:a",
    ]);
    expect(liveRecentKeys(index, [])).toEqual([]);
  });
});
