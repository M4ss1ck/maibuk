// One part of the Command Palette tests, split for #851: the entities and pages describe block.
// The support module registers the mocks, so it is imported first.
import {
  PALETTE_NAME,
  activeResultLabel,
  arrowToAndChoose,
  bookEditorTitle,
  createBookRow,
  createCanvasRow,
  createChapterRow,
  createNoteRow,
  getDatabase,
  openChapterTitle,
  openLibrarySearch,
  openPaletteWithF1,
  optionLabel,
  paletteSearch,
  path,
  platform,
  renderApp,
  sectionOptions,
  settleOn,
  updateChapterRow,
  useBookStore,
  useCommandPaletteRecentStore,
  useNoteStore,
  useSettingsRevealStore,
  web,
} from "@/test/support/command-palette";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

describe("Command Palette entities and pages", () => {
  it("lists a Book by title under Books and Enter opens the Book Editor", async () => {
    await createBookRow({ title: "Alpha", authorName: "Author" }, "local");
    await createBookRow({ title: "Beta", authorName: "Author" }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Alpha");
    const book = await within(dialog).findByRole("option", { name: "Alpha" });
    expect(within(dialog).getByText("Books")).toBeInTheDocument();
    await arrowToAndChoose(user, dialog, search, book);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(bookEditorTitle()).toBe("Alpha"));
    expect(path).toBe(`/book/${(useBookStore.getState().books[0] as { id: string }).id}`);
  });

  it("finds a Chapter of another Book, shows its Book, and opens that Book at it", async () => {
    const mine = await createBookRow({ title: "Home Book", authorName: "Author" }, "local");
    const otherBook = await createBookRow({ title: "Other Book", authorName: "Author" }, "local");
    const otherChapter = await createChapterRow(
      { bookId: otherBook.id, title: "Prologue" },
      "local"
    );
    const mineChapter = await createChapterRow({ bookId: mine.id, title: "Prologue" }, "local");
    await updateChapterRow(otherChapter.id, { content: "<p>Far away</p>" }, "local");
    await updateChapterRow(mineChapter.id, { content: "<p>Right here</p>" }, "local");

    const user = userEvent.setup();
    renderApp(`/book/${mine.id}`);
    await settleOn(`/book/${mine.id}`);

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Prologue");
    const options = await within(dialog).findAllByRole("option", { name: "Prologue" });
    expect(options).toHaveLength(2);
    const byBook = new Map(options.map((option) => [option.textContent ?? "", option] as const));
    const theirs = [...byBook.entries()].find(([text]) => text.includes("Other Book"))?.[1];
    const mineOption = [...byBook.entries()].find(([text]) => text.includes("Home Book"))?.[1];
    expect(theirs).toBeDefined();
    expect(mineOption).toBeDefined();

    await arrowToAndChoose(user, dialog, search, theirs as HTMLElement);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    // The palette navigates only after the open Chapter's text has landed, so
    // the move trails the dialog closing.
    await waitFor(() => expect(path).toBe(`/book/${otherBook.id}`));
    await waitFor(() => expect(openChapterTitle()).toBe("Prologue"));
    // The Chapter that opened is the other Book's, not this one's.
    await waitFor(() =>
      expect(document.querySelector(".tiptap")?.textContent ?? "").toContain("Far away")
    );
  });

  it("ranks the open Book's Chapters above another Book's", async () => {
    const mine = await createBookRow({ title: "Open One", authorName: "Author" }, "local");
    const other = await createBookRow({ title: "Other One", authorName: "Author" }, "local");
    await createChapterRow({ bookId: mine.id, title: "Shared Title" }, "local");
    await createChapterRow({ bookId: other.id, title: "Shared Title" }, "local");

    const user = userEvent.setup();
    renderApp(`/book/${mine.id}`);
    await settleOn(`/book/${mine.id}`);

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Shared Title");
    await waitFor(() => expect(within(dialog).getAllByRole("option").length).toBeGreaterThan(1));

    await waitFor(() => expect(search.getAttribute("aria-activedescendant")).toContain("chapter:"));
    // The first result is one of the two identical-titled Chapters, and it is
    // the open Book's: its detail says which Book it belongs to.
    const firstId = search.getAttribute("aria-activedescendant") as string;
    const first = document.getElementById(firstId) as HTMLElement;
    expect(first.textContent).toContain("Open One");

    await arrowToAndChoose(user, dialog, search, first);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    expect(path).toBe(`/book/${mine.id}`);
  });

  it("lists only the open Book's Chapters on the Open Chapter… page, and Backspace leaves it", async () => {
    const mine = await createBookRow({ title: "Open One", authorName: "Author" }, "local");
    const other = await createBookRow({ title: "Other One", authorName: "Author" }, "local");
    await createChapterRow({ bookId: mine.id, title: "Mine Only" }, "local");
    await createChapterRow({ bookId: other.id, title: "Theirs Only" }, "local");

    const user = userEvent.setup();
    renderApp(`/book/${mine.id}`);
    await settleOn(`/book/${mine.id}`);

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Open Chapter");
    const page = await within(dialog).findByRole("option", { name: "Open Chapter…" });
    await arrowToAndChoose(user, dialog, search, page);

    // The palette stays open, narrowed, with the chip naming the page.
    expect(screen.getByRole("dialog", { name: PALETTE_NAME })).toBeInTheDocument();
    expect(paletteSearch(dialog)).toHaveValue("");
    expect(within(dialog).getByText("Open Chapter")).toBeInTheDocument();
    expect(await within(dialog).findByText("Showing Open Chapter")).toBeInTheDocument();

    // The row carries the Book as its description, so compare names, not text.
    expect(within(dialog).getAllByRole("option").map(optionLabel)).toEqual(["Mine Only"]);

    // Backspace on the empty field steps back out to the root page.
    await user.keyboard("{Backspace}");
    await waitFor(() => expect(within(dialog).queryByText("Open Chapter")).toBeNull());
    // Root with an empty query lists the pages, nothing has been chosen yet.
    expect(within(dialog).queryByRole("group", { name: "Recent" })).toBeNull();
    expect(sectionOptions(dialog, "Pages").map(optionLabel)).toContain("Open Chapter…");
    // The other Book's Chapter is reachable again, which the narrowed page hid.
    await user.keyboard("Theirs");
    const theirs = await within(dialog).findByRole("option", { name: "Theirs Only" });
    expect(theirs.textContent).toContain("Other One");
  });

  it("offers the four nested pages in Library Search on every screen", async () => {
    const book = await createBookRow({ title: "Only Book", authorName: "Author" }, "local");
    await createChapterRow({ bookId: book.id, title: "Prologue" }, "local");

    const user = userEvent.setup();
    renderApp("/notes");
    await settleOn("/notes");

    const dialog = await openLibrarySearch(user);
    // Nothing typed: the four pages are how the author browses each kind.
    expect(sectionOptions(dialog, "Pages").map(optionLabel)).toEqual([
      "Open Chapter…",
      "Go to Book…",
      "Open Note…",
      "Open Canvas…",
    ]);
    const search = paletteSearch(dialog);
    await user.keyboard("Open ");
    await within(dialog).findByRole("option", { name: "Open Note…" });
    await within(dialog).findByRole("option", { name: "Open Canvas…" });
    // Outside the Book Editor the Chapters page lists every Chapter.
    await within(dialog).findByRole("option", { name: "Open Chapter…" });
    expect(search).toHaveValue("Open ");
  });

  it("narrows to Books, Chapters, Notes, and Canvases on their pages", async () => {
    const book = await createBookRow({ title: "Paged Book", authorName: "Author" }, "local");
    await createChapterRow({ bookId: book.id, title: "Paged Chapter" }, "local");
    await createNoteRow({ title: "Paged Note", bookId: null }, "local");
    await createCanvasRow({ title: "Paged Canvas" }, "local");

    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);

    for (const [pageLabel, chip, expected] of [
      ["Open Chapter…", "Open Chapter", ["Paged Chapter"]],
      ["Go to Book…", "Go to Book", ["Paged Book"]],
      ["Open Note…", "Open Note", ["Paged Note"]],
      ["Open Canvas…", "Open Canvas", ["Paged Canvas"]],
    ] as const) {
      await user.clear(search);
      await user.keyboard(pageLabel);
      const page = await within(dialog).findByRole("option", { name: pageLabel });
      await arrowToAndChoose(user, dialog, search, page);
      expect(within(dialog).getByText(chip)).toBeInTheDocument();
      await waitFor(() =>
        expect(within(dialog).getAllByRole("option").map(optionLabel)).toEqual(expected)
      );
      // Backspace on the empty field steps back out to the root page.
      await user.keyboard("{Backspace}");
      await waitFor(() => expect(within(dialog).queryByText(chip)).toBeNull());
    }
  });

  it("finds the theme row by its keywords and lands on Settings with it focused", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openPaletteWithF1(user);
    const search = paletteSearch(dialog);
    // "dark" is a keyword of the theme row, not any part of its label.
    await user.keyboard("dark");
    const theme = await within(dialog).findByRole("option", { name: "Theme" });
    expect(within(dialog).getByText("Settings")).toBeInTheDocument();
    await arrowToAndChoose(user, dialog, search, theme);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(path).toBe("/settings"));
    await waitFor(() =>
      expect(document.activeElement?.closest('[data-settings-row="theme"]')).not.toBeNull()
    );
    expect(document.activeElement).toBe(
      document.querySelector('[data-settings-row="theme"] button')
    );
  });

  it("reveals a row inside the collapsed Advanced block and focuses it", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openPaletteWithF1(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Export Database");
    const row = await within(dialog).findByRole("option", { name: "Export Database" });
    await arrowToAndChoose(user, dialog, search, row);

    await waitFor(() => expect(path).toBe("/settings"));
    // The block is collapsed on arrival and the result opened it to focus the row.
    await waitFor(() =>
      expect(document.activeElement?.closest('[data-settings-row="exportDatabase"]')).not.toBeNull()
    );
    expect(useSettingsRevealStore.getState().advancedOpen).toBe(true);
    expect(useSettingsRevealStore.getState().pendingRowId).toBeNull();
  });

  it("hides desktop-only Settings rows on the web build", async () => {
    web.value = true;
    platform.desktop = false;
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openPaletteWithF1(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Launch on startup");
    await within(dialog).findByText("No results");
    expect(within(dialog).queryByRole("option", { name: "Launch on startup" })).toBeNull();

    // A row every platform has is still there.
    await user.clear(search);
    await user.keyboard(">Choose your preferred theme");
    expect(await within(dialog).findByRole("option", { name: "Theme" })).toBeInTheDocument();
  });

  it("drops a deleted Note from Recent on the next open, without an error", async () => {
    const keep = await createNoteRow({ title: "Keeper", bookId: null }, "local");
    const doomed = await createNoteRow({ title: "Doomed", bookId: null }, "local");
    useCommandPaletteRecentStore.setState({ keys: [`note:${keep.id}`, `note:${doomed.id}`] });

    const user = userEvent.setup();
    renderApp("/notes");
    await settleOn("/notes");

    // Deleted through the Notes write path, the same one the Item Menu uses.
    await act(() => useNoteStore.getState().deleteNote(doomed.id));

    await openLibrarySearch(user);
    const dialog = screen.getByRole("dialog", { name: PALETTE_NAME });
    await waitFor(() =>
      expect(sectionOptions(dialog, "Recent").map(optionLabel)).toEqual(["Keeper"])
    );
    await waitFor(() =>
      expect(useCommandPaletteRecentStore.getState().keys).toEqual([`note:${keep.id}`])
    );
    expect(screen.queryByText("Doomed")).toBeNull();
  });

  it("lists the four pages when nothing is recent, and choosing one narrows", async () => {
    await createNoteRow({ title: "Findable", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    expect(within(dialog).queryByRole("group", { name: "Recent" })).toBeNull();
    expect(sectionOptions(dialog, "Pages").map(optionLabel)).toEqual([
      "Open Chapter…",
      "Go to Book…",
      "Open Note…",
      "Open Canvas…",
    ]);

    // Nothing is active until the first arrow: the list opens on the pages.
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(activeResultLabel(search)).toContain("Open Chapter…"));
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(activeResultLabel(search)).toContain("Go to Book…"));
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(activeResultLabel(search)).toContain("Open Note…"));
    await user.keyboard("{Enter}");
    expect(await within(dialog).findByText("Showing Open Note")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("option").map(optionLabel)).toEqual(["Findable"]);
  });

  it("lands the open editor's text before navigating away to a Note", async () => {
    const book = await createBookRow({ title: "Unsaved", authorName: "Author" }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "Draft" }, "local");
    const note = await createNoteRow({ title: "Destination", bookId: null }, "local");

    const user = userEvent.setup();
    renderApp(`/book/${book.id}`);
    await settleOn(`/book/${book.id}`);
    const editorDom = await waitFor(() => {
      const element = document.querySelector('[data-focus-pane="editor-main"] .tiptap');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    act(() => {
      editorDom.focus();
    });

    await user.keyboard("Typed straight through");
    // The debounced save has not run: the Library has no trace of the text yet.
    const before = await getDatabase();
    const beforeRows = await before.select<{ content: string | null }[]>(
      "SELECT content FROM chapters WHERE id = ?",
      [chapter.id]
    );
    expect(beforeRows[0]?.content ?? "").not.toContain("Typed straight through");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Destination");
    const row = await within(dialog).findByRole("option", { name: "Destination" });
    await arrowToAndChoose(user, dialog, search, row);

    await waitFor(() => expect(path).toBe(`/notes/${note.id}`));
    const after = await getDatabase();
    const afterRows = await after.select<{ content: string | null }[]>(
      "SELECT content FROM chapters WHERE id = ?",
      [chapter.id]
    );
    expect(afterRows[0]?.content ?? "").toContain("Typed straight through");
  });

  it("opens an Unfiled Note from the palette", async () => {
    await createNoteRow({ title: "Loose Thought", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Loose");
    const note = await within(dialog).findByRole("option", { name: "Loose Thought" });
    await arrowToAndChoose(user, dialog, search, note);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(path).toBe(`/notes/${useNoteStore.getState().notes[0]?.id}`));
    await waitFor(() => expect(bookEditorTitle()).toBe("Loose Thought"));
  });

  it("opens a Canvas from the palette", async () => {
    const canvas = await createCanvasRow({ title: "Story Arcs" }, "local");
    const user = userEvent.setup();
    renderApp("/canvas");
    await settleOn("/canvas");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Story Arcs");
    const row = await within(dialog).findByRole("option", { name: "Story Arcs" });
    await arrowToAndChoose(user, dialog, search, row);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(path).toBe(`/canvas/${canvas.id}`));
  });
});
