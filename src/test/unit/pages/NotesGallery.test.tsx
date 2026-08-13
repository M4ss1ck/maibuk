import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotesGallery } from "@/pages/NotesGallery";
import { useSettingsStore } from "@/features/settings/store";
import { DEFAULT_NOTES_FILTERS } from "@/components/notes/notes-list-model";

vi.mock("../../../lib/platform", () => ({
  IS_ANDROID: false,
  IS_TAURI: false,
  getFileSystem: vi.fn(),
}));

const { mockNavigate, noteState, bookState, settingsState } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  noteState: {
    notes: [
      { id: "n1", title: "First", bookId: "book-1", tags: [], content: "" },
      { id: "n2", title: "Second", bookId: null, tags: [], content: "" },
    ] as Array<Record<string, unknown>>,
    loadNotes: vi.fn(() => Promise.resolve()),
    createNote: vi.fn(() => Promise.resolve({ id: "n3" })),
  },
  bookState: {
    books: [{ id: "book-1", title: "My Book" }],
    loadBooks: vi.fn(() => Promise.resolve()),
  },
  settingsState: {
    setLastNoteId: vi.fn(),
    notesSort: "date-desc" as const,
    setNotesSort: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../features/notes", () => {
  const useNoteStore = (selector: (s: typeof noteState) => unknown) => selector(noteState);
  return { useNoteStore };
});

vi.mock("../../../features/books/store", () => {
  const useBookStore = (selector: (s: typeof bookState) => unknown) => selector(bookState);
  return { useBookStore };
});

// A real store, not a static object: the gallery's filter bar now reads and
// writes settings state, so the double has to re-render on change.
vi.mock("../../../features/settings/store", async () => {
  const { create } = await import("zustand");
  const { DEFAULT_NOTES_FILTERS } = await import("../../../components/notes/notes-list-model");

  const useSettingsStore = create(() => ({
    ...settingsState,
    notesFilters: DEFAULT_NOTES_FILTERS,
    setNotesFilters: (filters: Record<string, unknown>) =>
      useSettingsStore.setState((state) => ({
        notesFilters: { ...state.notesFilters, ...filters },
      })),
  }));

  return { useSettingsStore };
});

vi.mock("../../../components/notes", async () => {
  const { GridListItem } = await import("react-aria-components/GridList");
  return {
    NoteCard: ({
      note,
      bookTitle,
      onClick,
    }: {
      note: { id: string; title: string };
      bookTitle?: string | null;
      onClick: () => void;
    }) => (
      <GridListItem id={note.id} textValue={note.title} onPress={onClick}>
        {note.title}
        {bookTitle ? ` (${bookTitle})` : ""}
      </GridListItem>
    ),
  };
});

describe("NotesGallery", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    settingsState.setLastNoteId.mockClear();
    useSettingsStore.setState({ notesFilters: DEFAULT_NOTES_FILTERS });
    noteState.createNote.mockReset();
    noteState.createNote.mockResolvedValue({ id: "n3" });
    noteState.notes = [
      { id: "n1", title: "First", bookId: "book-1", tags: [], content: "" },
      { id: "n2", title: "Second", bookId: null, tags: [], content: "" },
    ];
  });

  it("renders a card per note with the linked book title and opens it on click", () => {
    render(<NotesGallery />);

    expect(screen.getByText("First (My Book)")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();

    fireEvent.click(screen.getByText("First (My Book)"));
    expect(settingsState.setLastNoteId).toHaveBeenCalledWith("n1");
    expect(mockNavigate).toHaveBeenCalledWith("/notes/n1");
  });

  it("moves focus between notes with arrow keys and opens the focused note", async () => {
    const user = userEvent.setup();
    render(<NotesGallery />);
    const [first, second] = screen.getAllByRole("row");

    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(second).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(mockNavigate).toHaveBeenCalledWith("/notes/n2");
  });

  it("enters the note grid with an arrow key before anything has been tabbed to", async () => {
    const user = userEvent.setup();
    render(<NotesGallery />);

    expect(document.body).toHaveFocus();
    await user.keyboard("{ArrowDown}");

    expect(screen.getAllByRole("row")[0]).toHaveFocus();
  });

  it("makes note search the first Tab stop", async () => {
    const user = userEvent.setup();
    render(<NotesGallery />);

    await user.tab();

    expect(screen.getByPlaceholderText("notes.search")).toHaveFocus();
  });

  it("creates a note and opens its editor from the empty state", async () => {
    noteState.notes = [];
    render(<NotesGallery />);

    fireEvent.click(screen.getAllByText("notes.newNote")[0]);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/notes/n3");
    });
  });

  it("creates dropped notes at the beginning while preserving drop order", async () => {
    noteState.notes = [
      { id: "n1", title: "First", bookId: null, tags: [], content: "", order: 0 },
      { id: "n2", title: "Second", bookId: null, tags: [], content: "", order: 1 },
      { id: "n3", title: "Third", bookId: null, tags: [], content: "", order: 2 },
    ];
    const { container } = render(<NotesGallery />);
    const dropzone = container.firstElementChild as HTMLElement;
    const files = [new File(["# A"], "a.md"), new File(["plain"], "b.txt")];

    fireEvent.drop(dropzone, {
      clientX: 10,
      clientY: 20,
      dataTransfer: {
        files,
        items: files.map((file) => ({ kind: "file", type: file.type })),
        dropEffect: "",
      },
    });

    await waitFor(() => {
      expect(noteState.createNote).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ title: "a", order: -2 })
      );
      expect(noteState.createNote).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ title: "b", order: -1 })
      );
    });
  });

  it("creates dropped notes when the gallery is empty", async () => {
    noteState.notes = [];
    const { container } = render(<NotesGallery />);
    const dropzone = container.firstElementChild as HTMLElement;
    const files = [new File(["# A"], "a.md"), new File(["plain"], "b.txt")];

    fireEvent.drop(dropzone, {
      clientX: 10,
      clientY: 20,
      dataTransfer: {
        files,
        items: files.map((file) => ({ kind: "file", type: file.type })),
        dropEffect: "",
      },
    });

    await waitFor(() => {
      expect(noteState.createNote).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ title: "a", order: -2 })
      );
      expect(noteState.createNote).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ title: "b", order: -1 })
      );
    });
  });

  it("shows import status until dropped-note persistence resolves", async () => {
    noteState.notes = [];
    let resolveCreate: ((note: { id: string }) => void) | undefined;
    noteState.createNote.mockImplementation(
      () =>
        new Promise<{ id: string }>((resolve) => {
          resolveCreate = resolve;
        })
    );
    const { container } = render(<NotesGallery />);
    const dropzone = container.firstElementChild as HTMLElement;
    const file = new File(["draft"], "draft.txt");

    fireEvent.drop(dropzone, {
      clientX: 10,
      clientY: 20,
      dataTransfer: {
        files: [file],
        items: [{ kind: "file", type: file.type }],
        dropEffect: "",
      },
    });

    expect(screen.getByRole("status")).toBeInTheDocument();
    await waitFor(() => expect(noteState.createNote).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toBeInTheDocument();
    resolveCreate?.({ id: "imported" });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("focuses search with Ctrl+F and opens filters when search is already focused", async () => {
    noteState.notes = [{ id: "n1", title: "First", bookId: "book-1", tags: ["Work"], content: "" }];
    render(<NotesGallery />);

    const searchInput = screen.getByPlaceholderText("notes.search");

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(searchInput).toHaveFocus();

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("notes.anyTag")).toHaveFocus();
    });
    expect(screen.getByText("Work")).toBeInTheDocument();
  });

  it("opens filters directly with Ctrl+Shift+F", async () => {
    noteState.notes = [
      { id: "n1", title: "First", bookId: "book-1", tags: ["Research"], content: "" },
    ];
    render(<NotesGallery />);

    fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("notes.anyTag")).toHaveFocus();
    });
    expect(screen.getByText("Research")).toBeInTheDocument();
  });
});
