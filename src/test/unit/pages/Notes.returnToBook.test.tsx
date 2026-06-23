import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notes } from "../../../pages/Notes";

const { mockNavigate, mockLocation, noteState, noteEditorProps } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLocation: {
    state: {
      openNoteId: "n1",
      returnTo: "/book/book-1",
      returnLabel: "My Book",
    } as {
      openNoteId?: string;
      returnTo?: string;
      returnLabel?: string;
      scrollToHeadingId?: string;
    } | null,
    pathname: "/notes",
  },
  noteEditorProps: [] as Array<Record<string, unknown>>,
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
  useParams: () => ({ noteId: "n1" }),
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
  NoteEditor: (props: Record<string, unknown>) => {
    noteEditorProps.push(props);
    return (
      <div>
        <span data-testid="return-label">{props.returnLabel as string}</span>
        <button type="button" onClick={props.onReturnToBook as () => void}>
          back-to-book
        </button>
      </div>
    );
  },
}));

describe("Notes page return-to-book navigation", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    noteEditorProps.length = 0;
    mockLocation.state = {
      openNoteId: "n1",
      returnTo: "/book/book-1",
      returnLabel: "My Book",
    };
  });

  it("passes the return label and navigates to the book on return", async () => {
    render(<Notes />);

    await waitFor(() => {
      expect(screen.getByTestId("return-label")).toHaveTextContent("My Book");
    });

    fireEvent.click(screen.getByRole("button", { name: "back-to-book" }));
    expect(mockNavigate).toHaveBeenCalledWith("/book/book-1");
  });

  it("passes suppressRestore while a note heading deep-link is pending", () => {
    mockLocation.state = { openNoteId: "n1", scrollToHeadingId: "heading-1" };

    render(<Notes />);

    const last = noteEditorProps[noteEditorProps.length - 1];
    expect(last?.suppressRestore).toBe(true);
  });

  it("returns to the book on Backspace when there is a return target", () => {
    render(<Notes />);

    fireEvent.keyDown(document.body, { key: "Backspace" });
    expect(mockNavigate).toHaveBeenCalledWith("/book/book-1");
  });

  it("returns to the gallery on Backspace without a return target", () => {
    mockLocation.state = { openNoteId: "n1" };

    render(<Notes />);

    fireEvent.keyDown(document.body, { key: "Backspace" });
    expect(mockNavigate).toHaveBeenCalledWith("/notes");
  });
});
