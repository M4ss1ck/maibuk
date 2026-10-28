import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GALLERY_CARD_ESTIMATE, NotesGallery } from "@/pages/NotesGallery";
import { DEFAULT_NOTES_FILTERS } from "@/components/notes/notes-list-model";
import { useSettingsStore } from "@/features/settings/store";
import { mockVirtualizer } from "@/test/support/virtualizer-layout";

vi.mock("../../../lib/platform", () => ({
  IS_ANDROID: false,
  IS_TAURI: false,
  getFileSystem: vi.fn(),
  getOS: vi.fn(async () => ({ locale: vi.fn(async () => "en") })),
}));

const { mockNavigate, noteState, bookState } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  noteState: {
    notes: [] as Array<Record<string, unknown>>,
    loadNotes: vi.fn(() => Promise.resolve()),
    createNote: vi.fn(() => Promise.resolve({ id: "n3" })),
  },
  bookState: {
    books: [],
    loadBooks: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number }) => {
      if (key === "notes.advancedFilters") return "Filters";
      if (key === "notes.filtersActive") return `Filters, ${params?.count ?? 0} active`;
      return key;
    },
    i18n: { language: "en" },
  }),
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

vi.mock("../../../components/notes", async () => {
  const { GridListItem } = await import("react-aria-components/GridList");
  return {
    NoteCard: ({ note, onClick }: { note: { id: string; title: string }; onClick: () => void }) => (
      <GridListItem id={note.id} textValue={note.title} onPress={onClick}>
        {note.title}
      </GridListItem>
    ),
  };
});

let restoreVirtualizer: () => void = () => {};
beforeAll(() => {
  restoreVirtualizer = mockVirtualizer({ rowHeight: GALLERY_CARD_ESTIMATE });
});
afterAll(() => restoreVirtualizer());

function note(id: string, tags: string[]): Record<string, unknown> {
  return {
    id,
    title: id,
    bookId: null,
    tags,
    content: "",
    language: "en",
    pinned: false,
    order: 0,
    wordCount: 0,
    collapsedHeadings: [],
    createdAt: 1,
    updatedAt: 1,
    contentUpdatedAt: 1,
  };
}

describe("NotesGallery Filters button", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useSettingsStore.setState({ notesFilters: DEFAULT_NOTES_FILTERS, notesSort: "date-desc" });
    noteState.notes = [note("a", ["Work"]), note("b", ["Task"])];
  });

  it("names the button after the two active criteria", () => {
    useSettingsStore.setState({
      notesFilters: { ...DEFAULT_NOTES_FILTERS, tags: ["Work"], excludeTags: ["Task"] },
    });
    render(<NotesGallery />);

    expect(screen.getByRole("button", { name: "Filters, 2 active" })).toBeInTheDocument();
    // The visible text stays "Filters".
    expect(screen.getByText("Filters")).toBeInTheDocument();
  });

  it("keeps the plain name while no criterion is set", () => {
    render(<NotesGallery />);

    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
  });
});
