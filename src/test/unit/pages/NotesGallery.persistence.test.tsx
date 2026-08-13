import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({
  IS_ANDROID: false,
  IS_TAURI: false,
  IS_DESKTOP: false,
  IS_WEB: false,
  getFileSystem: vi.fn(),
  getOS: vi.fn(),
}));

const { mockNavigate, noteState, bookState } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  noteState: {
    notes: [
      { id: "n1", title: "First", bookId: null, tags: [], content: "", order: 0 },
      { id: "n2", title: "Second", bookId: null, tags: [], content: "", order: 1 },
    ] as Array<Record<string, unknown>>,
    loadNotes: vi.fn(() => Promise.resolve()),
    createNote: vi.fn(() => Promise.resolve({ id: "n3" })),
  },
  bookState: {
    books: [],
    loadBooks: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/features/notes", () => ({
  useNoteStore: (selector: (s: typeof noteState) => unknown) => selector(noteState),
}));

vi.mock("@/features/books/store", () => ({
  useBookStore: (selector: (s: typeof bookState) => unknown) => selector(bookState),
}));

import { NotesGallery } from "@/pages/NotesGallery";
import { useSettingsStore } from "@/features/settings/store";
import { DEFAULT_NOTES_FILTERS } from "@/components/notes/notes-list-model";

describe("NotesGallery filter persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ notesFilters: DEFAULT_NOTES_FILTERS });
  });

  it("keeps the search query when the page is left and reopened", async () => {
    const user = userEvent.setup();
    const first = render(<NotesGallery />);

    await user.type(screen.getByPlaceholderText("notes.search"), "Second");
    expect(screen.getByPlaceholderText("notes.search")).toHaveValue("Second");

    first.unmount();
    render(<NotesGallery />);

    expect(screen.getByPlaceholderText("notes.search")).toHaveValue("Second");
  });

  it("keeps the advanced filter panel open when the page is left and reopened", async () => {
    const user = userEvent.setup();
    const first = render(<NotesGallery />);

    await user.click(screen.getByRole("button", { name: /notes.advancedFilters/i }));
    expect(screen.getByText("notes.dateFrom")).toBeInTheDocument();

    first.unmount();
    render(<NotesGallery />);

    expect(screen.getByText("notes.dateFrom")).toBeInTheDocument();
  });
});
