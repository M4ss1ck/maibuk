import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useBoundShortcutStore } from "@/lib/bound-shortcuts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notes } from "@/pages/Notes";
import { useNoteStore } from "../../../features/notes";

const { mockNavigate, mockLocation, noteEditorProps } = vi.hoisted(() => ({
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

vi.mock("../../../features/notes", async () => {
  // A real, reactive store so selecting another note re-renders the page the
  // same way the shipped store does.
  const { create } = await import("zustand");
  const buildNote = (id: string, title: string, bookId: string | null) => ({
    id,
    title,
    content: "",
    tags: [],
    pinned: false,
    order: 0,
    wordCount: 0,
    collapsedHeadings: [],
    bookId,
    createdAt: 1,
    updatedAt: 1,
  });
  const firstNote = buildNote("n1", "Chapter idea", "book-1");
  const secondNote = buildNote("n2", "Second idea", null);
  const useNoteStore = create<Record<string, unknown>>((set) => ({
    notes: [firstNote, secondNote],
    currentNote: firstNote,
    isLoading: false,
    error: null,
    loadNotes: vi.fn(() => Promise.resolve()),
    loadNote: vi.fn(() => Promise.resolve()),
    createNote: vi.fn(() => Promise.resolve(firstNote)),
    updateNote: vi.fn(() => Promise.resolve()),
    deleteNote: vi.fn(() => Promise.resolve()),
    reorderNotes: vi.fn(() => Promise.resolve()),
    setCurrentNote: (note: unknown) => set({ currentNote: note }),
    saveCollapsedHeadings: vi.fn(() => Promise.resolve()),
  }));
  return { useNoteStore };
});

vi.mock("../../../features/books/store", () => {
  const state = {
    books: [{ id: "book-1", title: "My Book" }],
    loadBooks: vi.fn(() => Promise.resolve()),
  };
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

vi.mock("../../../components/notes", async () => {
  // Mirrors the real NoteEditor contract for `titleBarContainer`: undefined
  // keeps the bar inline, null renders none, an element portals into it.
  const { createPortal } = await import("react-dom");
  return {
    NotesList: (props: {
      notes?: Array<{ id: string; title: string }>;
      onSelectNote?: (note: unknown) => void;
    }) => (
      <div data-testid="notes-list">
        {(props.notes ?? []).map((note) => (
          <button
            key={note.id}
            type="button"
            data-testid={`select-${note.id}`}
            onClick={() => props.onSelectNote?.(note)}
          >
            {note.title}
          </button>
        ))}
      </div>
    ),
    EmptyNotes: () => <div data-testid="empty-notes" />,
    NoteEditor: (props: Record<string, unknown>) => {
      noteEditorProps.push(props);
      const container = props.titleBarContainer as HTMLElement | null | undefined;
      const titleBar = (
        // biome-ignore lint/a11y/useAriaPropsSupportedByRole: a top-level <header> is the banner landmark, which takes aria-label; Biome cannot infer the role.
        <header data-focus-pane="note-title-bar" tabIndex={-1} aria-label="panes.noteTitleBar">
          <button type="button" onClick={props.onReturnToBook as () => void}>
            back-to-book
          </button>
          <span data-testid="return-label">{props.returnLabel as string}</span>
          <span data-testid="title-bar-title">
            {(props.note as { title?: string } | undefined)?.title}
          </span>
        </header>
      );
      if (container === undefined) return titleBar;
      if (container === null) return null;
      return createPortal(titleBar, container);
    },
  };
});

function boundIds() {
  return Object.keys(useBoundShortcutStore.getState().counts);
}

describe("Notes page return-to-book navigation", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    noteEditorProps.length = 0;
    mockLocation.state = {
      openNoteId: "n1",
      returnTo: "/book/book-1",
      returnLabel: "My Book",
    };
    // The store is a module singleton; put the first note back each test.
    useNoteStore.setState({ currentNote: useNoteStore.getState().notes[0] });
  });

  it("passes the return label and navigates to the book on return", async () => {
    const { container } = render(<Notes />);

    await waitFor(() => {
      expect(screen.getByTestId("return-label")).toHaveTextContent("My Book");
    });

    fireEvent.click(screen.getByRole("button", { name: "back-to-book" }));
    expect(mockNavigate).toHaveBeenCalledWith("/book/book-1");
    expect(container.querySelector('[data-focus-pane="notes-sidebar"]')).toHaveAccessibleName(
      "panes.notesSidebar"
    );
    expect(container.querySelector('[data-focus-pane="notes-content"]')).toHaveAccessibleName(
      "panes.notesContent"
    );
    expect(container.querySelectorAll("main")).toHaveLength(1);
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

  it("lists Backspace as the way back while the Notes screen is open", () => {
    mockLocation.state = { openNoteId: "n1" };

    render(<Notes />);

    expect(boundIds()).toContain("common.back");
  });

  it("returns to the gallery on Backspace without a return target", () => {
    mockLocation.state = { openNoteId: "n1" };

    render(<Notes />);

    fireEvent.keyDown(document.body, { key: "Backspace" });
    expect(mockNavigate).toHaveBeenCalledWith("/notes");
  });

  it("renders the note title bar above the notes list and outside the editor", async () => {
    const { container } = render(<Notes />);

    await waitFor(() =>
      expect(container.querySelector('[data-focus-pane="note-title-bar"]')).not.toBeNull()
    );

    const titleBar = container.querySelector<HTMLElement>('[data-focus-pane="note-title-bar"]');
    const content = container.querySelector<HTMLElement>('[data-focus-pane="notes-content"]');
    const sidebar = container.querySelector<HTMLElement>('[data-focus-pane="notes-sidebar"]');

    expect(titleBar?.tagName).toBe("HEADER");
    expect(titleBar).toHaveAccessibleName("panes.noteTitleBar");
    // The bar left the editor pane and sits before the notes list.
    expect(content?.contains(titleBar as Node)).toBe(false);
    expect(
      (titleBar as Node).compareDocumentPosition(sidebar as Node) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // The mock's back control stands in for NoteEditor's Back button.
    expect(
      within(titleBar as HTMLElement).getByRole("button", { name: "back-to-book" })
    ).toBeInTheDocument();
  });

  it("keeps the Notes list mounted when switching notes and updates the title bar", async () => {
    render(<Notes />);

    await waitFor(() =>
      expect(document.querySelector('[data-focus-pane="note-title-bar"]')).not.toBeNull()
    );

    const list = screen.getByTestId("notes-list");
    expect(screen.getByTestId("title-bar-title")).toHaveTextContent("Chapter idea");

    fireEvent.click(screen.getByTestId("select-n2"));

    await waitFor(() =>
      expect(screen.getByTestId("title-bar-title")).toHaveTextContent("Second idea")
    );
    // The note switch must not remount the Notes list.
    expect(screen.getByTestId("notes-list")).toBe(list);
  });
});
