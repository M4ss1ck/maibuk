import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Chapter PDF warns before it starts when the built-in fonts cannot render
// the text (issue #706), and the export that follows renders the text that was
// checked, never a re-read of the editor. The harness mirrors
// BookEditor.shortcuts.test.tsx, whose mocked Editor takes onExportPdf.

const { mockGenerateDocumentPdf, mockSaveBinaryFile } = vi.hoisted(() => ({
  mockGenerateDocumentPdf: vi.fn(),
  mockSaveBinaryFile: vi.fn(),
}));

vi.mock("@/features/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/export")>()),
  saveBinaryFile: mockSaveBinaryFile,
}));

vi.mock("@/features/export/document-pdf", () => ({
  generateDocumentPdf: mockGenerateDocumentPdf,
}));

const POLISH = "Zażółć gęślą jaźń";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string) => key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ bookId: "book-1" }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: "/book/book-1" }),
}));

vi.mock("@/lib/shortcuts", () => ({
  useShortcuts: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({
  IS_ANDROID: false,
  IS_TAURI: false,
  IS_DESKTOP: false,
  IS_WEB: true,
  isMac: () => false,
  getOS: async () => ({ locale: async () => "en" }),
}));

vi.mock("@/hooks/useAutoSave", () => ({
  useDebouncedCallback: (callback: (...args: unknown[]) => void) => callback,
}));

vi.mock("@/features/books/store", () => ({
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

let chapterContent = "<p>Initial</p>";

vi.mock("@/features/chapters/store", () => ({
  useChapterStore: () => ({
    chapters: [],
    currentBookId: "book-1",
    isLoading: false,
    currentChapter: {
      id: "c1",
      title: "Ch1",
      content: chapterContent,
      wordCount: 1,
      order: 0,
      chapterType: "chapter",
    },
    loadChapters: vi.fn(),
    createChapter: vi.fn(),
    updateChapter: vi.fn().mockResolvedValue(undefined),
    deleteChapter: vi.fn(),
    reorderChapters: vi.fn(),
    setCurrentChapter: vi.fn(),
  }),
}));

vi.mock("@/features/settings/store", () => ({
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

vi.mock("@/features/versions/useAutoCheckpoint", () => ({
  useAutoCheckpoint: vi.fn(),
}));

vi.mock("@/features/versions/store", () => ({
  useVersionStore: { getState: () => ({ createVersion: vi.fn() }) },
}));

vi.mock("@/features/notes", () => ({
  useNoteStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = { notes: [], loadNotes: vi.fn(), createNote: vi.fn() };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ currentNote: null }) }
  ),
}));

vi.mock("@/features/theme", () => ({
  useThemeStore: (selector: (s: { theme: string; setTheme: () => void }) => unknown) =>
    selector({ theme: "light", setTheme: vi.fn() }),
  getCycledTheme: vi.fn(),
}));

vi.mock("@/features/sync/store", () => ({
  useSyncStore: {
    getState: () => ({
      authStatus: "logged-in",
      syncStatus: "idle",
      syncSingleBook: vi.fn(),
      syncSingleNote: vi.fn(),
      syncAll: vi.fn(),
    }),
  },
}));

vi.mock("@/features/sync/crypto", () => ({ getPassphrase: () => "passphrase" }));
vi.mock("@/components/ShortcutsHelpDialog", () => ({ ShortcutsHelpDialog: () => null }));

vi.mock("@/lib/metrics/MetricsService", () => ({
  metricsService: { endSession: vi.fn(), flushNow: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("@/lib/db", () => ({
  getDatabase: vi.fn(),
}));

vi.mock("@/components/editor", () => ({
  ChapterList: () => <div data-testid="chapter-list" />,
  Editor: ({ onExportPdf }: { onExportPdf?: () => void }) => (
    <button type="button" onClick={() => onExportPdf?.()}>
      Export PDF
    </button>
  ),
  SaveStatus: () => null,
}));
vi.mock("@/components/book/BookSidePanel", () => ({
  BookSidePanel: () => <div data-testid="book-side-panel" />,
}));
vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">theme</button>,
}));
vi.mock("@/components/export", () => ({
  ExportDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="export-dialog" role="dialog" /> : null,
}));
vi.mock("@/components/book/BookSettingsDialog", () => ({
  BookSettingsDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="book-settings-dialog" role="dialog" /> : null,
}));
vi.mock("@/components/sync/SyncStatusButton", () => ({
  SyncStatusButton: () => <button type="button">sync</button>,
}));
vi.mock("@/components/versions/VersionPanel", () => ({ VersionPanel: () => null }));
vi.mock("@/components/versions/HistoryMenuButton", () => ({
  HistoryMenuButton: () => <button type="button">history menu</button>,
}));

import { BookEditor } from "@/pages/BookEditor";

function renderEditor() {
  const user = userEvent.setup();
  render(<BookEditor />);
  return user;
}

describe("BookEditor Chapter PDF text warning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveBinaryFile.mockResolvedValue(true);
    mockGenerateDocumentPdf.mockResolvedValue(new Blob(["pdf"]));
  });

  it("warns before generating a PDF with unsupported text", async () => {
    chapterContent = `<p>${POLISH}</p>`;
    const user = renderEditor();

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(mockGenerateDocumentPdf).not.toHaveBeenCalled();
  });

  it("generates once from Continue, rendering the html that was checked", async () => {
    chapterContent = `<p>${POLISH}</p>`;
    const user = renderEditor();

    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "export.pdfTextWarning.continue" }));

    await waitFor(() => expect(mockGenerateDocumentPdf).toHaveBeenCalledTimes(1));
    expect(mockGenerateDocumentPdf.mock.calls[0][0]).toBe(chapterContent);
    expect(mockGenerateDocumentPdf.mock.calls[0][1]).toBe("Ch1");
  });

  it("never generates from Cancel", async () => {
    chapterContent = `<p>${POLISH}</p>`;
    const user = renderEditor();

    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "export.pdfTextWarning.cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mockGenerateDocumentPdf).not.toHaveBeenCalled();
  });

  it("generates clean text with no warning", async () => {
    chapterContent = "<p>The tide came in</p>";
    const user = renderEditor();

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    await waitFor(() => expect(mockGenerateDocumentPdf).toHaveBeenCalledTimes(1));
    expect(mockGenerateDocumentPdf.mock.calls[0][0]).toBe("<p>The tide came in</p>");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
