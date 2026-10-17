// The Notes sidebar's Sort (#524, ADR 0028): a view in both modes, and
// leaving a list Sort keeps the order it showed as the Custom Order.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotesList } from "@/components/notes/NotesList";
import { useSettingsStore } from "@/features/settings/store";
import type { Book } from "@/features/books/types";
import type { Note } from "@/features/notes";
import { runCommand } from "@/lib/command-runner";
import { installPointerEvent } from "@/test/support/pointer-events";

installPointerEvent();

vi.mock("@/lib/park-selection", () => ({ parkInertSelection: () => () => {} }));

vi.mock("../../../../lib/platform", () => ({
  IS_ANDROID: false,
  IS_TAURI: false,
  IS_DESKTOP: false,
  getFileSystem: vi.fn(),
  getOS: vi.fn(async () => ({ locale: vi.fn(async () => "en") })),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { sort?: string }) => {
      const map: Record<string, string> = {
        "notes.title": "Notes",
        "notes.search": "Search notes...",
        "notes.empty": "No notes",
        "notes.viewList": "List",
        "notes.viewTree": "Tree",
        "notes.sectionPinned": "Pinned",
        "notes.sectionAll": "All notes",
        "notes.groupBook": "Book",
        "notes.groupTag": "Tag",
        "notes.groupDate": "Date",
        "notes.unfiled": "Unfiled",
        "notes.reorder": "Reorder",
        "notes.untitled": "Untitled note",
        "notes.sortCustom": "Custom",
        "notes.sortTitleAsc": "A to Z",
        "notes.sortTitleDesc": "Z to A",
        "notes.sortDateNewest": "Newest first",
        "notes.sortDateOldest": "Oldest first",
      };
      if (key === "notes.sortTrigger") return `Sort notes: ${params?.sort}`;
      return map[key] ?? key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

beforeEach(() => {
  useSettingsStore.setState({
    notesListView: "list",
    notesTreeGroupMode: "book",
    notesCollapsedGroups: [],
    notesExpandedEmptyGroups: [],
    notesListSort: "custom",
    notesTreeSort: "custom",
  });
});

function buildNote(overrides: Partial<Note> & { id: string }): Note {
  return {
    title: overrides.id,
    content: "",
    language: "en",
    tags: [],
    pinned: false,
    order: 0,
    wordCount: 0,
    collapsedHeadings: [],
    createdAt: 1,
    updatedAt: 1,
    contentUpdatedAt: overrides.updatedAt ?? 1,
    ...overrides,
  };
}

function buildBook(id: string, title: string): Book {
  const date = new Date("2026-01-01T00:00:00Z");
  return {
    id,
    title,
    authorName: "Author",
    language: "en",
    wordCount: 0,
    status: "draft",
    createdAt: date,
    updatedAt: date,
    contentUpdatedAt: date,
  };
}

function renderList(notes: Note[], overrides: Partial<Parameters<typeof NotesList>[0]> = {}) {
  const props = {
    notes,
    currentNoteId: null,
    onSelectNote: vi.fn(),
    onCreateNote: vi.fn(),
    onReorderNotes: vi.fn(async () => {}),
    ...overrides,
  };
  const view = render(<NotesList {...props} />);
  const rerender = (next: Note[]) => view.rerender(<NotesList {...props} notes={next} />);
  return { props, rerender };
}

/** Note ids in display order, per list section. */
function sectionIds() {
  return Object.fromEntries(
    screen
      .getAllByRole("rowgroup")
      .filter((group) => group.querySelector("[data-testid^='notes-section-']"))
      .map((group) => {
        const id = group
          .querySelector("[data-testid^='notes-section-']")
          ?.getAttribute("data-testid")
          ?.replace("notes-section-", "");
        const ids = [...group.querySelectorAll<HTMLElement>('[role="row"][data-key]')].map(
          (row) => row.dataset.key
        );
        return [id, ids];
      })
  );
}

/** Note ids in display order inside one tree group (its GridList). */
function groupIds(name: string) {
  return [
    ...screen.getByRole("grid", { name }).querySelectorAll<HTMLElement>('[role="row"][data-key]'),
  ].map((row) => row.dataset.key);
}

async function pickSort(user: ReturnType<typeof userEvent.setup>, label: string) {
  const trigger = screen.getByRole("button", { name: /^Sort notes:/ });
  trigger.focus();
  await user.keyboard("{Enter}");
  const listbox = await screen.findByRole("listbox");
  const option = within(listbox).getByRole("option", { name: label });
  await user.keyboard("{Home}");
  for (let i = 0; i < 8 && document.activeElement !== option; i++) {
    await user.keyboard("{ArrowDown}");
  }
  expect(option).toHaveFocus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
}

const pinnedZed = buildNote({ id: "pz", title: "Zed", pinned: true, order: 0, updatedAt: 30 });
const pinnedAnt = buildNote({ id: "pa", title: "Ant", pinned: true, order: 1, updatedAt: 10 });
const restBee = buildNote({ id: "rb", title: "Bee", order: 0, updatedAt: 20 });
const restCat = buildNote({ id: "rc", title: "Cat", order: 1, updatedAt: 40 });
const restAard = buildNote({ id: "ra", title: "Aardvark", order: 2, updatedAt: 5 });
const sample = () => [pinnedZed, pinnedAnt, restBee, restCat, restAard];

describe("NotesList Sort, list view", () => {
  it("starts at Custom, named on the trigger, and shows the Custom Order", () => {
    renderList(sample());

    expect(screen.getByRole("button", { name: "Sort notes: Custom" })).toBeInTheDocument();
    expect(sectionIds()).toEqual({ pinned: ["pz", "pa"], all: ["rb", "rc", "ra"] });
  });

  it("sorts Pinned Notes and the rest separately when a Sort is picked by keyboard", async () => {
    const user = userEvent.setup();
    const { props } = renderList(sample());

    await pickSort(user, "A to Z");
    expect(sectionIds()).toEqual({ pinned: ["pa", "pz"], all: ["ra", "rb", "rc"] });
    expect(screen.getByRole("button", { name: "Sort notes: A to Z" })).toHaveFocus();
    expect(useSettingsStore.getState().notesListSort).toBe("title-asc");

    await pickSort(user, "Newest first");
    expect(sectionIds()).toEqual({ pinned: ["pz", "pa"], all: ["rc", "rb", "ra"] });

    await pickSort(user, "Oldest first");
    expect(sectionIds()).toEqual({ pinned: ["pa", "pz"], all: ["ra", "rb", "rc"] });

    await pickSort(user, "Z to A");
    expect(sectionIds()).toEqual({ pinned: ["pz", "pa"], all: ["rc", "rb", "ra"] });
    expect(props.onReorderNotes).not.toHaveBeenCalled();
  });

  it("closes the menu on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderList(sample());
    const trigger = screen.getByRole("button", { name: "Sort notes: Custom" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(useSettingsStore.getState().notesListSort).toBe("custom");
  });

  it("keeps a Sort holding as Notes are added, renamed, and edited, an untitled one first", () => {
    useSettingsStore.setState({ notesListSort: "title-asc" });
    const { rerender } = renderList([restBee, restCat]);

    const untitled = buildNote({ id: "new", title: "", order: 9 });
    rerender([restBee, restCat, untitled]);
    expect(sectionIds().all).toEqual(["new", "rb", "rc"]);

    rerender([restBee, restCat, { ...untitled, title: "Bison" }]);
    expect(sectionIds().all).toEqual(["rb", "new", "rc"]);

    rerender([{ ...restBee, title: "Yak" }, restCat, { ...untitled, title: "Bison" }]);
    expect(sectionIds().all).toEqual(["new", "rc", "rb"]);

    act(() => useSettingsStore.setState({ notesListSort: "date-desc" }));
    rerender([
      restBee,
      { ...restCat, updatedAt: 1, contentUpdatedAt: 1 },
      { ...untitled, contentUpdatedAt: 99 },
    ]);
    expect(sectionIds().all).toEqual(["new", "rb", "rc"]);
  });

  it("keeps the selected Note selected wherever a Sort moves it", () => {
    useSettingsStore.setState({ notesListSort: "title-asc" });
    const { rerender } = renderList([restBee, restCat], { currentNoteId: "rb" });

    rerender([{ ...restBee, title: "Zebra" }, restCat]);

    expect(sectionIds().all).toEqual(["rc", "rb"]);
    expect(document.querySelector('[role="row"][data-key="rb"]')).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("writes the shown order with the move and turns the Sort to Custom on a drag while sorted", async () => {
    useSettingsStore.setState({ notesListSort: "title-asc" });
    const user = userEvent.setup();
    const { props } = renderList(sample());
    expect(sectionIds().all).toEqual(["ra", "rb", "rc"]);

    const row = document.querySelector<HTMLElement>('[role="row"][data-key="rc"]');
    if (!row) throw new Error("no row");
    row.focus();
    const handle = within(row).getByRole("button", { name: "Reorder" });
    for (let i = 0; i < 8 && document.activeElement !== handle; i++) {
      await user.keyboard("{ArrowRight}");
    }
    expect(handle).toHaveFocus();
    await user.keyboard("{Enter}");
    for (
      let i = 0;
      i < 10 &&
      document.activeElement?.getAttribute("aria-label") !== "Insert between Aardvark and Bee";
      i++
    ) {
      await user.keyboard("{ArrowUp}");
    }
    expect(document.activeElement).toHaveAccessibleName("Insert between Aardvark and Bee");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(props.onReorderNotes).toHaveBeenCalledTimes(1));
    expect(props.onReorderNotes).toHaveBeenCalledWith([
      { id: "pa", pinned: true },
      { id: "pz", pinned: true },
      { id: "ra", pinned: false },
      { id: "rc", pinned: false },
      { id: "rb", pinned: false },
    ]);
    expect(useSettingsStore.getState().notesListSort).toBe("custom");
  });

  it("writes each whole section's sorted order when Custom is picked, even during a search", async () => {
    useSettingsStore.setState({ notesListSort: "title-asc" });
    const user = userEvent.setup();
    const { props } = renderList(sample());

    await user.type(screen.getByPlaceholderText("Search notes..."), "a");
    expect(sectionIds().all).toEqual(["ra", "rc"]);
    await pickSort(user, "Custom");

    expect(props.onReorderNotes).toHaveBeenCalledTimes(1);
    expect(props.onReorderNotes).toHaveBeenCalledWith([
      { id: "pa", pinned: true },
      { id: "pz", pinned: true },
      { id: "ra", pinned: false },
      { id: "rb", pinned: false },
      { id: "rc", pinned: false },
    ]);
    expect(useSettingsStore.getState().notesListSort).toBe("custom");
  });

  it("writes nothing when Custom is picked while already Custom", async () => {
    const user = userEvent.setup();
    const { props } = renderList(sample());

    await pickSort(user, "Custom");

    expect(props.onReorderNotes).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().notesListSort).toBe("custom");
  });

  it("leaves the Sort alone when a Note is pinned or order changes sync in", async () => {
    useSettingsStore.setState({ notesListSort: "title-asc" });
    const user = userEvent.setup();
    const { props, rerender } = renderList(sample());

    const row = document.querySelector<HTMLElement>('[role="row"][data-key="rb"]');
    if (!row) throw new Error("no row");
    await user.pointer({ keys: "[MouseRight]", target: row });
    await user.click(await screen.findByRole("menuitem", { name: "notes.pin" }));
    expect(props.onReorderNotes).toHaveBeenCalledTimes(1);

    rerender([
      { ...restAard, order: 0 },
      { ...restBee, order: 1 },
      { ...restCat, order: 2 },
    ]);

    expect(useSettingsStore.getState().notesListSort).toBe("title-asc");
  });

  it("keeps the Sort menu enabled with no Notes and during a search", async () => {
    const user = userEvent.setup();
    const { rerender } = renderList([]);
    expect(screen.getByRole("button", { name: "Sort notes: Custom" })).toBeEnabled();

    rerender(sample());
    await user.type(screen.getByPlaceholderText("Search notes..."), "zzz");
    await pickSort(user, "Z to A");
    expect(useSettingsStore.getState().notesListSort).toBe("title-desc");
  });
});

describe("NotesList Sort, tree view", () => {
  const march = (day: number) => Date.parse(`2025-03-0${day}T12:00:00Z`) / 1000;
  const bookA = buildBook("book-a", "Book A");
  const bookB = buildBook("book-b", "Book B");
  const treeNotes = () => [
    buildNote({
      id: "b2",
      title: "Bravo",
      bookId: "book-b",
      order: 0,
      tags: ["t"],
      updatedAt: march(1),
    }),
    buildNote({
      id: "b1",
      title: "Alpha",
      bookId: "book-b",
      order: 1,
      tags: ["t"],
      updatedAt: march(2),
    }),
    buildNote({ id: "a1", title: "Ant", bookId: "book-a", order: 2, updatedAt: march(3) }),
  ];

  it("sorts inside each group of every grouping, keeps the groups' order, and never writes", async () => {
    useSettingsStore.setState({ notesListView: "tree" });
    const user = userEvent.setup();
    const { props } = renderList(treeNotes(), { books: [bookB, bookA] });
    expect(groupIds("Book B")).toEqual(["b2", "b1"]);

    await pickSort(user, "A to Z");
    expect(groupIds("Book B")).toEqual(["b1", "b2"]);
    expect(
      [...document.querySelectorAll("[data-testid^='book-group-']")].map((group) =>
        group.getAttribute("data-testid")
      )
    ).toEqual(["book-group-book-b", "book-group-book-a", "book-group-unfiled"]);

    act(() => useSettingsStore.setState({ notesTreeGroupMode: "tag" }));
    expect(groupIds("t")).toEqual(["b1", "b2"]);

    act(() => useSettingsStore.setState({ notesTreeGroupMode: "date" }));
    await pickSort(user, "Oldest first");
    expect(groupIds("2025")).toEqual(["b2", "b1", "a1"]);
    await pickSort(user, "Custom");
    expect(groupIds("2025")).toEqual(["b2", "b1", "a1"]);
    await pickSort(user, "Newest first");
    expect(groupIds("2025")).toEqual(["a1", "b1", "b2"]);

    expect(props.onReorderNotes).not.toHaveBeenCalled();
  });

  it("keeps the list and tree Sorts independent", async () => {
    const user = userEvent.setup();
    renderList(treeNotes(), { books: [bookB, bookA] });

    await pickSort(user, "Z to A");
    act(() => useSettingsStore.setState({ notesListView: "tree" }));
    expect(screen.getByRole("button", { name: "Sort notes: Custom" })).toBeInTheDocument();
    await pickSort(user, "A to Z");

    expect(useSettingsStore.getState()).toMatchObject({
      notesListSort: "title-desc",
      notesTreeSort: "title-asc",
    });
  });
});

describe("NotesList Sort Commands", () => {
  it("sets the Sort of the view mode that is showing", async () => {
    const { props } = renderList(sample());

    expect(await runCommand("notes.sortTitleAsc", { source: "palette" })).toBe("ran");
    expect(sectionIds().all).toEqual(["ra", "rb", "rc"]);
    expect(useSettingsStore.getState().notesListSort).toBe("title-asc");

    act(() => useSettingsStore.setState({ notesListView: "tree" }));
    expect(await runCommand("notes.sortDateNewest", { source: "voice" })).toBe("ran");
    expect(await runCommand("notes.sortDateOldest", { source: "voice" })).toBe("ran");
    expect(await runCommand("notes.sortTitleDesc", { source: "voice" })).toBe("ran");
    expect(useSettingsStore.getState()).toMatchObject({
      notesListSort: "title-asc",
      notesTreeSort: "title-desc",
    });
    expect(props.onReorderNotes).not.toHaveBeenCalled();
  });

  it("leaves a list Sort through the Custom Command, keeping its order", async () => {
    useSettingsStore.setState({ notesListSort: "date-desc" });
    const { props } = renderList(sample());

    expect(await runCommand("notes.sortCustom", { source: "voice" })).toBe("ran");

    expect(props.onReorderNotes).toHaveBeenCalledWith([
      { id: "pz", pinned: true },
      { id: "pa", pinned: true },
      { id: "rc", pinned: false },
      { id: "rb", pinned: false },
      { id: "ra", pinned: false },
    ]);
    expect(useSettingsStore.getState().notesListSort).toBe("custom");
  });
});
