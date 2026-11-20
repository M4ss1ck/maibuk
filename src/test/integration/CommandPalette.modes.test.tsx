// One part of the Command Palette tests, split for #851: the modes, switches, text results, and entry buttons describes.
// The support module registers the mocks, so it is imported first.
import {
  COMMANDS_PREFIX,
  PALETTE_NAME,
  SEARCH_SWITCHES_STORAGE_KEY,
  activeResultLabel,
  arrowToAndChoose,
  authorDb,
  createBookRow,
  createCanvasRow,
  createChapterRow,
  createNoteRow,
  en,
  indexBlank,
  openChapterTitle,
  openLibrarySearch,
  openPaletteWithF1,
  optionLabel,
  paletteSearch,
  path,
  renderApp,
  requestSearchRebuild,
  resetSearchIndexForTests,
  sectionOptions,
  settleOn,
  updateChapterRow,
  useCommandPaletteRecentStore,
  useSearchSwitchesStore,
  useSettingsStore,
} from "@/test/support/command-palette";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { computeAccessibleName } from "dom-accessibility-api";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";

describe("Command Palette modes", () => {
  it("switches to Commands mode on a leading > and back to Library Search when it goes", async () => {
    await createBookRow({ title: "Paged Book", authorName: "Author" }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Paged");
    await within(dialog).findByRole("option", { name: "Paged Book" });
    expect(within(dialog).getByText("Books")).toBeInTheDocument();

    // A leading > asks for Commands, and says so.
    await user.clear(search);
    await user.keyboard(">");
    await waitFor(() =>
      expect(within(dialog).getByRole("status")).toHaveTextContent(
        en("commandPalette.modes.commands")
      )
    );
    await user.keyboard("Paged");
    await waitFor(() =>
      expect(within(dialog).queryByRole("option", { name: "Paged Book" })).toBeNull()
    );
    expect(within(dialog).queryByText("Books")).toBeNull();

    // Deleting the prefix goes back to Library Search, and says so.
    await user.clear(search);
    await waitFor(() =>
      expect(within(dialog).getByRole("status")).toHaveTextContent(
        en("commandPalette.modes.library")
      )
    );
    await user.keyboard("Paged");
    expect(await within(dialog).findByRole("option", { name: "Paged Book" })).toBeInTheDocument();
  });

  it("Backspace on a lone > switches to Library Search instead of closing", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openPaletteWithF1(user);
    const search = paletteSearch(dialog);
    expect(search).toHaveValue(COMMANDS_PREFIX);

    await user.keyboard("{Backspace}");

    // Still open, empty, and searching the Library.
    expect(screen.getByRole("dialog", { name: PALETTE_NAME })).toBeInTheDocument();
    expect(search).toHaveValue("");
    expect(sectionOptions(dialog, "Pages").map(optionLabel)).toEqual([
      "Open Chapter…",
      "Go to Book…",
      "Open Note…",
      "Open Canvas…",
    ]);
    await waitFor(() =>
      expect(within(dialog).getByRole("status")).toHaveTextContent(
        en("commandPalette.modes.library")
      )
    );
  });

  it("typing > inside a nested page leaves it for Commands mode", async () => {
    await createNoteRow({ title: "Nested Note", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Open Note");
    const page = await within(dialog).findByRole("option", { name: "Open Note…" });
    await arrowToAndChoose(user, dialog, search, page);
    expect(await within(dialog).findByText("Showing Open Note")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("option").map(optionLabel)).toEqual(["Nested Note"]);

    // > always means Commands, so it leaves the page instead of searching it.
    await user.keyboard(">");
    await waitFor(() => expect(within(dialog).queryByText("Showing Open Note")).toBeNull());
    expect(search).toHaveValue(COMMANDS_PREFIX);
    await waitFor(() => expect(sectionOptions(dialog, "Suggested").length).toBeGreaterThan(0));
    expect(within(dialog).queryByRole("option", { name: "Nested Note" })).toBeNull();
  });

  it("lists recent Commands and Settings rows, then suggested Commands, with nothing typed", async () => {
    useCommandPaletteRecentStore.setState({
      keys: ["command:global.themeDark", "settingsRow:theme"],
    });
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openPaletteWithF1(user);
    expect(sectionOptions(dialog, "Recent").map(optionLabel)).toEqual(["Dark", "Theme"]);
    const suggested = sectionOptions(dialog, "Suggested").map(optionLabel);
    expect(suggested.length).toBeGreaterThan(0);
    expect(suggested).toContain("Create new book");
    // Commands mode has no Library pages to browse.
    expect(within(dialog).queryByRole("group", { name: "Pages" })).toBeNull();
  });

  it("lists recent Library items, then the four pages, with nothing typed", async () => {
    const book = await createBookRow({ title: "Recent Book", authorName: "Author" }, "local");
    useCommandPaletteRecentStore.setState({
      keys: [`book:${book.id}`, "command:global.themeDark"],
    });
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    await waitFor(() =>
      expect(sectionOptions(dialog, "Recent").map(optionLabel)).toEqual(["Recent Book"])
    );
    expect(sectionOptions(dialog, "Pages").map(optionLabel)).toEqual([
      "Open Chapter…",
      "Go to Book…",
      "Open Note…",
      "Open Canvas…",
    ]);
    // Library Search has no Commands to suggest.
    expect(within(dialog).queryByRole("group", { name: "Suggested" })).toBeNull();
  });

  it("keeps one recent list, filtered per mode, and removes from it in both", async () => {
    const note = await createNoteRow({ title: "Recent Note", bookId: null }, "local");
    useCommandPaletteRecentStore.setState({
      keys: ["command:global.themeDark", `note:${note.id}`],
    });
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    // Commands mode shows only the Command of the two.
    let dialog = await openPaletteWithF1(user);
    await waitFor(() =>
      expect(sectionOptions(dialog, "Recent").map(optionLabel)).toEqual(["Dark"])
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());

    // Library Search shows only the Note; removing it leaves the Command.
    dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await waitFor(() =>
      expect(sectionOptions(dialog, "Recent").map(optionLabel)).toEqual(["Recent Note"])
    );
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(activeResultLabel(search)).toContain("Recent Note"));
    await user.keyboard("{Shift>}{Delete}{/Shift}");
    await waitFor(() => expect(within(dialog).queryByRole("group", { name: "Recent" })).toBeNull());
    expect(useCommandPaletteRecentStore.getState().keys).toEqual(["command:global.themeDark"]);

    // The Command's own mode still lists it, and removes it too.
    await user.keyboard("{Escape}");
    dialog = await openPaletteWithF1(user);
    expect(sectionOptions(dialog, "Recent").map(optionLabel)).toEqual(["Dark"]);
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Shift>}{Delete}{/Shift}");
    await waitFor(() => expect(useCommandPaletteRecentStore.getState().keys).toEqual([]));
    await waitFor(() => expect(within(dialog).queryByRole("group", { name: "Recent" })).toBeNull());
    expect(sectionOptions(dialog, "Suggested").length).toBeGreaterThan(0);
  });
});

describe("Command Palette search switches", () => {
  const MATCH_CASE = "Match Case";
  const WHOLE_WORD = "Match Whole Word";
  const REGEX = "Use Regular Expression";

  function switchButton(dialog: HTMLElement, name: string): HTMLElement {
    return within(dialog).getByRole("button", { name });
  }

  const switches = () => useSearchSwitchesStore.getState();

  it("shows its three switches in Library Search only", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    // Commands mode stays plain.
    let dialog = await openPaletteWithF1(user);
    for (const name of [MATCH_CASE, WHOLE_WORD, REGEX]) {
      expect(within(dialog).queryByRole("button", { name })).toBeNull();
    }
    // Its switch keys are inert there: no invisible state to flip.
    await user.keyboard("{Alt>}c{/Alt}");
    expect(switches().matchCase).toBe(false);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());

    dialog = await openLibrarySearch(user);
    for (const name of [MATCH_CASE, WHOLE_WORD, REGEX]) {
      expect(switchButton(dialog, name)).toBeVisible();
    }
  });

  it("toggles each switch with Alt+C, Alt+W and Alt+R and keeps the typed query", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Cat");
    expect(search).toHaveValue("Cat");

    await user.keyboard("{Alt>}c{/Alt}");
    await waitFor(() => expect(switches().matchCase).toBe(true));
    await user.keyboard("{Alt>}w{/Alt}");
    await waitFor(() => expect(switches().wholeWord).toBe(true));
    await user.keyboard("{Alt>}r{/Alt}");
    await waitFor(() => expect(switches().regex).toBe(true));

    // The switch keys are not typed into the field.
    expect(search).toHaveValue("Cat");
  });

  it("renders the switches inside the search field's wrapper", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const input = paletteSearch(dialog);
    const field = switchButton(dialog, MATCH_CASE).closest(".relative");
    expect(field).not.toBeNull();
    expect(field).toContainElement(input);
    for (const name of [MATCH_CASE, WHOLE_WORD, REGEX]) {
      expect(field).toContainElement(switchButton(dialog, name));
    }
  });

  it("tabs from the search field to Match case, and Space flips it", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const input = paletteSearch(dialog);
    await waitFor(() => expect(input).toHaveFocus());

    await user.tab();
    const matchCase = switchButton(dialog, MATCH_CASE);
    expect(matchCase).toHaveFocus();
    expect(matchCase).toHaveAttribute("aria-pressed", "false");

    await user.keyboard(" ");
    await waitFor(() => expect(switches().matchCase).toBe(true));
    expect(matchCase).toHaveAttribute("aria-pressed", "true");
  });

  it("flips a switch back with its own key", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await openLibrarySearch(user);
    await user.keyboard("{Alt>}c{/Alt}");
    await waitFor(() => expect(switches().matchCase).toBe(true));

    await user.keyboard("{Alt>}c{/Alt}");
    await waitFor(() => expect(switches().matchCase).toBe(false));
  });

  it("toggles from a press, so the switches work without a keyboard", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    await user.click(switchButton(dialog, WHOLE_WORD));
    await waitFor(() => expect(switches().wholeWord).toBe(true));

    await user.click(switchButton(dialog, WHOLE_WORD));
    await waitFor(() => expect(switches().wholeWord).toBe(false));
  });

  it("shows each Shortcut while the field is empty and hides it once the author types", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    for (const name of [MATCH_CASE, WHOLE_WORD, REGEX]) {
      expect(switchButton(dialog, name).textContent ?? "").toContain("Alt");
    }

    await user.keyboard("a");
    for (const name of [MATCH_CASE, WHOLE_WORD, REGEX]) {
      expect(switchButton(dialog, name).textContent ?? "").not.toContain("Alt");
    }
  });

  it("remembers the switches when the palette reopens", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    let dialog = await openLibrarySearch(user);
    await user.keyboard("{Alt>}c{/Alt}");
    await waitFor(() => expect(switches().matchCase).toBe(true));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());

    dialog = await openLibrarySearch(user);
    expect(switches().matchCase).toBe(true);
    // The reopened palette's buttons still carry the state.
    expect(switchButton(dialog, MATCH_CASE)).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the switches across a simulated reload from this device's storage", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await openLibrarySearch(user);
    await user.keyboard("{Alt>}w{/Alt}");
    await waitFor(() => expect(switches().wholeWord).toBe(true));
    await user.keyboard("{Escape}");

    const saved = localStorage.getItem(SEARCH_SWITCHES_STORAGE_KEY) ?? "";
    expect(saved).not.toBe("");

    // A reload starts from the defaults and reads the device's blob back.
    useSearchSwitchesStore.setState({ matchCase: false, wholeWord: false, regex: false });
    localStorage.setItem(SEARCH_SWITCHES_STORAGE_KEY, saved);
    await useSearchSwitchesStore.persist.rehydrate();
    expect(switches().wholeWord).toBe(true);

    const dialog = await openLibrarySearch(user);
    expect(switchButton(dialog, WHOLE_WORD)).toHaveAttribute("aria-pressed", "true");
  });

  it("flips the same switches from the Notes editor, with no palette open", async () => {
    const note = await createNoteRow({ title: "Switch Note", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp(`/notes/${note.id}`);
    await settleOn(`/notes/${note.id}`);

    await user.keyboard("{Alt>}c{/Alt}");
    await waitFor(() => expect(switches().matchCase).toBe(true));

    await user.keyboard("{Alt>}w{/Alt}");
    await waitFor(() => expect(switches().wholeWord).toBe(true));

    await user.keyboard("{Alt>}r{/Alt}");
    await waitFor(() => expect(switches().regex).toBe(true));
  });
});

describe("Command Palette text results", () => {
  async function seedHarbour() {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "Lookout" }, "local");
    await updateChapterRow(
      chapter.id,
      { content: "<p>The harbour light blinked, harbour dark</p>" },
      "local"
    );
    const note = await createNoteRow(
      { title: "Marginalia", content: "<p>harbour gossip</p>" },
      "local"
    );
    return { book, chapter, note };
  }

  /** The Text group's options, by each one's accessible name. */
  function textOptionsByName(dialog: HTMLElement): Map<string, HTMLElement> {
    return new Map(
      sectionOptions(dialog, "Text").map(
        (option) => [option.getAttribute("aria-label") ?? "", option] as const
      )
    );
  }

  it("lists title matches first, then one Text row per item", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "Harbour Watch" }, "local");
    await updateChapterRow(
      chapter.id,
      { content: "<p>The harbour light blinked, harbour dark</p>" },
      "local"
    );
    await createNoteRow({ title: "Marginalia", content: "<p>harbour gossip</p>" }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    await user.paste("harbour");

    const textGroup = await within(dialog).findByRole("group", { name: "Text" });
    // The Text section trails every title section.
    const chaptersGroup = within(dialog).getByRole("group", { name: "Chapters" });
    expect(
      chaptersGroup.compareDocumentPosition(textGroup) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // One row per item, however many times the item matched.
    expect(sectionOptions(dialog, "Text")).toHaveLength(2);
    // Two matches fit well under the cap, so no refine line.
    expect(within(dialog).queryByText(en("commandPalette.textRefine"))).toBeNull();
  });

  it("highlights the snippet, names the Book, says how many more, and announces it all", async () => {
    await seedHarbour();
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    await user.paste("harbour");
    await within(dialog).findByRole("group", { name: "Text" });

    const byName = textOptionsByName(dialog);
    const chapterName = [...byName.keys()].find((name) => name.includes("Lookout"));
    expect(chapterName).toBeDefined();
    const chapterOption = byName.get(chapterName as string) as HTMLElement;
    // The accessible name carries kind, title, Book, and snippet text.
    expect(chapterName).toContain("Chapter");
    expect(chapterName).toContain("Lookout");
    expect(chapterName).toContain("Atlas");
    expect(chapterName).toContain("harbour");
    // The match is highlighted where it stands.
    const mark = chapterOption.querySelector("mark");
    expect(mark?.textContent).toBe("harbour");
    // The Book is the detail, and two matches say one more.
    expect(chapterOption.textContent).toContain("Atlas");
    expect(chapterOption.textContent).toContain(en("commandPalette.textMore", { count: 1 }));

    // The single-match Note names no "+N more".
    const noteName = [...byName.keys()].find((name) => name.includes("Marginalia"));
    expect(noteName).toBeDefined();
    expect(noteName).toContain("Note");
    expect(noteName).toContain("harbour");
    expect((byName.get(noteName as string) as HTMLElement).textContent).not.toContain("+");
  });

  it("announces the result count with the text results in it", async () => {
    await seedHarbour();
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    await user.paste("harbour");
    await within(dialog).findByRole("group", { name: "Text" });

    // No title matches "harbour": the two text rows are the whole count.
    await waitFor(() =>
      expect(within(dialog).getByRole("status")).toHaveTextContent(
        en("commandPalette.resultCount", { count: 2 })
      )
    );
  });

  it("caps the Text section at 50 rows with a line asking to refine", async () => {
    for (let index = 0; index < 55; index += 1) {
      await createNoteRow(
        { title: `Cap Note ${index}`, content: "<p>capybara meadow</p>" },
        "local"
      );
    }
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    await user.paste("capybara");

    await within(dialog).findByRole("group", { name: "Text" });
    // The list virtualizes to its viewport, so jsdom mounts only the visible
    // rows: the cap shows as the refine line, which renders only when the
    // module reports more than the Text section's 50 rows.
    expect(await within(dialog).findByText(en("commandPalette.textRefine"))).toBeInTheDocument();
    const rendered = sectionOptions(dialog, "Text");
    expect(rendered.length).toBeGreaterThan(2);
    expect(rendered.length).toBeLessThanOrEqual(50);
  });

  it("narrows the text results on a nested page", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    await createChapterRow({ bookId: book.id, title: "Lookout" }, "local").then((chapter) =>
      updateChapterRow(chapter.id, { content: "<p>sharedword in a chapter</p>" }, "local")
    );
    await createNoteRow({ title: "Marginalia", content: "<p>sharedword in a note</p>" }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Open Note");
    const page = await within(dialog).findByRole("option", { name: "Open Note…" });
    await arrowToAndChoose(user, dialog, search, page);
    expect(await within(dialog).findByText("Showing Open Note")).toBeInTheDocument();

    await user.paste("sharedword");
    await within(dialog).findByRole("group", { name: "Text" });
    await waitFor(() => expect(sectionOptions(dialog, "Text")).toHaveLength(1));
    const names = [...textOptionsByName(dialog).keys()];
    expect(names.some((name) => name.includes("Marginalia"))).toBe(true);
    expect(names.some((name) => name.includes("Lookout"))).toBe(false);
  });

  it("follows Match case: toggling it changes the text results", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "Felines" }, "local");
    await updateChapterRow(chapter.id, { content: "<p>Cat cat</p>" }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    await user.keyboard("Cat");
    await within(dialog).findByRole("group", { name: "Text" });
    // Case ignored: both fall on one row with one more.
    await waitFor(() =>
      expect(sectionOptions(dialog, "Text")[0].textContent).toContain(
        en("commandPalette.textMore", { count: 1 })
      )
    );

    await user.keyboard("{Alt>}c{/Alt}");
    // Case matched: one match left, so the "+N more" goes.
    await waitFor(() =>
      expect(sectionOptions(dialog, "Text")[0].textContent).not.toContain(
        en("commandPalette.textMore", { count: 1 })
      )
    );
    expect(sectionOptions(dialog, "Text")).toHaveLength(1);
  });

  it("shows an error line instead of text results for an invalid Regex", async () => {
    await seedHarbour();
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    // Alt+R keeps focus in the field; a click would leave it on the button.
    await user.keyboard("{Alt>}r{/Alt}");
    // "[" would read as user-event's repeat syntax; "(" is an invalid Regex
    // all the same and types literally.
    await user.keyboard("(unclosed");

    expect(
      await within(dialog).findByText(en("commandPalette.textInvalidRegex"), { exact: false })
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("group", { name: "Text" })).toBeNull();
  });

  it("shows Indexing… while a rebuild runs, with the results found so far", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "Lookout" }, "local");
    await updateChapterRow(chapter.id, { content: "<p>The harbour light blinked</p>" }, "local");

    // Stall the rebuild inside its first write: the flag stays up while the
    // text search (plain SELECTs) still answers.
    const adapter = authorDb.current as DatabaseAdapter;
    const realExecuteAtomic = adapter.executeAtomic.bind(adapter);
    let releaseRebuild!: () => void;
    const rebuildGate = new Promise<void>((resolve) => {
      releaseRebuild = resolve;
    });
    adapter.executeAtomic = (async (statements) => {
      await rebuildGate;
      return realExecuteAtomic(statements);
    }) as DatabaseAdapter["executeAtomic"];
    const rebuildPromise = requestSearchRebuild();
    try {
      const user = userEvent.setup();
      renderApp("/");
      await settleOn("/");

      const dialog = await openLibrarySearch(user);
      await user.paste("harbour");
      expect(
        await within(dialog).findByText(en("commandPalette.textIndexing"))
      ).toBeInTheDocument();
      expect(await within(dialog).findByRole("group", { name: "Text" })).toBeInTheDocument();
    } finally {
      releaseRebuild();
      await rebuildPromise;
      resetSearchIndexForTests();
      adapter.executeAtomic = realExecuteAtomic;
    }
  });

  it("reruns the Text query when a rebuild ends, with no further keystroke", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "Lookout" }, "local");
    await updateChapterRow(chapter.id, { content: "<p>The harbour light blinked</p>" }, "local");

    // The index answers nothing while the rebuild runs, then the match appears
    // once it ends. Nothing types after the rebuild ends.
    indexBlank.value = true;
    const adapter = authorDb.current as DatabaseAdapter;
    const realExecuteAtomic = adapter.executeAtomic.bind(adapter);
    let releaseRebuild!: () => void;
    const rebuildGate = new Promise<void>((resolve) => {
      releaseRebuild = resolve;
    });
    adapter.executeAtomic = (async (statements) => {
      await rebuildGate;
      return realExecuteAtomic(statements);
    }) as DatabaseAdapter["executeAtomic"];
    const rebuildPromise = requestSearchRebuild();
    try {
      const user = userEvent.setup();
      renderApp("/");
      await settleOn("/");

      const dialog = await openLibrarySearch(user);
      await user.paste("harbour");
      expect(
        await within(dialog).findByText(en("commandPalette.textIndexing"))
      ).toBeInTheDocument();
      expect(within(dialog).queryByRole("group", { name: "Text" })).toBeNull();

      indexBlank.value = false;
      releaseRebuild();
      await rebuildPromise;
      expect(await within(dialog).findByRole("group", { name: "Text" })).toBeInTheDocument();
    } finally {
      indexBlank.value = false;
      releaseRebuild();
      await rebuildPromise;
      resetSearchIndexForTests();
      adapter.executeAtomic = realExecuteAtomic;
    }
  });

  it("ignores a stale scan: el then quickly ela shows only the latest", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const short = await createChapterRow({ bookId: book.id, title: "Gato" }, "local");
    await updateChapterRow(short.id, { content: "<p>el gato duerme</p>" }, "local");
    const long = await createChapterRow({ bookId: book.id, title: "Elastico" }, "local");
    await updateChapterRow(long.id, { content: "<p>material elastico</p>" }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    // "el" scans, so it waits for a pause; "ela" queries at once and drops it.
    await user.keyboard("el");
    await user.keyboard("a");
    expect(search).toHaveValue("ela");

    await within(dialog).findByRole("group", { name: "Text" });
    await waitFor(() => {
      const names = [...textOptionsByName(dialog).keys()];
      expect(names.some((name) => name.includes("Elastico"))).toBe(true);
      expect(names.some((name) => name.includes("Gato"))).toBe(false);
    });
  });

  it("opens a text row on the same item its title row would open", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "Beacon" }, "local");
    await updateChapterRow(chapter.id, { content: "<p>The lighthouse keeper waits</p>" }, "local");
    const user = userEvent.setup();
    renderApp(`/book/${book.id}`);
    await settleOn(`/book/${book.id}`);

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("lighthouse");
    const options = await waitFor(() => {
      const found = sectionOptions(dialog, "Text");
      expect(found).toHaveLength(1);
      return found;
    });
    expect(options[0].getAttribute("aria-label")).toContain("Beacon");
    await arrowToAndChoose(user, dialog, search, options[0]);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(path).toBe(`/book/${book.id}`));
    await waitFor(() => expect(openChapterTitle()).toBe("Beacon"));
    expect(chapter).toBeDefined();
  });
});

describe("Command Palette entry buttons", () => {
  const BUTTON_NAME = en("shortcuts.openCommandPalette");

  /**
   * Every always-visible entry point, outside inert drawers and sheets. The
   * sidebars mount twice (desktop plus the closed mobile drawer), so the
   * inert copy is skipped: only the reachable button counts.
   */
  function visiblePaletteButtons(): HTMLElement[] {
    return screen
      .getAllByRole("button", { name: BUTTON_NAME })
      .filter((button) => button.closest("[inert]") === null);
  }

  /**
   * Tabs from the body until the entry button holds focus; keyboard only.
   * Names only the focused element per Tab: naming every button each turn
   * walked computed styles across the whole app.
   */
  async function tabToEntryButton(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    for (let i = 0; i < 250; i++) {
      const focused = document.activeElement;
      if (
        focused instanceof HTMLButtonElement &&
        focused.closest("[inert]") === null &&
        computeAccessibleName(focused) === BUTTON_NAME
      ) {
        return focused;
      }
      await user.tab();
    }
    throw new Error("the palette entry button never took focus");
  }

  /** Enter opens the palette; Escape closes it and focus returns to the button. */
  async function openFromButton(user: ReturnType<typeof userEvent.setup>, button: HTMLElement) {
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    expect(paletteSearch(dialog)).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    expect(button).toHaveFocus();
  }

  it("opens from the main sidebar footer on / and returns focus to it", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    expect(visiblePaletteButtons()).toHaveLength(1);
    await openFromButton(user, await tabToEntryButton(user));
  });

  it("opens from the Chapter list footer in the Book Editor", async () => {
    const book = await createBookRow({ title: "Footer Book", authorName: "Author" }, "local");
    await createChapterRow({ bookId: book.id, title: "Only Chapter" }, "local");
    const user = userEvent.setup();
    renderApp(`/book/${book.id}`);
    await settleOn(`/book/${book.id}`);

    expect(visiblePaletteButtons()).toHaveLength(1);
    // Focus starts in the Chapter text, where Tab indents instead of moving:
    // Escape leaves for the chapter list first.
    await user.keyboard("{Escape}");
    await openFromButton(user, await tabToEntryButton(user));
  });

  it("keeps the Notes footer and button with zero pinned Notes and no pinned text", async () => {
    useSettingsStore.setState({ notesListView: "list" });
    const note = await createNoteRow({ title: "Solo", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp(`/notes/${note.id}`);
    await waitFor(() => expect(path).toBe(`/notes/${note.id}`));
    await screen.findByRole("row", { name: "Solo" });

    expect(visiblePaletteButtons()).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/\d+ pinned/);
    await openFromButton(user, await tabToEntryButton(user));
  });

  it("shows '1 pinned' in list view with one pinned Note", async () => {
    useSettingsStore.setState({ notesListView: "list" });
    const note = await createNoteRow({ title: "Pinned One", bookId: null, pinned: true }, "local");
    const user = userEvent.setup();
    renderApp(`/notes/${note.id}`);
    await waitFor(() => expect(path).toBe(`/notes/${note.id}`));

    expect(await screen.findByText("1 pinned")).toBeInTheDocument();
    expect(visiblePaletteButtons()).toHaveLength(1);
    await openFromButton(user, await tabToEntryButton(user));
  });

  /**
   * The Layers breakpoint the Cover Designer answers to. The suite polyfill
   * reports every query as not matching, so wide must be stubbed per query.
   */
  function stubLayersMedia(wide: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: wide && query === "(min-width: 768px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }));
  }

  it("opens from the Layers sidebar footer in a wide Cover Designer", async () => {
    stubLayersMedia(true);
    try {
      const book = await createBookRow({ title: "Cover Book", authorName: "Author" }, "local");
      const user = userEvent.setup();
      renderApp(`/book/${book.id}/cover`);
      await settleOn(`/book/${book.id}/cover`);

      // The sidebar (inside main) carries the one button; the toolbar has none.
      const buttons = visiblePaletteButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0].closest("main")).not.toBeNull();
      await openFromButton(user, await tabToEntryButton(user));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders only the toolbar button in a narrow Cover Designer", async () => {
    stubLayersMedia(false);
    try {
      const book = await createBookRow({ title: "Narrow Cover", authorName: "Author" }, "local");
      const user = userEvent.setup();
      renderApp(`/book/${book.id}/cover`);
      await settleOn(`/book/${book.id}/cover`);

      // The sidebar footer stays unrendered; the toolbar carries the one button.
      const buttons = visiblePaletteButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0].closest("main")).toBeNull();
      await openFromButton(user, await tabToEntryButton(user));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens from the last button of the Canvas tool column", async () => {
    const canvas = await createCanvasRow({ title: "Tool Column" }, "local");
    const user = userEvent.setup();
    renderApp(`/canvas/${canvas.id}`);
    await settleOn(`/canvas/${canvas.id}`);

    const buttons = visiblePaletteButtons();
    expect(buttons).toHaveLength(1);
    const entry = buttons[0];
    // The React Aria Toolbar owns arrow-key travel: Tab enters the column,
    // then ArrowDown moves between its buttons. Tab alone must not be used
    // to reach the last button (the toolbar's Tab handler parks focus and
    // remembers a stale button, so a later dialog restore would land there).
    for (let i = 0; i < 250; i++) {
      const focused = document.activeElement as HTMLElement | null;
      if (focused && focused.closest?.('[role="toolbar"]')) break;
      await user.tab();
    }
    expect(document.activeElement?.closest?.('[role="toolbar"]')).not.toBeNull();
    for (let i = 0; i < 20; i++) {
      if (document.activeElement === entry) break;
      await user.keyboard("{ArrowDown}");
    }
    await openFromButton(user, entry);
  });
});
