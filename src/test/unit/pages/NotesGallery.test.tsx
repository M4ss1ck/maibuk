import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { galleryColumnsForWidth, GALLERY_CARD_ESTIMATE, NotesGallery } from "@/pages/NotesGallery";
import { mockRect } from "@/test/support/drag-events";
import {
  mockRowScrollHeight,
  mockVirtualizerLayout,
} from "@/test/support/virtualizer-layout";
import { installArrowNavigation } from "@/lib/arrow-navigation";
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

// The Gallery is virtualized (#562): both sizes and the card height come from
// the browser, which jsdom reports as 0.
let restoreVirtualizerLayout: () => void = () => {};
let restoreRowHeight: () => void = () => {};
beforeAll(() => {
  restoreVirtualizerLayout = mockVirtualizerLayout();
  restoreRowHeight = mockRowScrollHeight(GALLERY_CARD_ESTIMATE);
});
afterAll(() => {
  restoreRowHeight();
  restoreVirtualizerLayout();
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
    // The arrow-navigation module lands on the Gallery, the Pane entry (ADR 0025 rule 7).
    const uninstall = installArrowNavigation();
    render(<NotesGallery />);

    expect(screen.getByRole("grid", { name: "notes.collectionLabel" })).toHaveAttribute(
      "data-focus-pane-entry"
    );
    expect(document.body).toHaveFocus();
    await user.keyboard("{ArrowDown}");

    expect(screen.getAllByRole("row")[0]).toHaveFocus();
    uninstall();
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

  it("marks the gallery as a container and keeps the card grid responsive", () => {
    const { container } = render(<NotesGallery />);

    expect(container.firstElementChild).toHaveClass("@container");
    expect(screen.getByRole("grid")).toHaveAttribute("data-layout", "grid");

    // The same container-query widths the CSS grid used: 2 columns up to
    // @3xl, 3 up to @5xl, then 4.
    expect([767, 768, 1023, 1024].map(galleryColumnsForWidth)).toEqual([2, 3, 3, 4]);
  });

  it("keeps the grid's row positions for the arrow edge rules", () => {
    render(<NotesGallery />);

    const grid = screen.getByRole("grid");
    const rows = screen.getAllByRole("row");
    expect(grid).toHaveAttribute("aria-rowcount", "2");
    expect(rows[0]).toHaveAttribute("aria-rowindex", "1");
    expect(rows[1]).toHaveAttribute("aria-rowindex", "2");
  });

  it("keeps Right on a row's last card and Down on the last row", async () => {
    const user = userEvent.setup();
    noteState.notes = Array.from({ length: 4 }, (_, index) => ({
      id: `n${index}`,
      title: `Note ${index}`,
      bookId: null,
      tags: [],
      content: "",
      pinned: false,
      order: index,
      contentUpdatedAt: index,
      updatedAt: index,
    }));
    const uninstall = installArrowNavigation();
    try {
      render(<NotesGallery />);
      const rows = screen.getAllByRole("row");
      // Two columns, as the measured content box starts at the narrowest one.
      mockRect(rows[0], 0, 176);
      mockRect(rows[1], 0, 176);
      mockRect(rows[2], 192, 368);
      mockRect(rows[3], 192, 368);

      rows[1].focus();
      await user.keyboard("{ArrowRight}");
      expect(rows[1]).toHaveFocus();

      // Down stays inside a grid; at the last row it keeps focus there.
      rows[3].focus();
      await user.keyboard("{ArrowDown}");
      expect(rows[3]).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(rows[3]).toHaveFocus();
    } finally {
      uninstall();
    }
  });

  it("mounts only the cards near the viewport out of 500", () => {
    noteState.notes = Array.from({ length: 500 }, (_, index) => ({
      id: `n${index}`,
      title: `Note ${index}`,
      bookId: null,
      tags: [],
      content: "",
      pinned: false,
      order: index,
      contentUpdatedAt: index,
      updatedAt: index,
    }));
    render(<NotesGallery />);

    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(50);
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "500");
  });

  it("clamps the date picker popover to the viewport", async () => {
    const user = userEvent.setup();
    render(<NotesGallery />);

    await user.click(screen.getByRole("button", { name: "notes.advancedFilters" }));
    await user.click(screen.getByRole("button", { name: "notes.dateFrom" }));

    const popover = screen.getByRole("button", { name: "notes.previousMonth" }).parentElement
      ?.parentElement;
    expect(popover).not.toBeNull();
    expect(popover).toHaveClass("w-72", "max-w-[calc(100vw-2rem)]");
  });
});
