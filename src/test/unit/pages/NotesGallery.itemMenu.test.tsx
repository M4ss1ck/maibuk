import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPointerEvent, touchLongPress } from "@/test/support/pointer-events";

installPointerEvent();

vi.mock("../../../lib/platform", () => ({
  IS_ANDROID: false,
  IS_TAURI: false,
  getFileSystem: vi.fn(),
}));

const { mockNavigate, noteState, bookState, settingsState } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  noteState: {
    notes: [] as Array<Record<string, unknown>>,
    loadNotes: vi.fn(() => Promise.resolve()),
    createNote: vi.fn(() => Promise.resolve({ id: "copy" })),
    updateNote: vi.fn(() => Promise.resolve(null)),
    deleteNote: vi.fn(() => Promise.resolve()),
  },
  bookState: {
    books: [{ id: "book-1", title: "My Book", language: "es" }],
    loadBooks: vi.fn(() => Promise.resolve()),
  },
  settingsState: {
    setLastNoteId: vi.fn(),
    lastNoteId: "n1" as string | null,
    notesSort: "date-desc" as const,
    setNotesSort: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }));

vi.mock("../../../features/notes", () => ({
  useNoteStore: (selector: (s: typeof noteState) => unknown) => selector(noteState),
}));

vi.mock("../../../features/books/store", () => ({
  useBookStore: (selector: (s: typeof bookState) => unknown) => selector(bookState),
}));

vi.mock("../../../features/settings/store", async () => {
  const { create } = await import("zustand");
  const { DEFAULT_NOTES_FILTERS } = await import("../../../components/notes/notes-list-model");
  const useSettingsStore = create(() => ({
    ...settingsState,
    notesFilters: DEFAULT_NOTES_FILTERS,
    setNotesFilters: vi.fn(),
  }));
  return { useSettingsStore };
});

const { NotesGallery } = await import("@/pages/NotesGallery");

const note = (id: string, title: string, bookId: string | null) => ({
  id,
  title,
  bookId,
  tags: [],
  content: "<p>Body</p>",
  language: "en",
  wordCount: 1,
  contentUpdatedAt: 1,
  updatedAt: 1,
  createdAt: 1,
  pinned: false,
  order: 0,
});

describe("Notes gallery Item Menu (how phones reach note actions)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    noteState.notes = [note("n1", "First", "book-1"), note("n2", "Second", null)];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the ⋯ button on touch screens only, so the desktop card is unchanged", () => {
    render(<NotesGallery />);

    for (const button of screen.getAllByRole("button", { name: "common.moreActionsFor" })) {
      expect(button).toHaveClass("hidden", "pointer-coarse:inline-flex");
    }
  });

  it("opens on touch long-press without opening the note", () => {
    vi.useFakeTimers();
    render(<NotesGallery />);

    touchLongPress(screen.getByText("Second"));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("deletes only after confirmation and forgets it as the last opened note", async () => {
    const user = userEvent.setup();
    render(<NotesGallery />);

    const first = screen.getAllByRole("row")[0];
    await user.click(within(first).getByRole("button", { name: "common.moreActionsFor" }));
    await user.click(await screen.findByRole("menuitem", { name: "common.delete" }));
    await screen.findByRole("dialog", { name: "notes.deleteConfirm" });
    expect(noteState.deleteNote).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "notes.delete" }));

    await waitFor(() => expect(noteState.deleteNote).toHaveBeenCalledWith("n1"));
    await waitFor(() => expect(settingsState.setLastNoteId).toHaveBeenCalledWith(null));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("moves a note to a Book by keyboard, taking the Book's language", async () => {
    const user = userEvent.setup();
    render(<NotesGallery />);

    const second = screen.getAllByRole("row")[1];
    await user.click(within(second).getByRole("button", { name: "common.moreActionsFor" }));
    const move = await screen.findByRole("menuitem", { name: "notes.moveToBook" });
    while (document.activeElement !== move) await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "notes.unfiled" })).toHaveFocus()
    );
    await user.keyboard("{ArrowDown}{Enter}");

    expect(noteState.updateNote).toHaveBeenCalledWith({
      id: "n2",
      bookId: "book-1",
      language: "es",
    });
  });

  it("duplicates a note", async () => {
    const user = userEvent.setup();
    render(<NotesGallery />);

    await user.click(screen.getAllByRole("button", { name: "common.moreActionsFor" })[0]);
    await user.click(await screen.findByRole("menuitem", { name: "notes.duplicate" }));

    expect(noteState.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ title: "First (copy)", bookId: "book-1" })
    );
  });
});
