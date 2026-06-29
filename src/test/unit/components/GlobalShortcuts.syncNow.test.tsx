import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

interface ShortcutConfig {
  keys?: string[];
  sequence?: string[];
  onTrigger: () => void;
}

const { mockUseShortcuts } = vi.hoisted(() => ({
  mockUseShortcuts: vi.fn(),
}));

let currentPathname = "/";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: currentPathname }),
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../lib/shortcuts", () => ({
  useShortcuts: mockUseShortcuts,
}));

vi.mock("../../../lib/platform", () => ({
  IS_TAURI: false,
}));

const themeState = { theme: "light", setTheme: vi.fn() };
vi.mock("../../../features/theme", () => ({
  useThemeStore: (selector: (s: typeof themeState) => unknown) => selector(themeState),
}));

const settingsState = {
  hideKeyboardHints: false,
  setHideKeyboardHints: vi.fn(),
  alwaysOnTop: false,
  setAlwaysOnTop: vi.fn(),
};
vi.mock("../../../features/settings/store", () => ({
  useSettingsStore: (selector: (s: typeof settingsState) => unknown) => selector(settingsState),
}));

const syncState = {
  authStatus: "logged-in" as const,
  syncStatus: "idle" as const,
  syncAll: vi.fn().mockResolvedValue(undefined),
  syncSingleBook: vi.fn().mockResolvedValue(undefined),
  syncSingleNote: vi.fn().mockResolvedValue(undefined),
};
vi.mock("../../../features/sync/store", () => ({
  useSyncStore: { getState: () => syncState },
}));

let currentNote: { id: string } | null = null;
vi.mock("../../../features/notes", () => ({
  useNoteStore: { getState: () => ({ currentNote }) },
}));

vi.mock("../../../features/sync/crypto", () => ({
  getPassphrase: () => "passphrase",
}));

vi.mock("../../components/ShortcutsHelpDialog", () => ({
  ShortcutsHelpDialog: () => null,
}));

const { GlobalShortcuts } = await import("@/components/GlobalShortcuts");

function triggerSyncNow() {
  const calls = mockUseShortcuts.mock.calls;
  const configs = calls[calls.length - 1]?.[0] as ShortcutConfig[];
  const syncShortcut = configs.find((c) => c.keys?.includes("ctrl+shift+y"));
  if (!syncShortcut) throw new Error("Sync Now shortcut not registered");
  syncShortcut.onTrigger();
}

describe("GlobalShortcuts — context-aware Sync Now", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentPathname = "/";
    currentNote = null;
  });

  it("pushes only the current book when in the book editor", () => {
    currentPathname = "/book/book-1";
    render(<GlobalShortcuts />);

    triggerSyncNow();

    expect(syncState.syncSingleBook).toHaveBeenCalledWith(
      "book-1",
      "passphrase",
      expect.any(Function)
    );
    expect(syncState.syncAll).not.toHaveBeenCalled();
  });

  it("pushes only the current note when one is open on the notes page", () => {
    currentPathname = "/notes/note-1";
    currentNote = { id: "note-1" };
    render(<GlobalShortcuts />);

    triggerSyncNow();

    expect(syncState.syncSingleNote).toHaveBeenCalledWith(
      "note-1",
      "passphrase",
      expect.any(Function)
    );
    expect(syncState.syncAll).not.toHaveBeenCalled();
  });

  it("falls back to a full sync on the notes page when no note is open", () => {
    currentPathname = "/notes";
    currentNote = null;
    render(<GlobalShortcuts />);

    triggerSyncNow();

    expect(syncState.syncAll).toHaveBeenCalled();
    expect(syncState.syncSingleNote).not.toHaveBeenCalled();
  });

  it("falls back to a full sync elsewhere", () => {
    currentPathname = "/";
    render(<GlobalShortcuts />);

    triggerSyncNow();

    expect(syncState.syncAll).toHaveBeenCalled();
    expect(syncState.syncSingleBook).not.toHaveBeenCalled();
    expect(syncState.syncSingleNote).not.toHaveBeenCalled();
  });
});
