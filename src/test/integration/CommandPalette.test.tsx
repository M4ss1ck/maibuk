// One part of the Command Palette tests, split for #851: the Command Palette describe block.
// The support module registers the mocks, so it is imported first.
import {
  COMMANDS_PREFIX,
  PALETTE_NAME,
  activeResultLabel,
  arrowToAndChoose,
  createBookRow,
  createChapterRow,
  createNoteRow,
  defaultWholeLinePhrases,
  en,
  lastFocusedEditor,
  librarySwitch,
  openLibrarySearch,
  openPaletteWithF1,
  paletteSearch,
  path,
  renderApp,
  runCommand,
  sectionOptions,
  settleOn,
  updateChapterRow,
  useBoundShortcutStore,
  useCommandPaletteRecentStore,
  useDictationStore,
  useNoteStore,
  web,
} from "@/test/support/command-palette";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { deferAnimationFrames } from "@/test/support/animation-frame";

describe("Command Palette", () => {
  it("opens with F1 with focus in the search field, in Commands mode", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openPaletteWithF1(user);
    const search = paletteSearch(dialog);
    expect(search).toHaveFocus();
    // F1 is the Commands shortcut: the prefix is already typed, so the field
    // starts half-written and one Backspace reaches Library Search.
    expect(search).toHaveValue(COMMANDS_PREFIX);
  });

  it("opens Commands mode with Mod+Shift+P on desktop", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("{Control>}{Shift>}p{/Shift}{/Control}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    expect(paletteSearch(dialog)).toHaveFocus();
    expect(paletteSearch(dialog)).toHaveValue(COMMANDS_PREFIX);
  });

  it("opens Commands mode with > typed when its Voice Command runs", async () => {
    renderApp("/");
    await settleOn("/");
    // The Command answers to its label in the Dictation Language (ADR 0016);
    // the phrase is what a speaker says, before the interpreter hands it over.
    expect(defaultWholeLinePhrases("global.openCommandPalette", "en")).toContain(
      "Open command palette"
    );

    await act(async () => {
      expect(await runCommand("global.openCommandPalette", { source: "voice" })).toBe("ran");
    });

    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    expect(paletteSearch(dialog)).toHaveFocus();
    expect(paletteSearch(dialog)).toHaveValue(COMMANDS_PREFIX);
  });

  it("opens Library Search empty with Mod+Alt+P", async () => {
    await createBookRow({ title: "Shortcut Book", authorName: "Author" }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");
    expect(useBoundShortcutStore.getState().counts["global.searchLibrary"]).toBeGreaterThan(0);

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    expect(search).toHaveFocus();
    expect(search).toHaveValue("");

    // No prefix means Library Search: typing a Book title finds it.
    await user.keyboard("Shortcut");
    await within(dialog).findByRole("option", { name: "Shortcut Book" });
  });

  it("lists the Search Library Command in Commands mode", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openPaletteWithF1(user);
    await user.keyboard("Search Library");
    expect(await within(dialog).findByRole("option", { name: "Search Library" })).toBeVisible();
  });

  it("answers to F1 only on the web build", async () => {
    web.value = true;
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("{Control>}{Shift>}p{/Shift}{/Control}");
    // Ordering witness: "?" opens the shortcuts dialog through the same key
    // handler, after the ignored shortcut. Its dialog proves that keystroke ran.
    await user.keyboard("?");
    await screen.findByRole("dialog", { name: en("shortcuts.title") });
    expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: en("shortcuts.title") })).toBeNull()
    );

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    expect(paletteSearch(dialog)).toHaveFocus();
  });

  it("Escape closes and returns focus to the opener", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const trigger = screen.getByRole("button", { name: en("books.noBooksButton") });
    trigger.focus();
    await openPaletteWithF1(user);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("Escape once with a query closes and returns focus to the opener", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const trigger = screen.getByRole("button", { name: en("books.noBooksButton") });
    trigger.focus();
    const dialog = await openPaletteWithF1(user);
    const search = paletteSearch(dialog);
    await user.keyboard("dark");
    expect(search).not.toHaveValue("");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("keeps Tab inside the dialog", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    for (let i = 0; i < 10; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 10; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("lists the theme Commands for 'theme' and moves the active result with arrows", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    const search = paletteSearch(dialog);
    await user.keyboard("theme");

    await waitFor(() => expect(within(dialog).getAllByRole("option").length).toBeGreaterThan(0));
    const names = within(dialog)
      .getAllByRole("option")
      .map((option) => option.textContent ?? "");
    for (const label of ["Cycle theme", "Light", "Dark", "System"]) {
      expect(names.some((name) => name.includes(label))).toBe(true);
    }
    expect(document.activeElement).toBe(search);

    // Autocomplete moves the active descendant 500 ms after typing forward, so
    // a screen reader finishes announcing the typed letter first.
    const activeOption = () => search.getAttribute("aria-activedescendant");
    await waitFor(() => expect(activeOption()).toContain("command:global.toggleTheme"));
    const first = activeOption();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(activeOption()).not.toBe(first));
    expect(activeOption()).toContain("command:global.themeDark");
    expect(document.activeElement).toBe(search);
  });

  it("runs Dark from the palette, applies the theme, closes, and remembers it", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    const search = paletteSearch(dialog);
    await user.keyboard("dark");
    const dark = await within(dialog).findByRole("option", { name: "Dark" });
    await arrowToAndChoose(user, dialog, search, dark);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(useCommandPaletteRecentStore.getState().keys).toEqual(["command:global.themeDark"]);

    // Reopening with an empty query lists the Recent Command first, then
    // Suggested; no search result section.
    await user.keyboard("{F1}");
    const reopened = await screen.findByRole("dialog", { name: PALETTE_NAME });
    const options = sectionOptions(reopened, "Recent");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Dark");
    expect(within(reopened).queryByText("Commands")).toBeNull();
  });

  it("lists Dark on a Book page and running it applies dark", async () => {
    const book = await createBookRow({ title: "Themed", authorName: "Author" }, "local");
    const user = userEvent.setup();
    renderApp(`/book/${book.id}`);
    await settleOn(`/book/${book.id}`);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    const search = paletteSearch(dialog);
    await user.keyboard("dark");
    const dark = await within(dialog).findByRole("option", { name: "Dark" });
    await arrowToAndChoose(user, dialog, search, dark);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("reaches a disabled Command by arrows, announces it disabled, and Enter does nothing", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");
    // Dictation switched off on this device: its toggle stays bound but disabled.
    act(() => useDictationStore.setState({ enabled: false }));

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    const search = paletteSearch(dialog);
    await user.keyboard("dictation");
    const toggle = await within(dialog).findByRole("option", {
      name: "Start or stop dictation",
    });

    // The active descendant follows typing after Autocomplete's 500 ms delay.
    const isActive = () => {
      const id = search.getAttribute("aria-activedescendant");
      return id !== null && document.getElementById(id) === toggle;
    };
    await waitFor(() => {
      const id = search.getAttribute("aria-activedescendant");
      const options = within(dialog).getAllByRole("option");
      expect(options.some((option) => option.id === id)).toBe(true);
    });
    for (let i = 0; i < 5 && !isActive(); i++) {
      const before = search.getAttribute("aria-activedescendant");
      await user.keyboard("{ArrowDown}");
      await waitFor(() => expect(search.getAttribute("aria-activedescendant")).not.toBe(before));
    }
    const activeId = search.getAttribute("aria-activedescendant");
    expect(activeId).not.toBeNull();
    expect(document.getElementById(activeId as string)).toBe(toggle);
    expect(toggle).toHaveAttribute("aria-disabled", "true");

    await user.keyboard("{Enter}");
    // Ordering witness: a typed character reaches the search only while the
    // palette is still open, so the value changing proves Enter was handled first.
    const searchBefore = (paletteSearch(dialog) as HTMLInputElement).value;
    await user.keyboard("q");
    await waitFor(() => expect(paletteSearch(dialog)).toHaveValue(`${searchBefore}q`));
    expect(screen.getByRole("dialog", { name: PALETTE_NAME })).toBeInTheDocument();
    expect(screen.queryByText(en("commandPalette.unavailable"))).toBeNull();
  });

  it("hides Commands from other screens", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    await user.paste("save version");

    // A Command bound only in the Book Editor is not offered on the Library.
    await within(dialog).findAllByRole("option");
    expect(within(dialog).queryByRole("option", { name: "Save version" })).toBeNull();
    // Everything offered here is a Settings row, never a Command.
    for (const option of within(dialog).getAllByRole("option")) {
      expect(option.getAttribute("data-key")).toContain("settingsRow:");
    }
  });

  it("lists a Note Item Command only with focus in the note, and runs it on that note", async () => {
    const note = await createNoteRow({ title: "Alpha", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp("/notes");
    await settleOn("/notes");

    const card = await screen.findByRole("row", { name: "Alpha" });
    act(() => {
      card.focus();
    });
    await openPaletteWithF1(user);
    const dialog = screen.getByRole("dialog", { name: PALETTE_NAME });
    const search = paletteSearch(dialog);
    await user.keyboard("duplicate");
    const duplicate = await within(dialog).findByRole("option", { name: "Duplicate note" });
    await arrowToAndChoose(user, dialog, search, duplicate);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(useNoteStore.getState().notes).toHaveLength(2));
    expect(useNoteStore.getState().notes.some((entry) => entry.title === "Alpha (copy)")).toBe(
      true
    );
    expect(note).toBeDefined();
  });

  it("leaves Note Item Commands out when the palette opens from the search field", async () => {
    await createNoteRow({ title: "Alpha", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp("/notes");
    await settleOn("/notes");

    screen.getByPlaceholderText("Search notes...").focus();
    await openPaletteWithF1(user);
    const dialog = screen.getByRole("dialog", { name: PALETTE_NAME });
    await user.paste("duplicate");

    // Settings rows still answer "duplicate", but the Note Item Command does not.
    await within(dialog).findAllByRole("option");
    expect(within(dialog).queryByRole("option", { name: "Duplicate note" })).toBeNull();
  });

  it("toasts when the Command is gone by the time it runs", async () => {
    const note = await createNoteRow({ title: "Beta", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp("/notes");
    await settleOn("/notes");

    const card = await screen.findByRole("row", { name: "Beta" });
    act(() => {
      card.focus();
    });
    await openPaletteWithF1(user);
    const dialog = screen.getByRole("dialog", { name: PALETTE_NAME });
    await user.keyboard("duplicate");
    await within(dialog).findByRole("option", { name: "Duplicate note" });

    await useNoteStore.getState().deleteNote(note.id);
    await waitFor(() => expect(screen.queryByText("Beta")).toBeNull());

    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await screen.findByText("That command is not available here anymore");
  });

  it("refuses to open during a Tutorial run", async () => {
    librarySwitch.setTutorialRunInProgress(true);
    try {
      const user = userEvent.setup();
      renderApp("/");
      await settleOn("/");

      await user.keyboard("{F1}");
      // Ordering witness: "?" opens the shortcuts dialog after the refused F1.
      await user.keyboard("?");
      await screen.findByRole("dialog", { name: en("shortcuts.title") });
      expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull();
    } finally {
      librarySwitch.resetLibrarySwitchForTests();
    }
  });

  it("stays closed while another dialog is open", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("?");
    await screen.findByRole("dialog", { name: en("shortcuts.title") });
    await user.keyboard("{F1}");
    // Ordering witness: Escape closes the top dialog. If F1 had opened the
    // palette above the shortcuts dialog, Escape would close only the palette
    // and the shortcuts dialog would stay open.
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: en("shortcuts.title") })).toBeNull()
    );
    expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull();
  });

  it("is absent on the embed route", async () => {
    const user = userEvent.setup();
    renderApp("/embed");
    await waitFor(() => expect(path).toBe("/embed"));

    // The embed route mounts no global shortcuts, so the witness is the Editor:
    // a character typed into it lands only if F1 did not move focus to a palette.
    const editor = await screen.findByRole("textbox");
    await user.click(editor);
    await user.keyboard("{F1}");
    await user.keyboard("x");
    await waitFor(() => expect(editor).toHaveTextContent("x"));
    expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull();
  });

  it("removes Recent rows with Shift+Delete and the X button, announcing each removal", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    // Two runs: the most recent run lists first.
    await user.keyboard("{F1}");
    let dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    let search = paletteSearch(dialog);
    await user.keyboard("dark");
    const dark = await within(dialog).findByRole("option", { name: "Dark" });
    await arrowToAndChoose(user, dialog, search, dark);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());

    await user.keyboard("{F1}");
    dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    search = paletteSearch(dialog);
    await user.keyboard("light");
    const light = await within(dialog).findByRole("option", { name: "Light" });
    await arrowToAndChoose(user, dialog, search, light);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());

    await user.keyboard("{F1}");
    dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    search = paletteSearch(dialog);
    let options = sectionOptions(dialog, "Recent");
    expect(options.map((option) => option.textContent)).toEqual(["Light", "Dark"]);

    await user.keyboard("{ArrowDown}");
    const removed = activeResultLabel(search);
    expect(["Light", "Dark"]).toContain(removed);
    const survivor = removed === "Light" ? "Dark" : "Light";

    await user.keyboard("{Shift>}{Delete}{/Shift}");
    await within(dialog).findByText("Removed from recent");
    await waitFor(() => expect(sectionOptions(dialog, "Recent")).toHaveLength(1));
    options = sectionOptions(dialog, "Recent");
    expect(options[0]).toHaveTextContent(survivor);
    // The highlight moved to the row that survived.
    await waitFor(() => expect(activeResultLabel(search)).toContain(survivor));

    await user.click(
      within(dialog).getByRole("button", { name: `Remove ${survivor} from recent` })
    );
    await waitFor(() => expect(within(dialog).queryByRole("group", { name: "Recent" })).toBeNull());
    // With Recent empty the palette still lists something to choose.
    expect(sectionOptions(dialog, "Suggested").length).toBeGreaterThan(0);
    expect(useCommandPaletteRecentStore.getState().keys).toEqual([]);
  });

  it("prunes Recent keys that are no longer listed", async () => {
    useCommandPaletteRecentStore.setState({
      keys: ["command:global.themeDark", "command:noteItem.duplicate"],
    });
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("{F1}");
    await screen.findByRole("dialog", { name: PALETTE_NAME });
    await waitFor(() =>
      expect(useCommandPaletteRecentStore.getState().keys).toEqual(["command:global.themeDark"])
    );
  });

  it("binds removeRecent while open and the opener on /", async () => {
    useCommandPaletteRecentStore.setState({ keys: ["command:global.themeDark"] });

    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");
    expect(useBoundShortcutStore.getState().counts["global.openCommandPalette"]).toBeGreaterThan(0);

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    paletteSearch(dialog);
    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(
        useBoundShortcutStore.getState().counts["commandPalette.removeRecent"]
      ).toBeGreaterThan(0)
    );
  });

  it("runs Bold from the palette on the chapter selection and returns focus to the editor", async () => {
    deferAnimationFrames();
    try {
      const book = await createBookRow({ title: "Format", authorName: "Author" }, "local");
      const chapter = await createChapterRow({ bookId: book.id, title: "Chapter" }, "local");
      await updateChapterRow(chapter.id, { content: "<p>Hello world</p>" }, "local");

      const user = userEvent.setup();
      renderApp(`/book/${book.id}`);
      await settleOn(`/book/${book.id}`);

      const editorDom = await waitFor(() => {
        const element = document.querySelector(
          '[data-focus-pane="editor-main"] .tiptap'
        ) as HTMLElement | null;
        expect(element).not.toBeNull();
        return element as HTMLElement;
      });
      act(() => {
        editorDom.focus();
      });
      const editor = lastFocusedEditor();
      expect(editor).not.toBeNull();
      act(() => {
        editor?.commands.setTextSelection({ from: 7, to: 12 });
      });

      await user.keyboard("{F1}");
      const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
      const search = paletteSearch(dialog);
      await user.keyboard("bold");
      const bold = await within(dialog).findByRole("option", { name: "Bold" });
      await arrowToAndChoose(user, dialog, search, bold);

      await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
      await waitFor(() => expect(editor?.getHTML()).toContain("<strong>world</strong>"));
      expect(editor?.view.dom.contains(document.activeElement)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
