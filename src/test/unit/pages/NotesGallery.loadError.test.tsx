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

const { noteState } = vi.hoisted(() => ({
  noteState: {
    notes: [] as Array<Record<string, unknown>>,
    error: null as string | null,
    loadNotes: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@/features/notes", () => ({
  useNoteStore: (selector: (s: typeof noteState) => unknown) => selector(noteState),
}));

vi.mock("@/features/books/store", () => ({
  useBookStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ books: [], loadBooks: vi.fn(() => Promise.resolve()) }),
}));

import { NotesGallery } from "@/pages/NotesGallery";

describe("NotesGallery when the Library cannot be read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    noteState.error = null;
  });

  it("shows the error instead of the empty state, and Try again reloads by keyboard", async () => {
    noteState.error = "Error: database is locked";
    const user = userEvent.setup();
    render(<NotesGallery />);

    expect(screen.getByRole("alert")).toHaveTextContent("Error: database is locked");
    expect(screen.queryByText("notes.empty")).not.toBeInTheDocument();
    expect(noteState.loadNotes).toHaveBeenCalledTimes(1);

    const retry = screen.getByRole("button", { name: "libraryLoad.retry" });
    while (document.activeElement !== retry) await user.tab();
    await user.keyboard("{Enter}");

    expect(noteState.loadNotes).toHaveBeenCalledTimes(2);
  });

  it("shows the empty state when the Library has no Notes", () => {
    render(<NotesGallery />);

    expect(screen.getByText("notes.empty")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
