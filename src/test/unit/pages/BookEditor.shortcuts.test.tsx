import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockUseShortcuts } = vi.hoisted(() => ({
  mockUseShortcuts: vi.fn(),
}));
const { mockVersionPanel } = vi.hoisted(() => ({
  mockVersionPanel: vi.fn(() => null),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ bookId: "book-1" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../lib/shortcuts", () => ({
  useShortcuts: mockUseShortcuts,
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
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    loadBook: vi.fn(),
    updateWordCount: vi.fn(),
    updateBook: vi.fn(),
    deleteBook: vi.fn(),
  }),
}));

vi.mock("../../../features/chapters/store", () => ({
  useChapterStore: () => ({
    chapters: [],
    currentChapter: null,
    loadChapters: vi.fn(),
    createChapter: vi.fn(),
    updateChapter: vi.fn(),
    deleteChapter: vi.fn(),
    reorderChapters: vi.fn(),
    setCurrentChapter: vi.fn(),
  }),
}));

vi.mock("../../../features/settings/store", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      sidebarWidth: 256,
      setSidebarWidth: vi.fn(),
      showInlineFootnotes: true,
      showNotesChapter: false,
      setShowNotesChapter: vi.fn(),
      hideKeyboardHints: false,
    }),
}));

vi.mock("../../../features/versions/useAutoCheckpoint", () => ({
  useAutoCheckpoint: vi.fn(),
}));

vi.mock("../../../features/versions/store", () => ({
  useVersionStore: {
    getState: () => ({
      createVersion: vi.fn(),
    }),
  },
}));

vi.mock("../../../components/editor", () => ({
  ChapterList: () => <div data-testid="chapter-list" />,
  Editor: () => <div data-testid="editor" />,
}));

vi.mock("../../../components/editor/NotesPanel", () => ({
  NotesPanel: () => <div data-testid="notes-panel" />,
}));

vi.mock("../../../components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">theme</button>,
}));

vi.mock("../../../components/export", () => ({
  ExportDialog: () => null,
}));

vi.mock("../../../components/book/BookSettingsDialog", () => ({
  BookSettingsDialog: () => null,
}));

vi.mock("../../../components/sync/SyncStatusButton", () => ({
  SyncStatusButton: () => <button type="button">sync</button>,
}));

vi.mock("../../../components/versions/VersionPanel", () => ({
  VersionPanel: mockVersionPanel,
}));

import { BookEditor } from "../../../pages/BookEditor";

describe("BookEditor shortcuts", () => {
  beforeEach(() => {
    mockUseShortcuts.mockClear();
    mockVersionPanel.mockClear();
  });

  it("registers Ctrl+Alt+S as the save-version shortcut", () => {
    render(<BookEditor />);

    const shortcuts = mockUseShortcuts.mock.calls[0][0];
    expect(shortcuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keys: ["ctrl+alt+s", "meta+alt+s"],
          allowInInput: true,
        }),
      ])
    );
    expect(shortcuts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keys: ["ctrl+shift+s", "meta+shift+s"],
        }),
      ])
    );
  });

  it("passes a flush callback to the version panel before compare", () => {
    render(<BookEditor />);

    expect(mockVersionPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        flushBeforeCompare: expect.any(Function),
      }),
      undefined
    );
  });
});
