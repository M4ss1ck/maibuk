import { describe, expect, it } from "vitest";
import {
  PALETTE_EMPTY_ROOT_LIMIT,
  PALETTE_SECTION_CAP,
  PALETTE_SUGGESTED_COMMAND_KEYS,
  PALETTE_SUGGESTED_PAGE_KEYS,
  liveRecentKeys,
  paletteModeOf,
  paletteQueryText,
  preparePaletteIndex,
  searchPalette,
} from "@/features/command-palette/palette-index";
import type {
  PaletteItem,
  PaletteItemKind,
  PaletteMode,
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

function query(mode: PaletteMode, text: string, extra?: Partial<PaletteQuery>): PaletteQuery {
  return { mode, query: text, page: "root", recent: [], ...extra };
}

function sectionIds(results: { id: string }[]): string[] {
  return results.map((section) => section.id);
}

describe("palette modes", () => {
  it("reads a leading > as Commands mode, keeping it out of the query", () => {
    expect(paletteModeOf(">")).toBe("commands");
    expect(paletteModeOf(">bold")).toBe("commands");
    expect(paletteModeOf("bold")).toBe("library");
    expect(paletteModeOf("")).toBe("library");
    expect(paletteQueryText(">bold")).toBe("bold");
    expect(paletteQueryText(">")).toBe("");
    expect(paletteQueryText("bold")).toBe("bold");
  });

  it("lists Commands and Settings rows in Commands mode, never the Library", () => {
    const index = preparePaletteIndex([
      item("command", "c", "Great command"),
      item("settingsRow", "s", "Great row"),
      item("book", "b", "Great book"),
      item("chapter", "h", "Great chapter", { bookId: "book-a" }),
      item("note", "n", "Great note"),
      item("canvas", "v", "Great canvas"),
      item("page", "books", "Great pages", { targetPage: "books" }),
    ]);
    const sections = searchPalette(index, query("commands", "great"));
    expect(sectionIds(sections)).toEqual(["commands", "settings"]);
    expect(sections.flatMap((section) => section.results.map((result) => result.item.key))).toEqual(
      ["command:c", "settingsRow:s"]
    );
  });

  it("lists Books, Chapters, Notes, Canvases, and pages in Library Search, never Commands", () => {
    const index = preparePaletteIndex([
      item("command", "c", "Great command"),
      item("settingsRow", "s", "Great row"),
      item("book", "b", "Great book"),
      item("chapter", "h", "Great chapter", { bookId: "book-a" }),
      item("note", "n", "Great note"),
      item("canvas", "v", "Great canvas"),
      item("page", "books", "Great pages", { targetPage: "books" }),
    ]);
    const sections = searchPalette(index, query("library", "great"));
    expect(sectionIds(sections)).toEqual(["pages", "chapters", "notes", "books", "canvases"]);
  });
});

describe("palette-index ranking", () => {
  it("exact beats prefix beats fuzzy", () => {
    const items = [
      item("command", "c", "Book list bold"),
      item("command", "b", "Bold italic"),
      item("command", "a", "Bold"),
    ];
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, query("commands", "bold"));
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
    const items = [
      item("command", "a", "Toggle always on top"),
      item("command", "b", "Export book"),
    ];
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, query("commands", "alwtop"));
    expect(sections).toHaveLength(1);
    expect(sections[0].results.map((r) => r.item.label)).toEqual(["Toggle always on top"]);
  });

  it("finds a term-only match with empty highlights", () => {
    const items = [
      item("command", "a", "Toggle bold", { terms: ["put the title in strong"] }),
      item("command", "b", "Export book"),
    ];
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, query("commands", "strong"));
    expect(sections).toHaveLength(1);
    expect(sections[0].results).toHaveLength(1);
    expect(sections[0].results[0].item.label).toBe("Toggle bold");
    expect(sections[0].results[0].highlights).toEqual([]);
  });

  it("matches diacritics-insensitively", () => {
    const items = [item("note", "a", "Nota sobre la canción"), item("note", "b", "Shopping list")];
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, query("library", "cancion"));
    expect(sections).toHaveLength(1);
    expect(sections[0].results.map((r) => r.item.label)).toEqual(["Nota sobre la canción"]);
  });

  it("ranks an open-Book chapter above an equal chapter of another Book", () => {
    const items = [
      item("chapter", "other", "The arrival", { bookId: "book-b" }),
      item("chapter", "open", "The arrival", { bookId: "book-a" }),
    ];
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, query("library", "arrival", { openBookId: "book-a" }));
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
    const sections = searchPalette(index, query("library", "note"));
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("notes");
    expect(sections[0].results).toHaveLength(50);
  });

  it("orders Library sections as Chapters, Notes, Books, Canvases after the pages", () => {
    const items = [
      item("settingsRow", "s", "Accent color setting"),
      item("canvas", "c", "Accent wall canvas"),
      item("book", "b", "Accent book of poems"),
      item("note", "n", "Accent note"),
      item("chapter", "h", "Accent chapter", { bookId: "book-x" }),
      item("command", "m", "Accent command"),
      item("page", "books", "Accent pages", { targetPage: "books" }),
    ];
    const index = preparePaletteIndex(items);
    expect(sectionIds(searchPalette(index, query("library", "accent")))).toEqual([
      "pages",
      "chapters",
      "notes",
      "books",
      "canvases",
    ]);
    expect(sectionIds(searchPalette(index, query("commands", "accent")))).toEqual([
      "commands",
      "settings",
    ]);
  });

  it("moves a matching recent item into recent without duplicating it", () => {
    const bold = item("command", "bold", "Toggle bold");
    const other = item("command", "export", "Export bold draft");
    const index = preparePaletteIndex([bold, other]);
    const sections = searchPalette(index, query("commands", "bold", { recent: [bold.key] }));
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
      query("commands", "export", { recent: [fuzzy.key, exact.key] })
    );
    expect(sectionIds(sections)).toEqual(["recent"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual([fuzzy.key, exact.key]);
  });

  it("lists disabled items like runnable ones", () => {
    const items = [item("command", "a", "Toggle bold", { state: "disabled" })];
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, query("commands", "bold"));
    expect(sections[0].results).toHaveLength(1);
    expect(sections[0].results[0].item.state).toBe("disabled");
  });
});

describe("palette-index empty query", () => {
  it("lists only the mode's Recent on root, in recent order, dropping unknown keys", () => {
    const command = item("command", "a", "Toggle bold");
    const note = item("note", "b", "Shopping list");
    const book = item("book", "c", "My novel");
    const index = preparePaletteIndex([command, note, book]);
    const recent = [note.key, "note:missing", command.key];

    const commands = searchPalette(index, query("commands", "   ", { recent }));
    expect(sectionIds(commands)).toEqual(["recent"]);
    expect(commands[0].results.map((r) => r.item.key)).toEqual([command.key]);
    for (const result of commands[0].results) {
      expect(result.score).toBe(0);
      expect(result.highlights).toEqual([]);
    }

    const library = searchPalette(index, query("library", "   ", { recent }));
    expect(library[0].results.map((r) => r.item.key)).toEqual([note.key]);
  });

  it("returns no sections on root when nothing recent resolves", () => {
    const index = preparePaletteIndex([item("command", "a", "Toggle bold")]);
    expect(searchPalette(index, query("commands", "", { recent: ["note:ghost"] }))).toEqual([]);
    expect(searchPalette(index, query("commands", ""))).toEqual([]);
    expect(searchPalette(index, query("library", ""))).toEqual([]);
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

  it("suggests Commands on an empty Commands mode, in suggestion order", () => {
    const items = PALETTE_SUGGESTED_COMMAND_KEYS.map((key) => suggestedItem(key));
    const index = preparePaletteIndex([
      item("command", "zz", "Not suggested"),
      ...items,
      ...PALETTE_SUGGESTED_PAGE_KEYS.map((key) => suggestedItem(key)),
    ]);
    const sections = searchPalette(index, query("commands", ""));
    expect(sectionIds(sections)).toEqual(["suggested"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual(
      PALETTE_SUGGESTED_COMMAND_KEYS.slice(0, PALETTE_EMPTY_ROOT_LIMIT)
    );
  });

  it("suggests the four nested pages on an empty Library Search, in order", () => {
    const index = preparePaletteIndex([
      ...PALETTE_SUGGESTED_COMMAND_KEYS.map((key) => suggestedItem(key)),
      ...PALETTE_SUGGESTED_PAGE_KEYS.map((key) => suggestedItem(key)),
    ]);
    const sections = searchPalette(index, query("library", ""));
    expect(sectionIds(sections)).toEqual(["pages"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual([...PALETTE_SUGGESTED_PAGE_KEYS]);
  });

  it("fills up to the limit after Recent, never repeating a Recent item", () => {
    const items = PALETTE_SUGGESTED_COMMAND_KEYS.map((key) => suggestedItem(key));
    const extra = [item("command", "n1", "One"), item("command", "n2", "Two")];
    const index = preparePaletteIndex([...extra, ...items]);
    const recent = [extra[0].key, PALETTE_SUGGESTED_COMMAND_KEYS[0], extra[1].key];
    const sections = searchPalette(index, query("commands", "", { recent }));
    expect(sectionIds(sections)).toEqual(["recent", "suggested"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual(recent);
    const suggested = sections[1].results.map((r) => r.item.key);
    expect(suggested).not.toContain(PALETTE_SUGGESTED_COMMAND_KEYS[0]);
    expect(suggested).toEqual(
      PALETTE_SUGGESTED_COMMAND_KEYS.slice(1, 1 + PALETTE_EMPTY_ROOT_LIMIT - recent.length)
    );
  });

  it("skips suggestions this screen does not offer or cannot run", () => {
    const [first, second, third] = PALETTE_SUGGESTED_COMMAND_KEYS;
    const index = preparePaletteIndex([
      suggestedItem(first, { state: "disabled" }),
      suggestedItem(third),
    ]);
    const sections = searchPalette(index, query("commands", ""));
    expect(sectionIds(sections)).toEqual(["suggested"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual([third]);
    expect(sections[0].results.map((r) => r.item.key)).not.toContain(second);
  });

  it("suggests nothing once Recent reaches the limit", () => {
    const commandsRecent = Array.from({ length: PALETTE_EMPTY_ROOT_LIMIT }, (_, n) =>
      item("command", `c${n}`, `Command ${n}`)
    );
    const notes = Array.from({ length: PALETTE_EMPTY_ROOT_LIMIT }, (_, n) =>
      item("note", `n${n}`, `Note ${n}`)
    );
    const index = preparePaletteIndex([
      ...commandsRecent,
      ...notes,
      ...PALETTE_SUGGESTED_COMMAND_KEYS.map((key) => suggestedItem(key)),
      ...PALETTE_SUGGESTED_PAGE_KEYS.map((key) => suggestedItem(key)),
    ]);
    expect(
      sectionIds(
        searchPalette(
          index,
          query("commands", "", { recent: commandsRecent.map((entry) => entry.key) })
        )
      )
    ).toEqual(["recent"]);
    expect(
      sectionIds(
        searchPalette(index, query("library", "", { recent: notes.map((note) => note.key) }))
      )
    ).toEqual(["recent"]);
  });

  it("never suggests on a typed query or a nested page", () => {
    const index = preparePaletteIndex([
      ...PALETTE_SUGGESTED_COMMAND_KEYS.map((key) => suggestedItem(key)),
      ...PALETTE_SUGGESTED_PAGE_KEYS.map((key) => suggestedItem(key)),
    ]);
    expect(sectionIds(searchPalette(index, query("commands", "label")))).not.toContain("suggested");
    expect(sectionIds(searchPalette(index, query("library", "label")))).not.toContain("suggested");
    expect(searchPalette(index, query("library", "", { page: "notes" }))).toEqual([]);
  });

  it("lists a page's items uncapped and in input order", () => {
    const items = Array.from({ length: 60 }, (_, n) =>
      item("note", `n${n}`, `Zebra note ${59 - n}`)
    );
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, query("library", "", { page: "notes" }));
    expect(sectionIds(sections)).toEqual(["notes"]);
    expect(sections[0].results).toHaveLength(60);
    expect(sections[0].results.map((r) => r.item.id)).toEqual(items.map((entry) => entry.id));
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
    const sections = searchPalette(index, query("library", "", { page }));
    expect(sectionIds(sections)).toEqual([section]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual(kinds);
  });

  it("filters each page on a non-empty query too", () => {
    const index = preparePaletteIndex(mixed);
    const sections = searchPalette(index, query("library", "great", { page: "notes" }));
    expect(sectionIds(sections)).toEqual(["notes"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual(["note:n"]);
  });

  it("lists every Chapter on the Chapters page outside the Book Editor", () => {
    const index = preparePaletteIndex(mixed);
    const sections = searchPalette(index, query("library", "", { page: "chapters" }));
    expect(sectionIds(sections)).toEqual(["chapters"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual(["chapter:h1", "chapter:h2"]);
  });

  it("chapters page only lists chapters of the open Book", () => {
    const index = preparePaletteIndex(mixed);
    const sections = searchPalette(
      index,
      query("library", "", { page: "chapters", openBookId: "book-a" })
    );
    expect(sectionIds(sections)).toEqual(["chapters"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual(["chapter:h1"]);
  });

  it("never shows recent on a non-root page", () => {
    const index = preparePaletteIndex(mixed);
    const sections = searchPalette(
      index,
      query("library", "great", { page: "books", recent: ["note:n", "book:b"] })
    );
    expect(sectionIds(sections)).toEqual(["books"]);
    expect(sections[0].results.map((r) => r.item.key)).toEqual(["book:b"]);
  });

  it("never lists a nested page in Commands mode", () => {
    const index = preparePaletteIndex(mixed);
    expect(searchPalette(index, query("commands", "books"))).toEqual([]);
  });
});

describe("palette-index highlights", () => {
  it("reports contiguous label ranges for a simple prefix", () => {
    const index = preparePaletteIndex([item("command", "a", "Bold")]);
    const sections = searchPalette(index, query("commands", "bo"));
    expect(sections[0].results[0].highlights).toEqual([[0, 2]]);
  });

  it("merges fuzzy indexes into contiguous ranges", () => {
    const index = preparePaletteIndex([item("command", "a", "Toggle always on top")]);
    const sections = searchPalette(index, query("commands", "alwtop"));
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
