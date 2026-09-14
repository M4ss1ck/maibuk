import { render, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

interface ShortcutConfig {
  id?: string;
  keys?: string[];
  sequence?: string[];
  onTrigger: () => void;
}

const { mockUseShortcuts, platformState } = vi.hoisted(() => ({
  mockUseShortcuts: vi.fn(),
  platformState: { isDesktop: true },
}));

let helpOpen = false;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/shortcuts", () => ({
  useShortcuts: mockUseShortcuts,
}));

vi.mock("@/lib/platform", () => ({
  get IS_DESKTOP() {
    return platformState.isDesktop;
  },
  IS_TAURI: true,
  isMac: () => false,
}));

const themeState = { theme: "light", setTheme: vi.fn() };
vi.mock("@/features/theme", () => ({
  useThemeStore: (selector: (s: typeof themeState) => unknown) => selector(themeState),
}));

const settingsState = {
  hideKeyboardHints: false,
  setHideKeyboardHints: vi.fn(),
  alwaysOnTop: false,
  setAlwaysOnTop: vi.fn(),
};
vi.mock("@/features/settings/store", () => ({
  useSettingsStore: (selector: (s: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock("@/features/sync/store", () => ({
  useSyncStore: { getState: () => ({ authStatus: "logged-out", syncStatus: "idle" }) },
}));
vi.mock("@/features/notes", () => ({
  useNoteStore: { getState: () => ({ currentNote: null }) },
}));
vi.mock("@/features/sync/crypto", () => ({ getPassphrase: () => null }));

vi.mock("@/components/ShortcutsHelpDialog", () => ({
  ShortcutsHelpDialog: ({ isOpen }: { isOpen: boolean }) => {
    helpOpen = isOpen;
    return null;
  },
}));

import { GlobalShortcuts } from "@/components/GlobalShortcuts";

function latestConfigs() {
  const calls = mockUseShortcuts.mock.calls;
  return calls[calls.length - 1]?.[0] as ShortcutConfig[];
}

function triggerHelpShortcut() {
  const configs = latestConfigs();
  const helpShortcut = configs.find((c) => c.keys && c.keys.includes("?"));
  if (!helpShortcut) throw new Error("Help shortcut not registered");
  helpShortcut.onTrigger();
}

describe("GlobalShortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpOpen = false;
    platformState.isDesktop = true;
    settingsState.setAlwaysOnTop.mockReset();
  });

  it("opens the shortcut help from ?", async () => {
    render(<GlobalShortcuts />);

    await act(async () => {
      triggerHelpShortcut();
    });

    expect(helpOpen).toBe(true);
  });

  it("binds every global shortcut under its registry id, so the help lists it", () => {
    render(<GlobalShortcuts />);

    const ids = latestConfigs()
      .map((config) => config.id)
      .sort();

    expect(ids).toEqual([
      "global.cyclePanes",
      "global.gotoCanvas",
      "global.gotoEphemeral",
      "global.gotoMetrics",
      "global.gotoNotes",
      "global.gotoProjects",
      "global.gotoSettings",
      "global.showHelp",
      "global.syncNow",
      "global.toggleAlwaysOnTop",
      "global.toggleShortcutHints",
      "global.toggleTheme",
    ]);
  });

  it("toggles always-on-top via shortcut only when on desktop", () => {
    platformState.isDesktop = true;
    render(<GlobalShortcuts />);

    const calls = mockUseShortcuts.mock.calls;
    const configs = calls[calls.length - 1]?.[0] as Array<{
      keys?: string[];
      enabled?: boolean;
      onTrigger: () => void;
    }>;
    const aotShortcut = configs.find(
      (c) => c.keys && c.keys.some((k) => k.toLowerCase().includes("shift+p"))
    );
    if (!aotShortcut) throw new Error("Always-on-top shortcut not registered");

    aotShortcut.onTrigger();
    expect(settingsState.setAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it("does not register the always-on-top shortcut on Android", () => {
    platformState.isDesktop = false;
    render(<GlobalShortcuts />);

    const calls = mockUseShortcuts.mock.calls;
    const configs = calls[calls.length - 1]?.[0] as Array<{
      keys?: string[];
      enabled?: boolean;
      onTrigger: () => void;
    }>;
    const aotShortcut = configs.find(
      (c) => c.keys && c.keys.some((k) => k.toLowerCase().includes("shift+p"))
    );

    // On Android the shortcut should either not be registered or be disabled
    if (aotShortcut) {
      expect(aotShortcut.enabled).toBe(false);
    }
    // else: not registered at all, which is also acceptable
  });
});
