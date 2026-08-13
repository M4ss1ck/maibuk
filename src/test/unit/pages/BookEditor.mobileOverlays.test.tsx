import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { runTopBackDismiss } from "@/lib/platform/backDismiss";

const { mockNavigateFn, mockUpdateChapter } = vi.hoisted(() => ({
  mockNavigateFn: vi.fn(),
  mockUpdateChapter: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ bookId: "book-1" }),
  useNavigate: () => mockNavigateFn,
  useLocation: () => ({ state: null, pathname: "/book/book-1" }),
}));

vi.mock("../../../lib/shortcuts", () => ({ useShortcuts: vi.fn() }));

vi.mock("../../../lib/platform", () => ({
  IS_ANDROID: false,
  IS_TAURI: false,
  IS_DESKTOP: false,
  isMac: () => false,
}));

vi.mock("../../../hooks/useAutoSave", () => ({
  useDebouncedCallback: (callback: (...args: unknown[]) => void) => callback,
}));

vi.mock("../../../features/books/store", () => ({
  useBookStore: () => ({
    currentBook: {
      id: "book-1",
      title: "Draft",
      authorName: "Author",
      language: "en",
      wordCount: 0,
      status: "draft",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    },
    isLoading: false,
    loadBook: vi.fn(),
    updateWordCount: vi.fn(),
    updateBook: vi.fn(),
    deleteBook: vi.fn(),
  }),
}));

vi.mock("../../../features/chapters/store", () => ({
  useChapterStore: () => ({
    chapters: [],
    currentBookId: "book-1",
    isLoading: false,
    currentChapter: {
      id: "c1",
      title: "Ch1",
      content: "<p>x</p>",
      wordCount: 1,
      order: 0,
      chapterType: "chapter",
    },
    loadChapters: vi.fn(),
    createChapter: vi.fn(),
    updateChapter: mockUpdateChapter,
    deleteChapter: vi.fn(),
    reorderChapters: vi.fn(),
    setCurrentChapter: vi.fn(),
  }),
}));

vi.mock("../../../features/settings/store", () => ({
  useSettingsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      sidebarWidth: 256,
      setSidebarWidth: vi.fn(),
      notesSidebarWidth: 256,
      setNotesSidebarWidth: vi.fn(),
      showInlineFootnotes: true,
      showNotesChapter: false,
      setShowNotesChapter: vi.fn(),
      bookSidePanelTab: "footnotes",
      setBookSidePanelTab: vi.fn(),
      hideKeyboardHints: true,
      setHideKeyboardHints: vi.fn(),
      alwaysOnTop: false,
      setAlwaysOnTop: vi.fn(),
    }),
}));

vi.mock("../../../features/versions/useAutoCheckpoint", () => ({
  useAutoCheckpoint: vi.fn(),
}));

vi.mock("../../../features/versions/store", () => ({
  useVersionStore: { getState: () => ({ createVersion: vi.fn() }) },
}));

vi.mock("../../../features/notes", () => ({
  useNoteStore: Object.assign(
    (selector?: (s: any) => any) => {
      const state = { notes: [], loadNotes: vi.fn(), createNote: vi.fn() };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ currentNote: null }) }
  ),
}));

vi.mock("../../../features/theme", () => ({
  useThemeStore: (selector: (s: { theme: string; setTheme: () => void }) => unknown) =>
    selector({ theme: "light", setTheme: vi.fn() }),
  getCycledTheme: vi.fn(),
}));

vi.mock("../../../features/sync/store", () => ({
  useSyncStore: {
    getState: () => ({
      authStatus: "logged-out",
      syncStatus: "idle",
      syncSingleBook: vi.fn(),
      syncSingleNote: vi.fn(),
      syncAll: vi.fn(),
    }),
  },
}));

vi.mock("../../../features/sync/crypto", () => ({ getPassphrase: () => "passphrase" }));
vi.mock("../../../hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../hooks")>();
  return { ...actual, useActiveShortcuts: () => [] };
});
vi.mock("../../../components/ShortcutsHelpDialog", () => ({ ShortcutsHelpDialog: () => null }));

vi.mock("../../../lib/metrics/MetricsService", () => ({
  metricsService: { endSession: vi.fn(), flushNow: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../../../lib/db", () => ({
  getDatabase: vi.fn(),
}));

vi.mock("../../../components/editor", () => ({
  ChapterList: () => <div data-testid="chapter-list" />,
  Editor: () => <div data-testid="editor" />,
  SaveStatus: () => null,
}));
vi.mock("../../../components/book/BookSidePanel", () => ({
  BookSidePanel: () => null,
}));
vi.mock("../../../components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">theme</button>,
}));
vi.mock("../../../components/export", () => ({ ExportDialog: () => null }));
vi.mock("../../../components/book/BookSettingsDialog", () => ({
  BookSettingsDialog: () => null,
}));
vi.mock("../../../components/sync/SyncStatusButton", () => ({
  SyncStatusButton: () => <button type="button">sync</button>,
}));
vi.mock("../../../components/versions/VersionPanel", () => ({ VersionPanel: () => null }));
vi.mock("../../../components/versions/HistoryMenuButton", () => ({
  HistoryMenuButton: () => <button type="button">history</button>,
}));

import { BookEditor } from "@/pages/BookEditor";

describe("BookEditor mobile overlays", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
  });

  it("closes the More menu on Escape without opening the chapters drawer and restores focus", async () => {
    const user = userEvent.setup();
    render(<BookEditor />);

    const moreButton = screen.getByRole("button", { name: "common.more" });
    moreButton.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("nav.exportBook")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByText("nav.exportBook")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mobile-chapters-backdrop")).not.toBeInTheDocument();
    expect(moreButton).toHaveFocus();
  });

  it("traps Tab inside the chapters drawer, closes it on Escape, and restores focus", async () => {
    const user = userEvent.setup();
    const { container } = render(<BookEditor />);

    const chaptersButton = screen.getByRole("button", { name: "chapters.title" });
    chaptersButton.focus();
    await user.keyboard("{Enter}");

    const panes = container.querySelectorAll<HTMLElement>('[data-focus-pane="chapters"]');
    await waitFor(() => expect(panes[0]).toHaveFocus());
    expect(panes[0]).toHaveClass("translate-x-0");
    expect(screen.getByTestId("mobile-chapters-backdrop")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "chapters.title" })).toBeInTheDocument();

    const drawer = panes[0];
    await user.tab();
    expect(drawer.contains(document.activeElement)).toBe(true);
    await user.tab();
    expect(drawer.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(panes[0]).not.toHaveClass("translate-x-0"));
    expect(screen.queryByTestId("mobile-chapters-backdrop")).not.toBeInTheDocument();
    expect(chaptersButton).toHaveFocus();
  });

  it("never keeps the More menu and the chapters drawer open together", async () => {
    const user = userEvent.setup();
    const { container } = render(<BookEditor />);

    const moreButton = screen.getByRole("button", { name: "common.more" });
    moreButton.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("nav.exportBook")).toBeInTheDocument();

    const chaptersButton = screen.getByRole("button", { name: "chapters.title" });
    await user.click(chaptersButton);
    expect(screen.queryByText("nav.exportBook")).not.toBeInTheDocument();
    expect(screen.getByTestId("mobile-chapters-backdrop")).toBeInTheDocument();

    const panes = container.querySelectorAll<HTMLElement>('[data-focus-pane="chapters"]');
    await waitFor(() => expect(panes[0]).toHaveFocus());
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByTestId("mobile-chapters-backdrop")).not.toBeInTheDocument()
    );

    moreButton.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("nav.exportBook")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-chapters-backdrop")).not.toBeInTheDocument();
  });

  it("dismisses the chapters drawer via the backdrop and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<BookEditor />);

    const chaptersButton = screen.getByRole("button", { name: "chapters.title" });
    chaptersButton.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("mobile-chapters-backdrop")).toBeInTheDocument());

    await user.click(screen.getByTestId("mobile-chapters-backdrop"));

    expect(screen.queryByTestId("mobile-chapters-backdrop")).not.toBeInTheDocument();
    expect(chaptersButton).toHaveFocus();
  });

  it("closes the chapters drawer via the Android back handler and cleans up its dismisser", async () => {
    const user = userEvent.setup();
    render(<BookEditor />);

    const chaptersButton = screen.getByRole("button", { name: "chapters.title" });
    chaptersButton.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("mobile-chapters-backdrop")).toBeInTheDocument());

    let handled = false;
    act(() => {
      handled = runTopBackDismiss();
    });
    expect(handled).toBe(true);
    expect(screen.queryByTestId("mobile-chapters-backdrop")).not.toBeInTheDocument();

    await waitFor(() => expect(runTopBackDismiss()).toBe(false));
  });

  it("keeps the closed drawer hidden and exposes it as a dialog only while open", async () => {
    const user = userEvent.setup();
    const { container } = render(<BookEditor />);

    const drawer = container.querySelector<HTMLElement>('[data-focus-pane="chapters"]');
    expect(drawer).not.toBeNull();
    expect(drawer).toHaveClass("invisible");
    expect(drawer).toHaveAttribute("inert");
    expect(drawer).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("dialog", { name: "chapters.title" })).not.toBeInTheDocument();

    const chaptersButton = screen.getByRole("button", { name: "chapters.title" });
    chaptersButton.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(drawer).toHaveFocus());

    expect(drawer).not.toHaveClass("invisible");
    expect(drawer).not.toHaveAttribute("inert");
    expect(drawer).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("dialog", { name: "chapters.title" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(drawer).toHaveClass("invisible"));
    expect(drawer).toHaveAttribute("inert");
    expect(drawer).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("dialog", { name: "chapters.title" })).not.toBeInTheDocument();
    expect(chaptersButton).toHaveFocus();
  });
});
