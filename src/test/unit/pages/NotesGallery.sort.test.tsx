import { render, screen, waitFor, within } from "@testing-library/react";
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
      { id: "n1", title: "Beta", tags: [], content: "", order: 0, contentUpdatedAt: 300 },
      { id: "n2", title: "Alpha", tags: [], content: "", order: 1, contentUpdatedAt: 100 },
      { id: "n3", title: "Gamma", tags: [], content: "", order: 2, contentUpdatedAt: 200 },
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
  useTranslation: () => ({
    t: (key: string, params?: { sort?: string }) =>
      key === "notes.sortTrigger" ? `Sort notes: ${params?.sort}` : key,
    i18n: { language: "en" },
  }),
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
import { runCommand } from "@/lib/command-runner";

// The Gallery's Sort (#524): the shared SortSelect in its labeled look, four
// Sorts and no Custom, and the Sort Commands act on it.
describe("NotesGallery Sort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ notesFilters: DEFAULT_NOTES_FILTERS, notesSort: "date-desc" });
  });

  const titles = () =>
    screen.getAllByText(/^(Alpha|Beta|Gamma)$/).map((element) => element.textContent);

  it("offers the four Sorts without Custom and reorders the cards by keyboard", async () => {
    const user = userEvent.setup();
    render(<NotesGallery />);
    expect(titles()).toEqual(["Beta", "Gamma", "Alpha"]);

    const trigger = screen.getByRole("button", { name: "Sort notes: notes.sortDateNewest" });
    expect(within(trigger).getByText("notes.sortDateNewest")).toBeInTheDocument();
    trigger.focus();
    await user.keyboard("{Enter}");
    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual([
      "notes.sortTitleAsc",
      "notes.sortTitleDesc",
      "notes.sortDateNewest",
      "notes.sortDateOldest",
    ]);
    await user.keyboard("{Home}{Enter}");

    await waitFor(() => expect(titles()).toEqual(["Alpha", "Beta", "Gamma"]));
    expect(useSettingsStore.getState().notesSort).toBe("title-asc");
  });

  it("runs each Sort Command on the Gallery and leaves Custom unavailable there", async () => {
    render(<NotesGallery />);

    expect(await runCommand("notes.sortTitleDesc", { source: "voice" })).toBe("ran");
    await waitFor(() => expect(titles()).toEqual(["Gamma", "Beta", "Alpha"]));
    expect(await runCommand("notes.sortDateOldest", { source: "palette" })).toBe("ran");
    expect(useSettingsStore.getState().notesSort).toBe("date-asc");
    expect(await runCommand("notes.sortTitleAsc", { source: "palette" })).toBe("ran");
    expect(await runCommand("notes.sortDateNewest", { source: "palette" })).toBe("ran");
    expect(useSettingsStore.getState().notesSort).toBe("date-desc");

    expect(await runCommand("notes.sortCustom", { source: "voice" })).toBe("unavailable");
    expect(useSettingsStore.getState().notesSort).toBe("date-desc");
  });
});
