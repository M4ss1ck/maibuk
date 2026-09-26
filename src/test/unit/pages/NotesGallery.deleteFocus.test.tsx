import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/platform", () => ({
  IS_ANDROID: false,
  IS_TAURI: false,
  getFileSystem: vi.fn(),
}));

const { mockNavigate, bookState, settingsState } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  bookState: { books: [], loadBooks: vi.fn(() => Promise.resolve()) },
  settingsState: {
    setLastNoteId: vi.fn(),
    lastNoteId: null as string | null,
    notesSort: "date-desc" as const,
    setNotesSort: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }));

vi.mock("../../../features/books/store", () => ({
  useBookStore: (selector: (s: typeof bookState) => unknown) => selector(bookState),
}));

// A real store, so a confirmed Delete actually removes the Note and the
// Gallery re-renders without its card.
vi.mock("../../../features/notes", async () => {
  const { create } = await import("zustand");
  const useNoteStore = create<{
    notes: Array<Record<string, unknown>>;
    loadNotes: () => Promise<void>;
    createNote: (input: Record<string, unknown>) => Promise<{ id: string }>;
    updateNote: (input: Record<string, unknown>) => Promise<null>;
    deleteNote: (id: string) => Promise<void>;
  }>(() => ({
    notes: [],
    loadNotes: async () => {},
    createNote: async () => ({ id: "copy" }),
    updateNote: async () => null,
    deleteNote: async (id) => {
      useNoteStore.setState((state) => ({ notes: state.notes.filter((n) => n.id !== id) }));
    },
  }));
  return { useNoteStore };
});

vi.mock("../../../features/settings/store", async () => {
  const { create } = await import("zustand");
  const { DEFAULT_NOTES_FILTERS } = await import("../../../components/notes/notes-list-model");
  const useSettingsStore = create(() => ({
    ...settingsState,
    notesFilters: DEFAULT_NOTES_FILTERS,
    setNotesFilters: () => {},
    loadBooks: vi.fn(),
  }));
  return { useSettingsStore };
});

const { NotesGallery } = await import("@/pages/NotesGallery");
const { useNoteStore } = await import("../../../features/notes");

const note = (id: string, title: string) => ({
  id,
  title,
  bookId: null,
  tags: [],
  content: "<p>Body</p>",
  language: "en",
  wordCount: 1,
  contentUpdatedAt: 1,
  updatedAt: 1,
  createdAt: 1,
  pinned: false,
  order: 0,
  collapsedHeadings: [],
});

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

describe("NotesGallery delete focus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNoteStore.setState({
      notes: [note("n1", "First"), note("n2", "Second"), note("n3", "Third")],
    });
  });

  const rows = () => screen.getAllByRole("row").filter((item) => item.hasAttribute("data-key"));

  it("returns focus to the card's row when the delete is cancelled", async () => {
    const user = userEvent.setup();
    render(<NotesGallery />);
    const first = rows()[0];

    await openDeleteDialog(user, first);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(first.contains(document.activeElement)).toBe(true));
  });

  it("moves focus to the next card after a confirmed delete", async () => {
    const user = userEvent.setup();
    render(<NotesGallery />);
    const first = rows()[0];

    await openDeleteDialog(user, first);
    await confirmDelete(user);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("First")).not.toBeInTheDocument());
    await waitFor(() => expect(rows()[0].contains(document.activeElement)).toBe(true));
    expect(rows()[0]).toHaveTextContent("Second");
  });

  it("falls back to the create control when the last card is deleted", async () => {
    const user = userEvent.setup();
    useNoteStore.setState({ notes: [note("only", "Only")] });
    render(<NotesGallery />);

    await openDeleteDialog(user, rows()[0]);
    await confirmDelete(user);

    await waitFor(() => expect(screen.queryByText("Only")).not.toBeInTheDocument());
    // The header create control is the first "New note" button in the DOM.
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "notes.newNote" })[0]).toHaveFocus()
    );
  });
});
