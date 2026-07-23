import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesList } from "@/components/notes/NotesList";
import { useSettingsStore } from "@/features/settings/store";
import type { Book } from "@/features/books/types";
import type { Note } from "@/features/notes";

vi.mock("../../../../lib/platform", () => ({
  IS_ANDROID: false,
  IS_TAURI: false,
  IS_DESKTOP: false,
  getFileSystem: vi.fn(),
  getOS: vi.fn(async () => ({ locale: vi.fn(async () => "en") })),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number }) => {
      const map: Record<string, string> = {
        "notes.title": "Notes",
        "notes.newNote": "New note",
        "notes.search": "Search notes...",
        "notes.empty": "No notes",
        "notes.pin": "Pin",
        "notes.unpin": "Unpin",
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
      };

      if (key === "notes.noteCount") return `${params?.count ?? 0} notes`;
      if (key === "notes.pinnedCount") return `${params?.count ?? 0} pinned`;

      return map[key] ?? key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

beforeEach(() => {
  // The view/group toggles persist via the settings store; reset to defaults
  // so tree-mode tests don't leak state into later list-mode tests.
  useSettingsStore.setState({
    notesListView: "list",
    notesTreeGroupMode: "book",
    notesCollapsedGroups: [],
    notesExpandedEmptyGroups: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function buildNote(overrides: Partial<Note>): Note {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? "",
    content: overrides.content ?? "",
    language: overrides.language ?? "en",
    tags: overrides.tags ?? [],
    pinned: overrides.pinned ?? false,
    order: overrides.order ?? 0,
    wordCount: overrides.wordCount ?? 0,
    collapsedHeadings: overrides.collapsedHeadings ?? [],
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    contentUpdatedAt: overrides.contentUpdatedAt ?? overrides.updatedAt ?? 1,
  };
}

function buildBook(overrides: Partial<Book>): Book {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? "Book",
    authorName: overrides.authorName ?? "Author",
    language: overrides.language ?? "en",
    wordCount: overrides.wordCount ?? 0,
    status: overrides.status ?? "draft",
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-01-01T00:00:00Z"),
  };
}

function setRowRect(row: Element, rect: Pick<DOMRect, "top" | "bottom" | "height">) {
  row.getBoundingClientRect = () =>
    ({
      top: rect.top,
      bottom: rect.bottom,
      left: 0,
      right: 100,
      width: 100,
      height: rect.height,
      x: 0,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function dragOverAt(target: Element, dataTransfer: DataTransfer, clientY: number) {
  const event = createEvent.dragOver(target, { dataTransfer });
  Object.defineProperty(event, "clientY", { value: clientY });
  fireEvent(target, event);
}

function dropAt(target: Element, dataTransfer: DataTransfer, clientY: number) {
  const event = createEvent.drop(target, { dataTransfer });
  Object.defineProperties(event, {
    clientX: { value: 5 },
    clientY: { value: clientY },
  });
  fireEvent(target, event);
}

describe("NotesList", () => {
  it("navigates and activates note rows with the same arrow-key behavior as chapters", async () => {
    const user = userEvent.setup();
    const onSelectNote = vi.fn();
    const notes = [
      buildNote({ id: "a", title: "Alpha", pinned: true }),
      buildNote({ id: "b", title: "Bravo" }),
    ];
    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={onSelectNote}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
      />
    );

    const rows = screen.getAllByRole("row").filter((row) => row.hasAttribute("data-key"));
    rows[0].focus();
    expect(rows[0]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(rows[1]).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onSelectNote).toHaveBeenCalledWith(notes[1]);
  });
  it("renders list and tree view toggle in the title bar", () => {
    const onCreateNote = vi.fn();

    render(
      <NotesList
        notes={[]}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={onCreateNote}
        onReorderNotes={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "List" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tree" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New note" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tree" }).querySelector(".lucide-folder-tree")
    ).not.toBeNull();
    expect(screen.getByTestId("notes-view-label-list")).not.toHaveClass("sr-only");
    expect(screen.getByTestId("notes-view-label-tree")).not.toHaveClass("sr-only");

    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    expect(onCreateNote).toHaveBeenCalledWith(null);
  });

  it("renders pinned and all-notes sections with a pinned footer count", () => {
    const notes = [
      buildNote({ id: "a", title: "Pinned A", pinned: true }),
      buildNote({ id: "b", title: "Pinned B", pinned: true }),
      buildNote({ id: "c", title: "Regular" }),
    ];

    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
      />
    );

    expect(screen.getByText("Pinned")).toBeInTheDocument();
    expect(screen.getByText("All notes")).toBeInTheDocument();
    expect(screen.getByText("2 pinned")).toBeInTheDocument();
  });

  it("does not render row-level pin controls in list mode", () => {
    const notes = [
      buildNote({ id: "a", title: "Pinned A", pinned: true }),
      buildNote({ id: "b", title: "Regular" }),
    ];

    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Pin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpin" })).not.toBeInTheDocument();
  });

  it("switches to tree mode and renders book groups with empty books and unfiled last", () => {
    const onCreateNote = vi.fn();
    const books = [
      buildBook({ id: "book-a", title: "Novel" }),
      buildBook({ id: "book-b", title: "Empty Book" }),
    ];
    const notes = [
      buildNote({ id: "a", title: "Novel note" }) as Note & { bookId: string },
      buildNote({ id: "b", title: "Loose note" }),
    ];
    notes[0].bookId = "book-a";

    render(
      <NotesList
        notes={notes}
        books={books}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={onCreateNote}
        onReorderNotes={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    expect(screen.getByText("Group")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Book" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("notes-group-label-book")).not.toHaveClass(
      "@max-[340px]/notes-sidebar:sr-only"
    );
    expect(screen.getByTestId("notes-group-label-tag")).not.toHaveClass(
      "@max-[340px]/notes-sidebar:sr-only"
    );
    expect(screen.getByTestId("notes-group-label-date")).not.toHaveClass(
      "@max-[340px]/notes-sidebar:sr-only"
    );
    expect(screen.getByText("Novel")).toBeInTheDocument();
    expect(screen.getByText("Novel note")).toBeInTheDocument();
    expect(screen.getByText("Empty Book")).toBeInTheDocument();
    expect(screen.getByText("Unfiled")).toBeInTheDocument();
    expect(screen.getByText("Loose note")).toBeInTheDocument();
    expect(
      screen.getByText("Unfiled").closest("div")?.querySelector(".lucide-feather")
    ).not.toBeNull();
    expect(screen.getByTestId("book-title-action-book-a")).toHaveTextContent("Novel");
    expect(
      screen.getByTestId("book-title-action-book-a").querySelector('button[aria-label="Add note"]')
    ).not.toBeNull();
    expect(screen.getByTestId("book-count-book-a")).toHaveTextContent("1");

    fireEvent.click(screen.getAllByRole("button", { name: "Add note" })[0]);
    expect(onCreateNote).toHaveBeenCalledWith("book-a");
  });

  it("renames a note inline from the book-tree view", () => {
    const onRenameNote = vi.fn();
    const books = [buildBook({ id: "book-a", title: "Novel" })];
    const notes = [buildNote({ id: "a", title: "Novel note" }) as Note & { bookId: string }];
    notes[0].bookId = "book-a";

    render(
      <NotesList
        notes={notes}
        books={books}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
        onRenameNote={onRenameNote}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    fireEvent.click(screen.getByRole("button", { name: "common.edit" }));

    const input = screen.getByDisplayValue("Novel note");
    fireEvent.change(input, { target: { value: "Renamed note" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRenameNote).toHaveBeenCalledWith("a", "Renamed note");
  });

  it("collapses toggle labels independently when each group's measured labels do not fit", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement
    ) {
      const testId = this.getAttribute("data-testid");

      if (testId === "notes-view-toggle-group") return 190;
      if (testId === "notes-group-toggle-group") return 150;

      return 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
      this: HTMLElement
    ) {
      const testId = this.getAttribute("data-testid");

      if (testId === "notes-view-toggle-measure") return 140;
      if (testId === "notes-group-toggle-measure") return 210;

      return 0;
    });

    render(
      <NotesList
        notes={[buildNote({ id: "a", title: "Novel note" })]}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("notes-view-toggle-group")).toHaveAttribute(
        "data-label-mode",
        "full"
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    await waitFor(() => {
      expect(screen.getByTestId("notes-group-toggle-group")).toHaveAttribute(
        "data-label-mode",
        "icon"
      );
    });

    expect(screen.getByTestId("notes-view-label-list")).not.toHaveClass("sr-only");
    expect(screen.getByTestId("notes-view-label-tree")).not.toHaveClass("sr-only");
    expect(screen.getByTestId("notes-group-label-book")).toHaveClass("sr-only");
    expect(screen.getByTestId("notes-group-label-tag")).toHaveClass("sr-only");
    expect(screen.getByTestId("notes-group-label-date")).toHaveClass("sr-only");
  });

  it("shows empty book groups in tree mode when there are no notes", () => {
    render(
      <NotesList
        notes={[]}
        books={[buildBook({ id: "book-a", title: "Empty Book" })]}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    expect(screen.getByText("Empty Book")).toBeInTheDocument();
    expect(screen.getAllByText("No notes yet").length).toBeGreaterThan(0);
  });

  it("collapses book groups with no notes by default", () => {
    const books = [buildBook({ id: "book-a", title: "Empty Book" })];
    const notes = [buildNote({ id: "loose", title: "Loose note" })];

    render(
      <NotesList
        notes={notes}
        books={books}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    const emptyBookHeader = screen.getByText("Empty Book").closest("div");
    expect(emptyBookHeader?.querySelector(".lucide-chevron-right")).not.toBeNull();
    expect(screen.queryByText("No notes yet")).not.toBeInTheDocument();
  });

  it("remembers a collapsed book group across remounts", () => {
    const books = [buildBook({ id: "book-a", title: "Alpha" })];
    const notes = [{ ...buildNote({ id: "n1", title: "Note one" }), bookId: "book-a" }];
    const props = {
      notes,
      books,
      currentNoteId: null,
      onSelectNote: vi.fn(),
      onCreateNote: vi.fn(),
      onReorderNotes: vi.fn(),
    };

    const { unmount } = render(<NotesList {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    expect(screen.getByText("Note one")).toBeInTheDocument();

    const toggle = screen.getByTestId("book-group-book-a").querySelector("button");
    fireEvent.click(toggle as HTMLButtonElement);
    expect(screen.queryByText("Note one")).not.toBeInTheDocument();

    unmount();
    render(<NotesList {...props} />);
    // View/group mode persist too, so the list reopens in collapsed tree mode.
    expect(screen.queryByText("Note one")).not.toBeInTheDocument();
  });

  it("remembers a collapsed tag group across remounts", () => {
    const notes = [buildNote({ id: "n1", title: "Tagged note", tags: ["solo"] })];
    const props = {
      notes,
      currentNoteId: null,
      onSelectNote: vi.fn(),
      onCreateNote: vi.fn(),
      onReorderNotes: vi.fn(),
    };

    const { unmount } = render(<NotesList {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    fireEvent.click(screen.getByRole("button", { name: "Tag" }));
    expect(screen.getByText("Tagged note")).toBeInTheDocument();

    const header = screen
      .getAllByText("solo")
      .find((el) => el.className.includes("font-medium"))
      ?.closest("div");
    fireEvent.click(header?.querySelector("button") as HTMLButtonElement);
    expect(screen.queryByText("Tagged note")).not.toBeInTheDocument();

    unmount();
    render(<NotesList {...props} />);
    expect(screen.queryByText("Tagged note")).not.toBeInTheDocument();
  });

  it("remembers a collapsed date group across remounts", () => {
    const notes = [buildNote({ id: "n1", title: "Fresh note", updatedAt: Date.now() / 1000 })];
    const props = {
      notes,
      currentNoteId: null,
      onSelectNote: vi.fn(),
      onCreateNote: vi.fn(),
      onReorderNotes: vi.fn(),
    };

    const { unmount } = render(<NotesList {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    fireEvent.click(screen.getByRole("button", { name: "Date" }));
    expect(screen.getByText("Fresh note")).toBeInTheDocument();

    const header = screen.getByText("Today").closest("div");
    fireEvent.click(header?.querySelector("button") as HTMLButtonElement);
    expect(screen.queryByText("Fresh note")).not.toBeInTheDocument();

    unmount();
    render(<NotesList {...props} />);
    expect(screen.queryByText("Fresh note")).not.toBeInTheDocument();
  });

  it("repeats notes across tag groups in tree mode", () => {
    const notes = [
      buildNote({ id: "a", title: "Shared", tags: ["craft", "revision"] }),
      buildNote({ id: "b", title: "Only revision", tags: ["revision"] }),
    ];

    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    fireEvent.click(screen.getByRole("button", { name: "Tag" }));

    expect(screen.getAllByText("craft").length).toBeGreaterThan(0);
    expect(screen.getAllByText("revision").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Shared")).toHaveLength(2);
  });

  it("sorts all notes within the all-notes section on row drop", () => {
    const onReorderNotes = vi.fn();
    const notes = [
      buildNote({ id: "a", title: "Alpha", order: 0 }),
      buildNote({ id: "b", title: "Bravo", order: 1 }),
      buildNote({ id: "c", title: "Charlie", order: 2 }),
    ];

    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={onReorderNotes}
      />
    );

    const source = screen.getByText("Charlie").closest("[data-note-row]");
    const target = screen.getByText("Alpha").closest("[data-note-row]");

    expect(source).not.toBeNull();
    expect(target).not.toBeNull();

    if (!source || !target) {
      throw new Error("Expected note rows to exist");
    }

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(source, { dataTransfer });
    const activeTarget = screen.getByText("Alpha").closest("[data-note-row]");
    if (!activeTarget) {
      throw new Error("Expected active target row to exist");
    }
    setRowRect(activeTarget, { top: 100, bottom: 140, height: 40 });
    dragOverAt(activeTarget, dataTransfer, 110);
    fireEvent.drop(activeTarget, { dataTransfer });

    expect(onReorderNotes).toHaveBeenCalledWith([
      { id: "c", pinned: false },
      { id: "a", pinned: false },
      { id: "b", pinned: false },
    ]);
  });

  it("sorts pinned notes within the pinned section on row drop", () => {
    const onReorderNotes = vi.fn();
    const notes = [
      buildNote({ id: "a", title: "Alpha", pinned: true, order: 0 }),
      buildNote({ id: "b", title: "Bravo", pinned: true, order: 1 }),
      buildNote({ id: "c", title: "Charlie", pinned: false, order: 2 }),
    ];

    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={onReorderNotes}
      />
    );

    const source = screen.getByText("Bravo").closest("[data-note-row]");
    const target = screen.getByText("Alpha").closest("[data-note-row]");

    expect(source).not.toBeNull();
    expect(target).not.toBeNull();

    if (!source || !target) {
      throw new Error("Expected note rows to exist");
    }

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(source, { dataTransfer });
    const activeTarget = screen.getByText("Alpha").closest("[data-note-row]");
    if (!activeTarget) {
      throw new Error("Expected active target row to exist");
    }
    setRowRect(activeTarget, { top: 100, bottom: 140, height: 40 });
    dragOverAt(activeTarget, dataTransfer, 110);
    fireEvent.drop(activeTarget, { dataTransfer });

    expect(onReorderNotes).toHaveBeenCalledWith([
      { id: "b", pinned: true },
      { id: "a", pinned: true },
      { id: "c", pinned: false },
    ]);
  });

  it("drops after the target row when the after-row indicator is active", () => {
    const onReorderNotes = vi.fn();
    const notes = [
      buildNote({ id: "a", title: "Alpha", order: 0 }),
      buildNote({ id: "b", title: "Bravo", order: 1 }),
      buildNote({ id: "c", title: "Charlie", order: 2 }),
    ];

    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={onReorderNotes}
      />
    );

    const source = screen.getByText("Alpha").closest("[data-note-row]");
    if (!source) {
      throw new Error("Expected source row to exist");
    }

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(source, { dataTransfer });
    const target = screen.getByText("Bravo").closest("[data-note-row]");
    if (!target) {
      throw new Error("Expected target row to exist");
    }

    setRowRect(target, { top: 100, bottom: 140, height: 40 });
    dragOverAt(target, dataTransfer, 130);
    fireEvent.drop(target, { dataTransfer });

    expect(onReorderNotes).toHaveBeenCalledWith([
      { id: "b", pinned: false },
      { id: "a", pinned: false },
      { id: "c", pinned: false },
    ]);
  });

  it("pins an all-note when dropped on the pinned section", () => {
    const onReorderNotes = vi.fn();
    const notes = [
      buildNote({ id: "a", title: "Already pinned", pinned: true, order: 0 }),
      buildNote({ id: "b", title: "Regular", pinned: false, order: 1 }),
    ];

    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={onReorderNotes}
      />
    );

    const source = screen.getByText("Regular").closest("[data-note-row]");
    if (!source) {
      throw new Error("Expected note row to exist");
    }

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.drop(screen.getByTestId("notes-section-pinned"), { dataTransfer });

    expect(onReorderNotes).toHaveBeenCalledWith([
      { id: "a", pinned: true },
      { id: "b", pinned: true },
    ]);
  });

  it("highlights the target section while dragging over it", () => {
    const notes = [
      buildNote({ id: "a", title: "Already pinned", pinned: true, order: 0 }),
      buildNote({ id: "b", title: "Regular", pinned: false, order: 1 }),
    ];

    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
      />
    );

    const source = screen.getByText("Regular").closest("[data-note-row]");
    if (!source) {
      throw new Error("Expected note row to exist");
    }

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(screen.getByTestId("notes-section-pinned"), { dataTransfer });

    expect(screen.getByTestId("notes-section-pinned")).toHaveAttribute("data-drop-active", "true");
    expect(screen.getByTestId("notes-section-pinned")).toHaveClass("bg-primary/10");
    expect(screen.getByTestId("notes-section-pinned")).toHaveClass("ring-primary/40");
  });

  it("shows an append indicator when dragging over a section empty area", () => {
    const notes = [
      buildNote({ id: "a", title: "Already pinned", pinned: true, order: 0 }),
      buildNote({ id: "b", title: "Regular", pinned: false, order: 1 }),
    ];

    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
      />
    );

    const source = screen.getByText("Regular").closest("[data-note-row]");
    if (!source) {
      throw new Error("Expected note row to exist");
    }

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(screen.getByTestId("notes-section-pinned"), { dataTransfer });

    expect(screen.getByTestId("note-drop-indicator-section-pinned")).toBeInTheDocument();
  });

  it("shows an insertion indicator before a row when dragging over its top half", () => {
    const notes = [
      buildNote({ id: "a", title: "Alpha", order: 0 }),
      buildNote({ id: "b", title: "Bravo", order: 1 }),
    ];

    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
      />
    );

    const source = screen.getByText("Bravo").closest("[data-note-row]");
    const target = screen.getByText("Alpha").closest("[data-note-row]");
    if (!source || !target) {
      throw new Error("Expected note rows to exist");
    }

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(source, { dataTransfer });
    const activeTarget = screen.getByText("Alpha").closest("[data-note-row]");
    if (!activeTarget) {
      throw new Error("Expected active target row to exist");
    }
    setRowRect(activeTarget, { top: 100, bottom: 140, height: 40 });
    dragOverAt(activeTarget, dataTransfer, 110);

    expect(screen.getByTestId("note-drop-indicator-before-a")).toBeInTheDocument();
  });

  it("shows an insertion indicator after a row when dragging over its bottom half", () => {
    const notes = [
      buildNote({ id: "a", title: "Alpha", order: 0 }),
      buildNote({ id: "b", title: "Bravo", order: 1 }),
    ];

    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
      />
    );

    const source = screen.getByText("Bravo").closest("[data-note-row]");
    const target = screen.getByText("Alpha").closest("[data-note-row]");
    if (!source || !target) {
      throw new Error("Expected note rows to exist");
    }

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(source, { dataTransfer });
    const activeTarget = screen.getByText("Alpha").closest("[data-note-row]");
    if (!activeTarget) {
      throw new Error("Expected active target row to exist");
    }
    setRowRect(activeTarget, { top: 100, bottom: 140, height: 40 });
    dragOverAt(activeTarget, dataTransfer, 130);

    expect(screen.getByTestId("note-drop-indicator-after-a")).toBeInTheDocument();
  });

  it("shows the insertion indicator for a file drag over a note row", () => {
    const notes = [
      buildNote({ id: "a", title: "Alpha", order: 0 }),
      buildNote({ id: "b", title: "Bravo", order: 1 }),
    ];
    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
        onImportFiles={vi.fn()}
      />
    );
    const target = screen.getByText("Bravo").closest("[data-note-row]");
    if (!target) throw new Error("Expected note row to exist");
    setRowRect(target, { top: 100, bottom: 140, height: 40 });
    const file = new File(["# Bravo"], "bravo.md");
    const dataTransfer = {
      files: [file],
      items: [{ kind: "file", type: file.type }],
      dropEffect: "",
    } as unknown as DataTransfer;

    const container = document.querySelector(".overflow-auto");
    if (!container) throw new Error("Expected list container to exist");
    dragOverAt(container, dataTransfer, 110);

    expect(screen.getByTestId("note-drop-indicator-before-b")).toBeInTheDocument();
  });

  it("imports a file batch at the indicated note position", async () => {
    const onImportFiles = vi.fn();
    const notes = [
      buildNote({ id: "a", title: "Alpha", order: 0 }),
      buildNote({ id: "b", title: "Bravo", order: 1 }),
    ];
    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
        onImportFiles={onImportFiles}
      />
    );
    const target = screen.getByText("Bravo").closest("[data-note-row]");
    if (!target) throw new Error("Expected note row to exist");
    setRowRect(target, { top: 100, bottom: 140, height: 40 });
    const file = new File(["# Bravo"], "bravo.md");
    const dataTransfer = {
      files: [file],
      items: [{ kind: "file", type: file.type }],
      dropEffect: "",
    } as unknown as DataTransfer;

    const container = document.querySelector(".overflow-auto");
    if (!container) throw new Error("Expected list container to exist");
    dropAt(container, dataTransfer, 110);

    await waitFor(() =>
      expect(onImportFiles).toHaveBeenCalledWith(
        [{ text: "# Bravo", stem: "bravo", extension: ".md" }],
        { id: "b", placement: "before" }
      )
    );
  });

  it("imports a supported file batch into an empty list without a target", async () => {
    const onImportFiles = vi.fn();
    render(
      <NotesList
        notes={[]}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
        onImportFiles={onImportFiles}
      />
    );
    const file = new File(["# First"], "first.md");
    const dataTransfer = {
      files: [file],
      items: [{ kind: "file", type: file.type }],
      dropEffect: "",
    } as unknown as DataTransfer;
    const container = document.querySelector(".overflow-auto");
    if (!container) throw new Error("Expected list container to exist");

    dropAt(container, dataTransfer, 20);

    await waitFor(() =>
      expect(onImportFiles).toHaveBeenCalledWith(
        [{ text: "# First", stem: "first", extension: ".md" }],
        null
      )
    );
  });

  it("shows import status until note persistence resolves", async () => {
    let resolveImport: (() => void) | undefined;
    const onImportFiles = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveImport = resolve;
        })
    );
    render(
      <NotesList
        notes={[]}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
        onImportFiles={onImportFiles}
      />
    );
    const file = new File(["draft"], "draft.txt");
    const dataTransfer = {
      files: [file],
      items: [{ kind: "file", type: file.type }],
      dropEffect: "",
    } as unknown as DataTransfer;
    const container = document.querySelector(".overflow-auto");
    if (!container) throw new Error("Expected list container to exist");

    dropAt(container, dataTransfer, 20);

    expect(await screen.findByRole("status")).toBeInTheDocument();
    await waitFor(() => expect(onImportFiles).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toBeInTheDocument();
    resolveImport?.();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("keeps internal reorder separate from file import", () => {
    const onImportFiles = vi.fn();
    const onReorderNotes = vi.fn();
    const notes = [
      buildNote({ id: "a", title: "Alpha", order: 0 }),
      buildNote({ id: "b", title: "Bravo", order: 1 }),
    ];
    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={onReorderNotes}
        onImportFiles={onImportFiles}
      />
    );
    const source = screen.getByText("Alpha").closest("[data-note-row]");
    const target = screen.getByText("Bravo").closest("[data-note-row]");
    if (!source || !target) throw new Error("Expected note rows to exist");
    const dataTransfer = {
      files: [],
      items: [],
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(source, { dataTransfer });
    setRowRect(target, { top: 100, bottom: 140, height: 40 });
    dragOverAt(target, dataTransfer, 110);
    fireEvent.drop(target, { dataTransfer });

    expect(onReorderNotes).toHaveBeenCalled();
    expect(onImportFiles).not.toHaveBeenCalled();
  });

  it("unpins a pinned note when dropped on the all-notes section", () => {
    const onReorderNotes = vi.fn();
    const notes = [
      buildNote({ id: "a", title: "Already pinned", pinned: true, order: 0 }),
      buildNote({ id: "b", title: "Regular", pinned: false, order: 1 }),
    ];

    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={onReorderNotes}
      />
    );

    const source = screen.getByText("Already pinned").closest("[data-note-row]");
    if (!source) {
      throw new Error("Expected note row to exist");
    }

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.drop(screen.getByTestId("notes-section-all"), { dataTransfer });

    expect(onReorderNotes).toHaveBeenCalledWith([
      { id: "b", pinned: false },
      { id: "a", pinned: false },
    ]);
  });

  it("reassigns a note's book when dropped on another book group in tree view", () => {
    const onReassignNoteBook = vi.fn();
    const books = [
      buildBook({ id: "book-a", title: "Novel" }),
      buildBook({ id: "book-b", title: "Other" }),
    ];
    const noteA = buildNote({ id: "a", title: "Novel note" }) as Note & { bookId: string };
    noteA.bookId = "book-a";
    const notes = [noteA];

    render(
      <NotesList
        notes={notes}
        books={books}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
        onReassignNoteBook={onReassignNoteBook}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    const source = screen.getByText("Novel note").closest("[data-note-row]");
    const targetGroup = screen.getByTestId("book-group-book-b");
    expect(source).not.toBeNull();

    if (!source) {
      throw new Error("Expected note row to exist");
    }

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(targetGroup, { dataTransfer });
    fireEvent.drop(targetGroup, { dataTransfer });

    expect(onReassignNoteBook).toHaveBeenCalledWith("a", "book-b");
  });

  it("reassigns to unfiled (null) and ignores drops on the same book group", () => {
    const onReassignNoteBook = vi.fn();
    const books = [buildBook({ id: "book-a", title: "Novel" })];
    const noteA = buildNote({ id: "a", title: "Novel note" }) as Note & { bookId: string };
    noteA.bookId = "book-a";

    render(
      <NotesList
        notes={[noteA]}
        books={books}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn()}
        onReassignNoteBook={onReassignNoteBook}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    const source = screen.getByText("Novel note").closest("[data-note-row]");
    if (!source) {
      throw new Error("Expected note row to exist");
    }
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    } as unknown as DataTransfer;

    // Drop on the same group -> no-op
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.drop(screen.getByTestId("book-group-book-a"), { dataTransfer });
    expect(onReassignNoteBook).not.toHaveBeenCalled();

    // Drop on unfiled -> null
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.drop(screen.getByTestId("book-group-unfiled"), { dataTransfer });
    expect(onReassignNoteBook).toHaveBeenCalledWith("a", null);
  });

  it("disables dragging while a search query is active", () => {
    const onReorderNotes = vi.fn();
    const notes = [
      buildNote({ id: "a", title: "Alpha", content: "" }),
      buildNote({ id: "b", title: "Bravo", content: "" }),
    ];

    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={onReorderNotes}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Search notes..."), {
      target: { value: "alp" },
    });

    const row = screen.getByText("Alpha").closest("[data-note-row]");
    expect(row).not.toBeNull();

    if (!row) {
      throw new Error("Expected filtered row to exist");
    }

    expect(row).not.toHaveAttribute("draggable");

    fireEvent.drop(row);
    expect(onReorderNotes).not.toHaveBeenCalled();
  });
});
