import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Notes } from "../../../pages/Notes";

const { mockNavigate, mockLocation, noteState } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLocation: {
    state: { openNoteId: "n1", returnTo: "/book/book-1", returnLabel: "My Book" },
    pathname: "/notes",
  },
  noteState: {
    notes: [{ id: "n1", title: "Chapter idea", bookId: "book-1" }],
    currentNote: {
      id: "n1",
      title: "Chapter idea",
      content: "",
      tags: [],
      pinned: false,
      order: 0,
      wordCount: 0,
      collapsedHeadings: [],
      bookId: "book-1",
      createdAt: 1,
      updatedAt: 1,
    },
    isLoading: false,
    error: null,
    loadNotes: vi.fn(() => Promise.resolve()),
    loadNote: vi.fn(() => Promise.resolve()),
    createNote: vi.fn(() => Promise.resolve()),
    updateNote: vi.fn(() => Promise.resolve()),
    deleteNote: vi.fn(() => Promise.resolve()),
    reorderNotes: vi.fn(() => Promise.resolve()),
    setCurrentNote: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

vi.mock("../../../features/notes", () => {
  const useNoteStore = (selector: (state: typeof noteState) => unknown) =>
    selector(noteState);
  useNoteStore.getState = () => noteState;
  return { useNoteStore };
});

vi.mock("../../../features/books/store", () => {
  const state = { books: [{ id: "book-1", title: "My Book" }], loadBooks: vi.fn(() => Promise.resolve()) };
  const useBookStore = (selector: (s: typeof state) => unknown) => selector(state);
  return { useBookStore };
});

vi.mock("../../../features/settings/store", () => {
  const state = {
    notesSidebarWidth: 256,
    setNotesSidebarWidth: vi.fn(),
    lastNoteId: null,
    setLastNoteId: vi.fn(),
  };
  const useSettingsStore = (selector: (s: typeof state) => unknown) => selector(state);
  return { useSettingsStore };
});

vi.mock("../../../features/markdown", () => ({
  markdownToEditorHtml: (md: string) => md,
  titleFromMarkdown: (md: string) => md,
}));

vi.mock("../../../components/notes", () => ({
  NotesList: () => <div data-testid="notes-list" />,
  EmptyNotes: () => <div data-testid="empty-notes" />,
  NoteEditor: ({
    returnLabel,
    onReturnToBook,
  }: {
    returnLabel?: string;
    onReturnToBook?: () => void;
  }) => (
    <div>
      <span data-testid="return-label">{returnLabel}</span>
      <button type="button" onClick={onReturnToBook}>
        back-to-book
      </button>
    </div>
  ),
}));

describe("Notes page return-to-book navigation", () => {
  it("passes the return label and navigates to the book on return", async () => {
    render(<Notes />);

    await waitFor(() => {
      expect(screen.getByTestId("return-label")).toHaveTextContent("My Book");
    });

    fireEvent.click(screen.getByRole("button", { name: "back-to-book" }));
    expect(mockNavigate).toHaveBeenCalledWith("/book/book-1");
  });
});
