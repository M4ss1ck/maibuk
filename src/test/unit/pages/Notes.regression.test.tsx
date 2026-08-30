import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";

vi.mock("../../../i18n", () => ({
  default: { language: "en", changeLanguage: vi.fn() },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("../../../lib/db", () => ({ getDatabase: mockGetDatabase }));

vi.mock("@/components/notes", () => ({
  NotesList: () => <div>list</div>,
  NoteEditor: ({ note }: { note: { id: string } }) => <div data-testid="editor">{note.id}</div>,
  EmptyNotes: () => <div>empty</div>,
}));

describe("Notes repeated heading regression (behavioral)", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  let origGetById: typeof document.getElementById;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDatabase.mockResolvedValue({
      select: vi.fn(async () => []),
      execute: vi.fn(async () => ({ rowsAffected: 0 })),
    } as never);
    origGetById = document.getElementById.bind(document);
  });

  afterEach(() => {
    if (spy) spy.mockRestore();
    document.getElementById = origGetById;
  });

  it("same-note heading navigations with new state both scroll", async () => {
    const { useNoteStore } = await import("@/features/notes/store");
    const { useBookStore } = await import("@/features/books/store");
    const { useSettingsStore } = await import("@/features/settings/store");

    const note = {
      id: "n1",
      title: "Note",
      content: '<h1 id="h-1">A</h1><h1 id="h-2">B</h1>',
      bookId: null,
      language: "en",
      tags: [],
      pinned: false,
      order: 0,
      wordCount: 0,
      collapsedHeadings: [],
      createdAt: 0,
      updatedAt: 0,
      contentUpdatedAt: 0,
    } as never;

    useNoteStore.setState({
      notes: [note],
      currentNote: note,
      isLoading: false,
      error: null,
      loadNotes: vi.fn(async () => {}),
      loadNote: vi.fn(async (_id: string) => {
        useNoteStore.setState({ currentNote: note });
      }),
      createNote: vi.fn(async () => note),
      updateNote: vi.fn(async () => {}),
      deleteNote: vi.fn(async () => {}),
      reorderNotes: vi.fn(async () => {}),
      setCurrentNote: vi.fn(),
      saveCollapsedHeadings: vi.fn(async () => {}),
    } as never);

    useBookStore.setState({
      books: [],
      currentBook: null,
      isLoading: false,
      error: null,
      loadBooks: vi.fn(async () => {}),
      loadBook: vi.fn(async () => {}),
      createBook: vi.fn(async () => ({}) as never),
      updateBook: vi.fn(async () => {}),
      deleteBook: vi.fn(async () => {}),
      updateWordCount: vi.fn(async () => {}),
    } as never);

    useSettingsStore.setState({
      notesSidebarWidth: 280,
      lastNoteId: null,
      setLastNoteId: vi.fn(),
    } as never);

    const scrollSpy = vi.fn();
    spy = vi.spyOn(document, "getElementById").mockImplementation((id: string) => {
      if (id === "h-1" || id === "h-2") {
        return { scrollIntoView: scrollSpy } as unknown as HTMLElement;
      }
      return origGetById(id);
    });

    const { Notes } = await import("@/pages/Notes");

    function NavHelper() {
      const nav = useNavigate();
      return (
        <button
          type="button"
          onClick={() => nav("/notes/n1", { state: { scrollToHeadingId: "h-2" } })}
        >
          go h2
        </button>
      );
    }

    render(
      <MemoryRouter
        initialEntries={[{ pathname: "/notes/n1", state: { scrollToHeadingId: "h-1" } }]}
      >
        <Routes>
          <Route path="/notes/:noteId" element={<Notes />} />
        </Routes>
        <NavHelper />
      </MemoryRouter>
    );

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled(), { timeout: 2000 });
    expect(scrollSpy).toHaveBeenCalled();
    scrollSpy.mockClear();

    screen.getByText("go h2").click();

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled(), { timeout: 2000 });
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("same-note heading navigation does not re-fetch note (loadNote only on noteId)", async () => {
    const { useNoteStore } = await import("@/features/notes/store");
    const { useBookStore } = await import("@/features/books/store");
    const { useSettingsStore } = await import("@/features/settings/store");

    const note = {
      id: "n1",
      title: "Note",
      content: '<h1 id="h-1">A</h1><h1 id="h-2">B</h1>',
      bookId: null,
      language: "en",
      tags: [],
      pinned: false,
      order: 0,
      wordCount: 0,
      collapsedHeadings: [],
      createdAt: 0,
      updatedAt: 0,
      contentUpdatedAt: 0,
    } as never;

    const loadNoteSpy = vi.fn(async (_id: string) => {
      useNoteStore.setState({ currentNote: note });
    });

    useNoteStore.setState({
      notes: [note],
      currentNote: note,
      isLoading: false,
      error: null,
      loadNotes: vi.fn(async () => {}),
      loadNote: loadNoteSpy,
      createNote: vi.fn(async () => note),
      updateNote: vi.fn(async () => {}),
      deleteNote: vi.fn(async () => {}),
      reorderNotes: vi.fn(async () => {}),
      setCurrentNote: vi.fn(),
      saveCollapsedHeadings: vi.fn(async () => {}),
    } as never);

    useBookStore.setState({
      books: [],
      currentBook: null,
      isLoading: false,
      error: null,
      loadBooks: vi.fn(async () => {}),
      loadBook: vi.fn(async () => {}),
      createBook: vi.fn(async () => ({}) as never),
      updateBook: vi.fn(async () => {}),
      deleteBook: vi.fn(async () => {}),
      updateWordCount: vi.fn(async () => {}),
    } as never);

    useSettingsStore.setState({
      notesSidebarWidth: 280,
      lastNoteId: null,
      setLastNoteId: vi.fn(),
    } as never);

    const scrollSpy = vi.fn();
    spy = vi.spyOn(document, "getElementById").mockImplementation((id: string) => {
      if (id === "h-1" || id === "h-2") {
        return { scrollIntoView: scrollSpy } as unknown as HTMLElement;
      }
      return origGetById(id);
    });

    const { Notes } = await import("@/pages/Notes");

    function NavHelper2() {
      const nav = useNavigate();
      return (
        <button type="button" onClick={() => nav("/notes/n1", { state: { scrollToHeadingId: "h-2" } })}>
          go h2
        </button>
      );
    }

    render(
      <MemoryRouter initialEntries={[{ pathname: "/notes/n1", state: { scrollToHeadingId: "h-1" } }]}>
        <Routes>
          <Route path="/notes/:noteId" element={<Notes />} />
        </Routes>
        <NavHelper2 />
      </MemoryRouter>
    );

    await waitFor(() => expect(loadNoteSpy).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled(), { timeout: 2000 });
    scrollSpy.mockClear();

    screen.getByText("go h2").click();

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled(), { timeout: 2000 });
    // loadNote must not have been called again - only scroll effect ran
    expect(loadNoteSpy).toHaveBeenCalledTimes(1);
  });
});
