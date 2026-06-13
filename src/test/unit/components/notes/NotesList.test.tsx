import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotesList } from "../../../../components/notes/NotesList";
import type { Book } from "../../../../features/books/types";
import type { Note } from "../../../../features/notes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number }) => {
      const map: Record<string, string> = {
        "notes.title": "Notes",
        "notes.newNote": "New note",
        "notes.search": "Search notes...",
        "notes.empty": "No notes",
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

afterEach(() => {
  vi.restoreAllMocks();
});

function buildNote(overrides: Partial<Note>): Note {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? "",
    content: overrides.content ?? "",
    tags: overrides.tags ?? [],
    pinned: overrides.pinned ?? false,
    order: overrides.order ?? 0,
    wordCount: overrides.wordCount ?? 0,
    collapsedHeadings: overrides.collapsedHeadings ?? [],
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
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

describe("NotesList", () => {
  it("renders list and tree view toggle in the title bar", () => {
    const onCreateNote = vi.fn();

    render(
      <NotesList
        notes={[]}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={onCreateNote}
        onReorderNotes={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "List" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tree" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tree" }).querySelector(".lucide-folder-tree")).not.toBeNull();
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
      />,
    );

    expect(screen.getByText("Pinned")).toBeInTheDocument();
    expect(screen.getByText("All notes")).toBeInTheDocument();
    expect(screen.getByText("2 pinned")).toBeInTheDocument();
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
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    expect(screen.getByText("Group")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Book" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("notes-group-label-book")).not.toHaveClass("@max-[340px]/notes-sidebar:sr-only");
    expect(screen.getByTestId("notes-group-label-tag")).not.toHaveClass("@max-[340px]/notes-sidebar:sr-only");
    expect(screen.getByTestId("notes-group-label-date")).not.toHaveClass("@max-[340px]/notes-sidebar:sr-only");
    expect(screen.getByText("Novel")).toBeInTheDocument();
    expect(screen.getByText("Novel note")).toBeInTheDocument();
    expect(screen.getByText("Empty Book")).toBeInTheDocument();
    expect(screen.getByText("Unfiled")).toBeInTheDocument();
    expect(screen.getByText("Loose note")).toBeInTheDocument();
    expect(screen.getByText("Unfiled").closest("div")?.querySelector(".lucide-feather")).not.toBeNull();
    expect(screen.getByTestId("book-title-action-book-a")).toHaveTextContent("Novel");
    expect(screen.getByTestId("book-title-action-book-a").querySelector('button[aria-label="Add note"]')).not.toBeNull();
    expect(screen.getByTestId("book-count-book-a")).toHaveTextContent("1");

    fireEvent.click(screen.getAllByRole("button", { name: "Add note" })[0]);
    expect(onCreateNote).toHaveBeenCalledWith("book-a");
  });

  it("collapses toggle labels independently when each group's measured labels do not fit", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      const testId = this.getAttribute("data-testid");

      if (testId === "notes-view-toggle-group") return 190;
      if (testId === "notes-group-toggle-group") return 150;

      return 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
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
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("notes-view-toggle-group")).toHaveAttribute("data-label-mode", "full");
    });

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    await waitFor(() => {
      expect(screen.getByTestId("notes-group-toggle-group")).toHaveAttribute("data-label-mode", "icon");
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
      />,
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
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    const emptyBookHeader = screen.getByText("Empty Book").closest("div");
    expect(emptyBookHeader?.querySelector(".lucide-chevron-right")).not.toBeNull();
    expect(screen.queryByText("No notes yet")).not.toBeInTheDocument();
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
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    fireEvent.click(screen.getByRole("button", { name: "Tag" }));

    expect(screen.getAllByText("craft").length).toBeGreaterThan(0);
    expect(screen.getAllByText("revision").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Shared")).toHaveLength(2);
  });

  it("reorders the full list on drop when search is not active", () => {
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
      />,
    );

    const source = screen.getByText("Charlie").closest("li");
    const target = screen.getByText("Alpha").closest("li");

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
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(onReorderNotes).toHaveBeenCalledWith(["c", "a", "b"]);
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
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    const source = screen.getByText("Novel note").closest("li");
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
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    const source = screen.getByText("Novel note").closest("li");
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
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search notes..."), {
      target: { value: "alp" },
    });

    const row = screen.getByText("Alpha").closest("li");
    expect(row).not.toBeNull();

    if (!row) {
      throw new Error("Expected filtered row to exist");
    }

    expect(row).not.toHaveAttribute("draggable");

    fireEvent.drop(row);
    expect(onReorderNotes).not.toHaveBeenCalled();
  });
});
