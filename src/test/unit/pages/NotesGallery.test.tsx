import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotesGallery } from "../../../pages/NotesGallery";

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
  settingsState: { setLastNoteId: vi.fn() },
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

vi.mock("../../../features/settings/store", () => {
  const useSettingsStore = (selector: (s: typeof settingsState) => unknown) =>
    selector(settingsState);
  return { useSettingsStore };
});

vi.mock("../../../components/notes", () => ({
  NoteCard: ({
    note,
    bookTitle,
    onClick,
  }: {
    note: { id: string; title: string };
    bookTitle?: string | null;
    onClick: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {note.title}
      {bookTitle ? ` (${bookTitle})` : ""}
    </button>
  ),
}));

describe("NotesGallery", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    settingsState.setLastNoteId.mockClear();
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

  it("creates a note and opens its editor from the empty state", async () => {
    noteState.notes = [];
    render(<NotesGallery />);

    fireEvent.click(screen.getAllByText("notes.newNote")[0]);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/notes/n3");
    });
  });
});
