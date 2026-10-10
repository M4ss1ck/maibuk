import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { isEntityChange, onChange, resetChangeFeedForTests, type Change } from "@/features/sync/change-feed";

const { mockGetDatabase, mockReindex, mockToastError } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
  mockReindex: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDatabase: mockGetDatabase }));
vi.mock("@/features/links/link-index", () => ({ reindexSource: mockReindex }));
vi.mock("@/components/ui/Toast", () => ({
  toast: { error: mockToastError, success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/editor/ChapterOutline", () => ({
  ChapterOutline: () => <div data-testid="chapter-outline" />,
}));
vi.mock("@/hooks/useTextFileDrop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useTextFileDrop")>();
  return {
    ...actual,
    useTextFileDrop: () => ({
      isDraggingFile: false,
      isImportingFiles: false,
      dropHandlers: {},
    }),
  };
});
vi.mock("@/features/settings/store", () => {
  const state = {
    language: "en",
    chapterListView: "normal",
    showChapterOutline: false,
    setChapterListView: () => {},
    setShowChapterOutline: () => {},
  };
  const useSettingsStore = (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(state) : state;
  useSettingsStore.getState = () => state;
  return { useSettingsStore };
});
vi.mock("@/lib/platform/detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform/detect")>()),
  isMac: () => false,
}));

import i18n from "@/i18n";
import { ChapterList } from "@/components/editor/ChapterList";
import { useChapterStore } from "@/features/chapters/store";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { DEFAULT_SHORTCUT_SETTINGS } from "@/lib/shortcut-resolve";

let testDb: DatabaseAdapter;
let bookId: string;
let chapterId: string;
let changes: Change[];

async function seed(): Promise<void> {
  const { createBookRow } = await import("@/features/books/write");
  const { createChapterRow } = await import("@/features/chapters/write");
  const book = await createBookRow({ title: "Test Book", authorName: "Test Author" }, "local");
  const chapter = await createChapterRow({ bookId: book.id, title: "Chapter 1" }, "local");
  bookId = book.id;
  chapterId = chapter.id;
  await useChapterStore.getState().loadChapters(book.id);
}

function Harness() {
  const chapters = useChapterStore((s) => s.chapters);
  return (
    <ChapterList
      chapters={chapters}
      currentChapterId={chapters[0]?.id ?? null}
      onSelectChapter={() => {}}
      onCreateChapter={() => {}}
      onUpdateChapter={() => {}}
      onDeleteChapter={() => {}}
      onReorderChapters={() => {}}
      onSetChapterStatus={(id, status) => useChapterStore.getState().updateChapter(id, { status })}
    />
  );
}

async function chapterStatus(id: string): Promise<string> {
  const rows = await testDb.select<{ status: string }[]>(
    "SELECT status FROM chapters WHERE id = ?",
    [id]
  );
  return rows[0].status;
}

async function bookContentUpdatedAt(id: string): Promise<number> {
  const rows = await testDb.select<{ content_updated_at: number }[]>(
    "SELECT content_updated_at FROM books WHERE id = ?",
    [id]
  );
  return rows[0].content_updated_at;
}

async function chapterUpdatedAt(id: string): Promise<number> {
  const rows = await testDb.select<{ updated_at: number }[]>(
    "SELECT updated_at FROM chapters WHERE id = ?",
    [id]
  );
  return rows[0].updated_at;
}

function row(name = "Chapter 1") {
  return screen.getByRole("row", { name });
}

/** Opens the row's Item Menu from its ⋯ button with the keyboard. */
async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
  label = "More actions for Chapter 1"
) {
  const trigger = screen.getByRole("button", { name: label });
  trigger.focus();
  await user.keyboard("{Enter}");
  await screen.findByRole("menu");
  await waitFor(() => expect(screen.getAllByRole("menuitem")[0]).toHaveFocus());
}

describe("Chapter Status from the row's Item Menu", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockReset();
    mockGetDatabase.mockResolvedValue(testDb);
    mockReindex.mockReset().mockResolvedValue(undefined);
    mockToastError.mockReset();
    resetChangeFeedForTests();
    changes = [];
    await i18n.changeLanguage("en");
    useChapterStore.setState({
      chapters: [],
      currentChapter: null,
      currentBookId: null,
      isLoading: false,
      error: null,
    });
    useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
    await seed();
    onChange((signal) => {
      if (isEntityChange(signal)) changes.push(signal);
    });
  });

  afterEach(() => {
    resetChangeFeedForTests();
  });

  it("sets the status by keyboard, emits a metadata Change, and leaves Last Edited alone", async () => {
    const user = userEvent.setup();
    const contentBefore = await bookContentUpdatedAt(bookId);
    render(<Harness />);

    await openMenu(user);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Status" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    const draft = await screen.findByRole("menuitem", { name: "Draft" });
    await waitFor(() => expect(draft).toHaveFocus());
    // Draft is the current Chapter Status, marked by the visible check.
    expect(draft.querySelector("svg")?.getAttribute("class") ?? "").toContain("opacity-100");

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Revised" })).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(async () => expect(await chapterStatus(chapterId)).toBe("revised"));
    expect(row()).toHaveTextContent("Revised");
    expect(await bookContentUpdatedAt(bookId)).toBe(contentBefore);
    expect(changes).toEqual([{ entity: "book", id: bookId, origin: "local", kind: "metadata" }]);
  });

  it("choosing the current status writes nothing", async () => {
    const user = userEvent.setup();
    const updatedBefore = await chapterUpdatedAt(chapterId);
    render(<Harness />);

    await openMenu(user);
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowRight}");
    const draft = await screen.findByRole("menuitem", { name: "Draft" });
    await waitFor(() => expect(draft).toHaveFocus());
    await user.keyboard("{Enter}");

    expect(await chapterUpdatedAt(chapterId)).toBe(updatedBefore);
    expect(await chapterStatus(chapterId)).toBe("draft");
    expect(changes).toEqual([]);
  });

  it("keeps the old status and reports the failure when the write fails", async () => {
    const user = userEvent.setup();
    const original = testDb.execute.bind(testDb);
    vi.spyOn(testDb, "execute").mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("UPDATE chapters SET")) throw new Error("write failed");
      return original(sql, params);
    });
    render(<Harness />);

    await openMenu(user);
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowRight}");
    const draft = await screen.findByRole("menuitem", { name: "Draft" });
    await waitFor(() => expect(draft).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith("Couldn't change the Chapter Status")
    );
    expect(await chapterStatus(chapterId)).toBe("draft");
    expect(row()).toHaveTextContent("Draft");
  });

  it("localizes the row and the menu in Spanish", async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage("es");
    render(<Harness />);

    expect(row()).toHaveTextContent("Borrador");
    await openMenu(user, "Más acciones para Chapter 1");
    expect(screen.getByRole("menuitem", { name: "Estado" })).toBeInTheDocument();

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowDown}");
    const revised = await screen.findByRole("menuitem", { name: "Revisado" });
    await waitFor(() => expect(revised).toHaveFocus());
    await user.keyboard("{Enter}");

    await waitFor(() => expect(row()).toHaveTextContent("Revisado"));
    expect(await chapterStatus(chapterId)).toBe("revised");
  });

  it("runs the status Command from a Custom Shortcut while the row has focus", async () => {
    const user = userEvent.setup();
    useShortcutSettingsStore.setState({
      shortcuts: {
        version: 2,
        voice: {},
        custom: { "chapterItem.setStatusFinal": [["Mod+Shift+x"]] },
        singleKeyEnabled: true,
      },
    });
    render(<Harness />);

    // Keyboard navigation into the grid, not programmatic focus.
    for (let i = 0; i < 20 && !screen.getByRole("grid").contains(document.activeElement); i++) {
      await user.tab();
    }
    expect(screen.getByRole("grid").contains(document.activeElement)).toBe(true);

    await user.keyboard("{Control>}{Shift>}X{/Shift}{/Control}");

    await waitFor(async () => expect(await chapterStatus(chapterId)).toBe("final"));
    expect(row()).toHaveTextContent("Final");
  });
});
