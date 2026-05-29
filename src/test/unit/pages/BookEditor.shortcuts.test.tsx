import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockUseShortcuts } = vi.hoisted(() => ({
  mockUseShortcuts: vi.fn(),
}));
const { mockVersionPanel } = vi.hoisted(() => ({
  mockVersionPanel: vi.fn(() => null),
}));
const { mockHistoryMenuButton } = vi.hoisted(() => ({
  mockHistoryMenuButton: vi.fn(() => <button type="button">history menu</button>),
}));
const { mockIsMac } = vi.hoisted(() => ({
  mockIsMac: vi.fn(() => false),
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

vi.mock("../../../lib/platform", () => ({
  IS_TAURI: true,
  isMac: mockIsMac,
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
      alwaysOnTop: false,
      setAlwaysOnTop: vi.fn(),
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

vi.mock("../../../components/versions/HistoryMenuButton", () => ({
  HistoryMenuButton: mockHistoryMenuButton,
}));

import { BookEditor } from "../../../pages/BookEditor";

describe("BookEditor shortcuts", () => {
  beforeEach(() => {
    mockUseShortcuts.mockClear();
    mockVersionPanel.mockClear();
    mockHistoryMenuButton.mockClear();
    mockIsMac.mockReturnValue(false);
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

  it("does not mount the version panel until history is opened", () => {
    render(<BookEditor />);

    expect(mockVersionPanel).not.toHaveBeenCalled();
  });

  it("passes a flush callback to the version panel before compare when opened", async () => {
    render(<BookEditor />);

    const shortcuts = mockUseShortcuts.mock.calls[0][0];
    const historyShortcut = shortcuts.find(
      (shortcut: { sequence?: string[] }) => shortcut.sequence?.join(" ") === "g v"
    );
    historyShortcut.onTrigger();

    await waitFor(() => expect(mockVersionPanel).toHaveBeenCalled());
    expect(mockVersionPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        flushBeforeCompare: expect.any(Function),
      }),
      undefined
    );
  });

  it("mounts the history menu button with save and panel actions", () => {
    render(<BookEditor />);

    expect(mockHistoryMenuButton).toHaveBeenCalledWith(
      expect.objectContaining({
        onOpenPanel: expect.any(Function),
        onSaveVersion: expect.any(Function),
        saveVersionShortcut: "Ctrl+Alt+S",
        panelShortcut: "g v",
      }),
      undefined
    );
  });

  it("adds save-version and history actions to the mobile menu", async () => {
    const user = userEvent.setup();
    render(<BookEditor />);

    await user.click(screen.getByTitle("common.more"));

    expect(screen.getByText("versions.saveVersion")).toBeInTheDocument();
    expect(screen.getByText("versions.showHistory")).toBeInTheDocument();
  });
});
