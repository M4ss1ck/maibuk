import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTE_ROW_ESTIMATE, NotesList } from "@/components/notes/NotesList";
import { DEFAULT_NOTES_FILTERS } from "@/components/notes/notes-list-model";
import type { Book } from "@/features/books/types";
import type { Note } from "@/features/notes";
import { useSettingsStore } from "@/features/settings/store";
import { runCommand } from "@/lib/command-runner";
import { installPointerEvent } from "@/test/support/pointer-events";
import { mockVirtualizer } from "@/test/support/virtualizer-layout";

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
    t: (key: string, params?: { count?: number; tag?: string }) => {
      const map: Record<string, string> = {
        "notes.title": "Notes",
        "notes.newNote": "New note",
        "notes.search": "Search notes...",
        "notes.empty": "No notes",
        "notes.noMatches": "No notes match",
        "notes.noMatchesDescription":
          "Adjust the search or filters to bring more notes back into view.",
        "notes.advancedFilters": "Filters",
        "notes.clearFilters": "Clear filters",
        "notes.viewList": "List",
        "notes.viewTree": "Tree",
        "notes.sectionPinned": "Pinned",
        "notes.sectionAll": "All notes",
        "notes.group": "Group",
        "notes.groupBook": "Book",
        "notes.groupTag": "Tag",
        "notes.groupDate": "Date",
        "notes.unfiled": "Unfiled",
        "notes.noNotesYet": "No notes yet",
        "notes.addNoteToBook": "Add note",
        "notes.today": "Today",
        "notes.thisWeek": "This week",
        "notes.reorder": "Reorder",
        "notes.untitled": "Untitled note",
        "notes.anyTag": "Any tag",
        "notes.noExcludedTags": "No excluded tags",
        "notes.tagFilter": "Tag",
        "notes.tagFilterHelp": "Shows only notes that have all of these tags",
        "notes.excludeTagFilter": "Exclude tags",
        "notes.excludeTagFilterHelp": "Hides notes that have any of these tags",
        "notes.dateFrom": "Updated from",
        "notes.dateTo": "Updated to",
        "notes.clearDate": "Clear date",
        "notes.previousMonth": "Previous month",
        "notes.nextMonth": "Next month",
      };

      if (key === "notes.noteCount") return `${params?.count ?? 0} notes`;
      if (key === "notes.pinnedCount") return `${params?.count ?? 0} pinned`;
      if (key === "notes.filtersActive") return `Filters, ${params?.count ?? 0} active`;
      if (key === "notes.removeTag") return `Remove ${params?.tag}`;
      if (key === "notes.removeExcludedTag") return `Stop excluding ${params?.tag}`;
      return map[key] ?? key;
    },
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

let restoreVirtualizer: () => void = () => {};
beforeAll(() => {
  restoreVirtualizer = mockVirtualizer({ rowHeight: NOTE_ROW_ESTIMATE });
});
afterAll(() => restoreVirtualizer());

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
    contentUpdatedAt: 1,
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

function setFilters(filters: Partial<typeof DEFAULT_NOTES_FILTERS>) {
  act(() => useSettingsStore.setState({ notesFilters: { ...DEFAULT_NOTES_FILTERS, ...filters } }));
}

const notes = [
  buildNote({ id: "a", title: "Alpha", tags: ["task"] }),
  buildNote({ id: "b", title: "Bravo", tags: ["draft"] }),
];

function renderList(overrides: Partial<Parameters<typeof NotesList>[0]> = {}) {
  return render(
    <NotesList
      notes={notes}
      currentNoteId={null}
      onSelectNote={vi.fn()}
      onCreateNote={vi.fn()}
      onReorderNotes={vi.fn()}
      {...overrides}
    />
  );
}

describe("NotesList Note Filter", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      notesListView: "list",
      notesTreeGroupMode: "book",
      notesCollapsedGroups: [],
      notesExpandedEmptyGroups: [],
      notesFilters: DEFAULT_NOTES_FILTERS,
    });
  });

  it("excluding a Tag hides its Notes in the list and the tree", () => {
    setFilters({ excludeTags: ["task"] });
    renderList();

    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
  });

  it("applies a Note Filter the store already holds before render", () => {
    setFilters({ tags: ["task"] });
    renderList();

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Bravo")).not.toBeInTheDocument();
  });

  it("turns reordering off while the Note Filter hides Notes", () => {
    setFilters({ excludeTags: ["task"] });
    renderList();

    expect(screen.queryByRole("button", { name: "Reorder" })).not.toBeInTheDocument();
    const row = screen.getByText("Bravo").closest("[data-note-row]");
    expect(row).not.toBeNull();
    expect(row).not.toHaveAttribute("draggable");
  });

  it("leaves out Book groups with no matching Notes in tree-by-Book view", () => {
    useSettingsStore.setState({ notesListView: "tree", notesTreeGroupMode: "book" });
    setFilters({ excludeTags: ["task"] });
    const books = [buildBook("book-a", "Novel"), buildBook("book-b", "Empty Book")];
    const filed = [
      { ...buildNote({ id: "a", title: "Alpha", tags: ["task"] }), bookId: "book-a" },
      { ...buildNote({ id: "b", title: "Bravo", tags: ["draft"] }), bookId: "book-b" },
    ];
    renderList({ notes: filed, books });

    // Alpha is filtered out, so its Book group goes and the one with notes stays.
    expect(screen.queryByTestId("book-group-book-a")).not.toBeInTheDocument();
    expect(screen.getByTestId("book-group-book-b")).toBeInTheDocument();
    expect(screen.queryByTestId("book-group-unfiled")).not.toBeInTheDocument();
  });

  it("shows the no-matches state whose Clear filters empties the filter and the search", () => {
    renderList();
    fireEvent.change(screen.getByPlaceholderText("Search notes..."), {
      target: { value: "bravo" },
    });
    setFilters({ tags: ["task"] });

    expect(screen.getByText("No notes match")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(useSettingsStore.getState().notesFilters).toEqual(DEFAULT_NOTES_FILTERS);
    expect(screen.getByPlaceholderText("Search notes...")).toHaveValue("");
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("opens the Popover from the notes.advancedFilters Command", async () => {
    renderList();

    expect(await runCommand("notes.advancedFilters", { source: "palette" })).toBe("ran");

    await waitFor(() => expect(screen.getByPlaceholderText("Any tag")).toHaveFocus());
  });

  it("clears the Note Filter and the sidebar search from the notes.clearFilters Command", async () => {
    renderList();
    fireEvent.change(screen.getByPlaceholderText("Search notes..."), {
      target: { value: "alpha" },
    });
    setFilters({ tags: ["task"] });

    expect(await runCommand("notes.clearFilters", { source: "palette" })).toBe("ran");

    expect(useSettingsStore.getState().notesFilters).toEqual(DEFAULT_NOTES_FILTERS);
    expect(screen.getByPlaceholderText("Search notes...")).toHaveValue("");
  });
});
