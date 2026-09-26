import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesList } from "@/components/notes/NotesList";
import { useSettingsStore } from "@/features/settings/store";
import type { Book } from "@/features/books/types";
import type { Note } from "@/features/notes";
import {
  createDataTransfer,
  createFileDataTransfer,
  dispatchDragEvent,
  mockRect,
} from "@/test/support/drag-events";
import {
  installPointerEvent,
  pointerHitTarget,
  touchLongPress,
  touchTap,
} from "@/test/support/pointer-events";

installPointerEvent();

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
        "notes.reorder": "Reorder",
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
    contentUpdatedAt:
      overrides.contentUpdatedAt ?? overrides.updatedAt ?? new Date("2026-01-01T00:00:00Z"),
  };
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

  it("renames a note inline from the book-tree view", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "common.moreActionsFor" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "common.rename" }));

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

    const dataTransfer = createDataTransfer();

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

    const dataTransfer = createDataTransfer();

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

    const dataTransfer = createDataTransfer();

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(screen.getByTestId("notes-section-pinned"), { dataTransfer });

    expect(screen.getByTestId("note-drop-indicator-section-pinned")).toBeInTheDocument();
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
    const dataTransfer = createFileDataTransfer(file);
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
    const dataTransfer = createFileDataTransfer(file);
    const container = document.querySelector(".overflow-auto");
    if (!container) throw new Error("Expected list container to exist");

    dropAt(container, dataTransfer, 20);

    expect(await screen.findByRole("status")).toBeInTheDocument();
    await waitFor(() => expect(onImportFiles).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toBeInTheDocument();
    resolveImport?.();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
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

    const dataTransfer = createDataTransfer();

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

    const dataTransfer = createDataTransfer();

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
    const dataTransfer = createDataTransfer();

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

describe("NotesList reorder", () => {
  function renderReorderList(
    notes: Note[],
    overrides: Partial<Parameters<typeof NotesList>[0]> = {}
  ) {
    const props = {
      notes,
      currentNoteId: null,
      onSelectNote: vi.fn(),
      onCreateNote: vi.fn(),
      onReorderNotes: vi.fn(),
      ...overrides,
    };
    render(<NotesList {...props} />);
    return props;
  }

  const noteRow = (id: string) => {
    const row = document.querySelector<HTMLElement>(`[role="row"][data-key="${id}"]`);
    if (!row) throw new Error(`no row for ${id}`);
    return row;
  };
  const handleOf = (id: string) => within(noteRow(id)).getByRole("button", { name: "Reorder" });

  /** Tab from the row into its controls until its reorder button has focus. */
  async function tabToHandle(user: ReturnType<typeof userEvent.setup>, id: string) {
    noteRow(id).focus();
    const handle = handleOf(id);
    for (let i = 0; i < 8 && document.activeElement !== handle; i++) await user.tab();
    expect(handle).toHaveFocus();
  }

  async function arrowTo(
    user: ReturnType<typeof userEvent.setup>,
    name: string,
    key = "{ArrowUp}"
  ) {
    for (let i = 0; i < 10 && document.activeElement?.getAttribute("aria-label") !== name; i++) {
      await user.keyboard(key);
    }
    expect(document.activeElement).toHaveAccessibleName(name);
  }

  /** Drops (Enter) or cancels (Escape), then waits for React Aria to end the drag. */
  async function endDrag(user: ReturnType<typeof userEvent.setup>, key: "{Enter}" | "{Escape}") {
    await user.keyboard(key);
    // A keyboard drag hides everything but its drop targets until it ends.
    await waitFor(() =>
      expect(screen.getByRole("grid").closest('[aria-hidden="true"]')).toBeNull()
    );
  }

  /** Rows 40px tall, 50px apart, in document order. */
  function mockNoteLayout() {
    const grid = screen.getByRole("grid");
    const rows = [...document.querySelectorAll<HTMLElement>('[role="row"][data-key]')];
    mockRect(grid, 0, rows.length * 50);
    rows.forEach((row, index) => {
      mockRect(row, index * 50, index * 50 + 40);
    });
    return { grid, rows };
  }

  describe("by keyboard", () => {
    it("moves a Note within its section: Enter lifts, arrows pick the gap, Enter drops", async () => {
      const user = userEvent.setup();
      const props = renderReorderList([
        buildNote({ id: "a", title: "Alpha" }),
        buildNote({ id: "b", title: "Bravo" }),
        buildNote({ id: "c", title: "Charlie" }),
      ]);

      await tabToHandle(user, "c");
      await user.keyboard("{Enter}");
      await arrowTo(user, "Insert before Alpha");
      await endDrag(user, "{Enter}");

      expect(props.onReorderNotes).toHaveBeenCalledTimes(1);
      expect(props.onReorderNotes).toHaveBeenCalledWith([
        { id: "c", pinned: false },
        { id: "a", pinned: false },
        { id: "b", pinned: false },
      ]);
      expect(props.onSelectNote).not.toHaveBeenCalled();
    });

    it("pins a Note dropped among the Pinned Notes", async () => {
      const user = userEvent.setup();
      const props = renderReorderList([
        buildNote({ id: "a", title: "Alpha", pinned: true }),
        buildNote({ id: "b", title: "Bravo" }),
        buildNote({ id: "c", title: "Charlie" }),
      ]);

      await tabToHandle(user, "c");
      await user.keyboard("{Enter}");
      await arrowTo(user, "Insert before Alpha");
      await endDrag(user, "{Enter}");

      expect(props.onReorderNotes).toHaveBeenCalledWith([
        { id: "c", pinned: true },
        { id: "a", pinned: true },
        { id: "b", pinned: false },
      ]);
    });

    it("unpins a Pinned Note dropped among the other Notes", async () => {
      const user = userEvent.setup();
      const props = renderReorderList([
        buildNote({ id: "a", title: "Alpha", pinned: true }),
        buildNote({ id: "b", title: "Bravo", pinned: true }),
        buildNote({ id: "c", title: "Charlie" }),
      ]);

      await tabToHandle(user, "a");
      await user.keyboard("{Enter}");
      await arrowTo(user, "Insert after Charlie", "{ArrowDown}");
      await endDrag(user, "{Enter}");

      expect(props.onReorderNotes).toHaveBeenCalledWith([
        { id: "b", pinned: true },
        { id: "c", pinned: false },
        { id: "a", pinned: false },
      ]);
    });

    it("treats the gap between the sections as the top of the other Notes", async () => {
      const user = userEvent.setup();
      const props = renderReorderList([
        buildNote({ id: "a", title: "Alpha", pinned: true }),
        buildNote({ id: "b", title: "Bravo", pinned: true }),
        buildNote({ id: "c", title: "Charlie" }),
      ]);

      await tabToHandle(user, "a");
      await user.keyboard("{Enter}");
      await arrowTo(user, "Insert before Charlie", "{ArrowDown}");
      await endDrag(user, "{Enter}");

      expect(props.onReorderNotes).toHaveBeenCalledWith([
        { id: "b", pinned: true },
        { id: "a", pinned: false },
        { id: "c", pinned: false },
      ]);
    });

    it("offers no drop on a Note, only the gaps between Notes", async () => {
      const user = userEvent.setup();
      renderReorderList([
        buildNote({ id: "a", title: "Alpha" }),
        buildNote({ id: "b", title: "Bravo" }),
      ]);

      await tabToHandle(user, "b");
      await user.keyboard("{Enter}");
      // React Aria moves focus to the first drop target once the drag starts.
      await waitFor(() => expect(handleOf("b")).not.toHaveFocus());
      const seen = new Set<string>();
      for (let i = 0; i < 6; i++) {
        seen.add(document.activeElement?.getAttribute("aria-label") ?? "");
        await user.keyboard("{ArrowDown}");
      }
      expect([...seen].sort()).toEqual([
        "Insert after Bravo",
        "Insert before Alpha",
        "Insert between Alpha and Bravo",
      ]);
      await endDrag(user, "{Escape}");
    });

    it("Escape cancels the drag: nothing is written and focus returns to the handle", async () => {
      const user = userEvent.setup();
      const props = renderReorderList([
        buildNote({ id: "a", title: "Alpha" }),
        buildNote({ id: "b", title: "Bravo" }),
      ]);

      await tabToHandle(user, "b");
      await user.keyboard("{Enter}");
      await arrowTo(user, "Insert before Alpha");
      await endDrag(user, "{Escape}");

      expect(props.onReorderNotes).not.toHaveBeenCalled();
      await waitFor(() => expect(handleOf("b")).toHaveFocus());
    });

    it("a touch drag starts from the grip, never from the row body", () => {
      renderReorderList([buildNote({ id: "a", title: "Alpha" })]);
      const row = noteRow("a");
      // A native listener on the row only hears drags the touch guard lets through.
      const reachedRow = vi.fn();
      row.addEventListener("dragstart", reachedRow);
      const touchDragFrom = (origin: Element) => {
        reachedRow.mockClear();
        fireEvent.pointerDown(origin, { pointerType: "touch" });
        fireEvent.dragStart(row);
        return reachedRow.mock.calls.length > 0;
      };
      // React Aria makes its drag button ignore pointers: a touch on the grip
      // reaches whatever is under it, which must still count as the handle.
      const grip = handleOf("a").querySelector("svg")!;

      expect(touchDragFrom(screen.getByText("Alpha"))).toBe(false);
      expect(touchDragFrom(pointerHitTarget(grip))).toBe(true);
    });

    it("offers no reorder handle while searching, and none in the tree view", async () => {
      const user = userEvent.setup();
      renderReorderList([
        buildNote({ id: "a", title: "Alpha" }),
        buildNote({ id: "b", title: "Bravo" }),
      ]);
      expect(screen.getAllByRole("button", { name: "Reorder" })).toHaveLength(2);

      await user.type(screen.getByPlaceholderText("Search notes..."), "alp");
      expect(screen.queryByRole("button", { name: "Reorder" })).not.toBeInTheDocument();

      await user.clear(screen.getByPlaceholderText("Search notes..."));
      act(() => useSettingsStore.setState({ notesListView: "tree" }));
      expect(screen.queryByRole("button", { name: "Reorder" })).not.toBeInTheDocument();
    });
  });

  describe("by mouse", () => {
    it.each([
      ["top half", 5, [{ id: "c" }, { id: "a" }, { id: "b" }]],
      ["bottom half", 35, [{ id: "a" }, { id: "c" }, { id: "b" }]],
    ] as const)("drops a Note beside the row under the pointer's %s", async (_half, y, order) => {
      const props = renderReorderList([
        buildNote({ id: "a", title: "Alpha" }),
        buildNote({ id: "b", title: "Bravo" }),
        buildNote({ id: "c", title: "Charlie" }),
      ]);
      const { grid, rows } = mockNoteLayout();
      const dt = createDataTransfer();

      dispatchDragEvent(rows[2], "dragstart", dt, 110);
      expect(dt.types).toContain("note");
      dispatchDragEvent(grid, "dragenter", dt, y);
      dispatchDragEvent(grid, "dragover", dt, y);
      await waitFor(() => expect(document.querySelectorAll("[data-drop-target]")).toHaveLength(1));
      dispatchDragEvent(grid, "drop", dt, y);

      await waitFor(() =>
        expect(props.onReorderNotes).toHaveBeenCalledWith(
          order.map(({ id }) => ({ id, pinned: false }))
        )
      );
      dispatchDragEvent(rows[2], "dragend", dt, y);
    });

    it("reorders within the Pinned section and keeps the other Notes", async () => {
      const props = renderReorderList([
        buildNote({ id: "a", title: "Alpha", pinned: true }),
        buildNote({ id: "b", title: "Bravo", pinned: true }),
        buildNote({ id: "c", title: "Charlie" }),
      ]);
      const { grid, rows } = mockNoteLayout();
      const dt = createDataTransfer();

      dispatchDragEvent(rows[1], "dragstart", dt, 60);
      dispatchDragEvent(grid, "dragenter", dt, 5);
      dispatchDragEvent(grid, "dragover", dt, 5);
      dispatchDragEvent(grid, "drop", dt, 5);

      await waitFor(() =>
        expect(props.onReorderNotes).toHaveBeenCalledWith([
          { id: "b", pinned: true },
          { id: "a", pinned: true },
          { id: "c", pinned: false },
        ])
      );
      dispatchDragEvent(rows[1], "dragend", dt, 5);
    });

    it("imports dropped files at the gap under the pointer, never as a reorder", async () => {
      const onImportFiles = vi.fn();
      const props = renderReorderList(
        [buildNote({ id: "a", title: "Alpha" }), buildNote({ id: "b", title: "Bravo" })],
        { onImportFiles }
      );
      const { grid } = mockNoteLayout();
      const dt = createFileDataTransfer(
        new File(["# Bravo"], "bravo.md", { type: "text/markdown" })
      );

      dispatchDragEvent(grid, "dragenter", dt, 55);
      dispatchDragEvent(grid, "dragover", dt, 55);
      await waitFor(() => expect(document.querySelectorAll("[data-drop-target]")).toHaveLength(1));
      dispatchDragEvent(grid, "drop", dt, 55);

      await waitFor(() =>
        expect(onImportFiles).toHaveBeenCalledWith(
          [{ text: "# Bravo", stem: "bravo", extension: ".md" }],
          { id: "b", placement: "before" }
        )
      );
      expect(props.onReorderNotes).not.toHaveBeenCalled();
    });

    it("shows import status until a file dropped on the list is persisted", async () => {
      let finish: (() => void) | undefined;
      const onImportFiles = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
      renderReorderList([buildNote({ id: "a", title: "Alpha" })], { onImportFiles });
      const { grid } = mockNoteLayout();
      const dt = createFileDataTransfer(new File(["draft"], "draft.txt", { type: "text/plain" }));

      dispatchDragEvent(grid, "dragenter", dt, 35);
      dispatchDragEvent(grid, "dragover", dt, 35);
      dispatchDragEvent(grid, "drop", dt, 35);

      await waitFor(() => expect(onImportFiles).toHaveBeenCalledOnce());
      expect(screen.getByRole("status")).toBeInTheDocument();
      act(() => finish?.());
      await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    });
  });
});

describe("NotesList item menu", () => {
  function renderMenuList(overrides: Partial<Parameters<typeof NotesList>[0]> = {}) {
    const props = {
      notes: [
        buildNote({ id: "a", title: "Alpha", order: 0 }),
        buildNote({ id: "b", title: "Beta", order: 1 }),
      ],
      books: [buildBook({ id: "book-a", title: "Novel" })],
      currentNoteId: null,
      onSelectNote: vi.fn(),
      onCreateNote: vi.fn(),
      onReorderNotes: vi.fn(async () => {}),
      onReassignNoteBook: vi.fn(),
      onDeleteNote: vi.fn(),
      onDuplicateNote: vi.fn(),
      onRenameNote: vi.fn(),
      ...overrides,
    };
    render(<NotesList {...props} />);
    return props;
  }

  async function openMenuFor(user: ReturnType<typeof userEvent.setup>, index: number) {
    const trigger = screen.getAllByRole("button", { name: "common.moreActionsFor" })[index];
    await user.click(trigger);
    await screen.findByRole("menu");
    return trigger;
  }

  /** A controlled list whose Delete actually removes the Note. */
  function DeleteHarness() {
    const [notes, setNotes] = useState([
      buildNote({ id: "a", title: "Alpha", order: 0 }),
      buildNote({ id: "b", title: "Beta", order: 1 }),
    ]);
    return (
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={vi.fn(async () => {})}
        onDeleteNote={(id) => setNotes((current) => current.filter((note) => note.id !== id))}
      />
    );
  }

  async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>, row: HTMLElement) {
    row.focus();
    fireEvent.keyDown(row, { key: "F10", shiftKey: true });
    await screen.findByRole("menu");
    const remove = screen.getByRole("menuitem", { name: "common.delete" });
    while (document.activeElement !== remove) await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "notes.deleteConfirm" });
  }

  async function confirmDelete(user: ReturnType<typeof userEvent.setup>) {
    const confirm = screen.getByRole("button", { name: "notes.delete" });
    for (let step = 0; step < 4 && document.activeElement !== confirm; step++) {
      await user.keyboard("{Tab}");
    }
    await user.keyboard("{Enter}");
  }

  it("asks before deleting and deletes only after confirmation", async () => {
    const user = userEvent.setup();
    const props = renderMenuList();

    await openMenuFor(user, 0);
    await user.click(screen.getByRole("menuitem", { name: "common.delete" }));

    const dialog = await screen.findByRole("dialog", { name: "notes.deleteConfirm" });
    expect(dialog).toHaveTextContent("notes.deleteConfirmBody");
    expect(props.onDeleteNote).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "notes.delete" }));

    expect(props.onDeleteNote).toHaveBeenCalledWith("a");
    expect(props.onSelectNote).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escape cancels the delete confirmation without deleting", async () => {
    const user = userEvent.setup();
    const props = renderMenuList();

    await openMenuFor(user, 1);
    await user.keyboard("{End}{Enter}");
    await screen.findByRole("dialog", { name: "notes.deleteConfirm" });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(props.onDeleteNote).not.toHaveBeenCalled();
  });

  it("returns focus to the note's row when the delete is cancelled", async () => {
    const user = userEvent.setup();
    renderMenuList();
    const row = screen.getAllByRole("row").filter((item) => item.hasAttribute("data-key"))[0];

    await openDeleteDialog(user, row);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(row.contains(document.activeElement)).toBe(true));
  });

  it("moves focus to the next row after a confirmed delete", async () => {
    const user = userEvent.setup();
    render(<DeleteHarness />);
    const rows = () => screen.getAllByRole("row").filter((item) => item.hasAttribute("data-key"));
    const first = rows()[0];

    await openDeleteDialog(user, first);
    await confirmDelete(user);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("Alpha")).not.toBeInTheDocument());
    await waitFor(() => expect(rows()[0].contains(document.activeElement)).toBe(true));
    expect(rows()[0]).toHaveTextContent("Beta");
  });

  it("pins a note from the menu through the ordering write", async () => {
    const user = userEvent.setup();
    const props = renderMenuList();

    await openMenuFor(user, 1);
    await user.click(screen.getByRole("menuitem", { name: "Pin" }));

    expect(props.onReorderNotes).toHaveBeenCalledWith([
      { id: "b", pinned: true },
      { id: "a", pinned: false },
    ]);
  });

  it("unpins a pinned note to the top of the other notes", async () => {
    const user = userEvent.setup();
    const props = renderMenuList({
      notes: [
        buildNote({ id: "p", title: "Pinned", pinned: true }),
        buildNote({ id: "a", title: "Alpha", order: 0 }),
      ],
    });

    await openMenuFor(user, 0);
    await user.click(screen.getByRole("menuitem", { name: "Unpin" }));

    expect(props.onReorderNotes).toHaveBeenCalledWith([
      { id: "p", pinned: false },
      { id: "a", pinned: false },
    ]);
  });

  it("pinning while searching keeps notes hidden by the search in the order", async () => {
    const user = userEvent.setup();
    const props = renderMenuList();

    fireEvent.change(screen.getByPlaceholderText("Search notes..."), {
      target: { value: "Beta" },
    });
    await openMenuFor(user, 0);
    await user.click(screen.getByRole("menuitem", { name: "Pin" }));

    expect(props.onReorderNotes).toHaveBeenCalledWith([
      { id: "b", pinned: true },
      { id: "a", pinned: false },
    ]);
  });

  it("moves a note to a Book by keyboard through the submenu", async () => {
    const user = userEvent.setup();
    const props = renderMenuList();

    await openMenuFor(user, 0);
    const move = screen.getByRole("menuitem", { name: "notes.moveToBook" });
    while (document.activeElement !== move) await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Unfiled" })).toHaveFocus());
    await user.keyboard("{ArrowDown}{Enter}");

    expect(props.onReassignNoteBook).toHaveBeenCalledWith("a", "book-a");
  });

  // jsdom applies no CSS: with a mouse the ⋯ button is display:none and Tab
  // skips it, on touch the hover icons are; both sit in the row's tab order.
  async function tabFromFirstRowTo(user: ReturnType<typeof userEvent.setup>, name: string) {
    const row = screen.getAllByRole("row").filter((item) => item.hasAttribute("data-key"))[0];
    row.focus();
    const target = screen.getAllByRole("button", { name })[0];
    for (let step = 0; step < 6 && document.activeElement !== target; step++) await user.tab();
    expect(target).toHaveFocus();
    return row;
  }

  it("keeps one-click edit, duplicate and delete on the row for the mouse, and confirms delete", async () => {
    const user = userEvent.setup();
    const props = renderMenuList();

    const row = await tabFromFirstRowTo(user, "common.edit");
    const inRow = within(row);
    expect(inRow.getByRole("button", { name: "notes.duplicate" })).toBeInTheDocument();
    expect(inRow.getByRole("button", { name: "common.edit" }).parentElement).toHaveClass(
      "group-hover:opacity-100",
      "pointer-coarse:hidden"
    );
    expect(inRow.getByRole("button", { name: "common.moreActionsFor" })).toHaveClass(
      "hidden",
      "pointer-coarse:inline-flex"
    );

    await user.click(inRow.getByRole("button", { name: "common.delete" }));
    await screen.findByRole("dialog", { name: "notes.deleteConfirm" });
    expect(props.onDeleteNote).not.toHaveBeenCalled();
  });

  it("reaches the ⋯ button from its row with Tab and opens it with Enter", async () => {
    const user = userEvent.setup();
    renderMenuList();

    await tabFromFirstRowTo(user, "common.moreActionsFor");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("opens from the focused row with Shift+F10 and closes back to it with Escape", async () => {
    const user = userEvent.setup();
    renderMenuList();
    const row = screen.getAllByRole("row").filter((item) => item.hasAttribute("data-key"))[0];
    row.focus();

    fireEvent.keyDown(row, { key: "F10", shiftKey: true });

    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "common.rename" })).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(row.contains(document.activeElement)).toBe(true));
  });

  it("Escape closes the item menu and keeps focus on that note", async () => {
    const user = userEvent.setup();
    renderMenuList();

    const row = await tabFromFirstRowTo(user, "common.moreActionsFor");
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(row.contains(document.activeElement)).toBe(true));
  });

  it("opens the menu on touch long-press without opening the note", () => {
    vi.useFakeTimers();
    try {
      const props = renderMenuList();

      touchLongPress(screen.getByText("Alpha"));

      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(props.onSelectNote).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the note on a short touch tap", () => {
    vi.useFakeTimers();
    try {
      const props = renderMenuList();

      touchTap(screen.getByText("Alpha"));

      expect(props.onSelectNote).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the add-note button of a Book group in the tab order without hover", async () => {
    const user = userEvent.setup();
    const onCreateNote = vi.fn();
    renderMenuList({ onCreateNote });

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    const add = screen.getByRole("button", { name: "Add note" });
    add.focus();
    await user.keyboard("{Enter}");

    expect(onCreateNote).toHaveBeenCalledWith("book-a");
  });
});
