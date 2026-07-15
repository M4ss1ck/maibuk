import { render, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

interface ShortcutConfig {
  keys?: string[];
  sequence?: string[];
  onTrigger: () => void;
}

const { mockUseShortcuts } = vi.hoisted(() => ({
  mockUseShortcuts: vi.fn(),
}));

let capturedShortcuts: unknown[] = [];

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
  IS_TAURI: false,
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

const mockShortcutItems = [
  { id: "global.gotoProjects", label: "Go to Projects", formatted: { groups: [["g", "p"]], isSequence: true } },
  { id: "global.showHelp", label: "Show Help", formatted: { groups: [["?"]], isSequence: false } },
];

vi.mock("@/hooks", () => ({
  useActiveShortcuts: () => mockShortcutItems,
}));

vi.mock("@/components/ShortcutsHelpDialog", () => ({
  ShortcutsHelpDialog: ({ isOpen, shortcuts }: { isOpen: boolean; shortcuts: unknown[] }) => {
    if (isOpen) capturedShortcuts = shortcuts;
    return null;
  },
}));

import { GlobalShortcuts } from "@/components/GlobalShortcuts";

function triggerHelpShortcut() {
  const calls = mockUseShortcuts.mock.calls;
  const configs = calls[calls.length - 1]?.[0] as ShortcutConfig[];
  const helpShortcut = configs.find(
    (c) => c.keys && c.keys.includes("?")
  );
  if (!helpShortcut) throw new Error("Help shortcut not registered");
  helpShortcut.onTrigger();
}

describe("GlobalShortcuts help snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedShortcuts = [];
  });

  it("snapshots the pre-open active shortcuts and passes them to the help dialog", async () => {
    render(<GlobalShortcuts />);

    await act(async () => {
      triggerHelpShortcut();
    });

    expect(capturedShortcuts).toEqual(mockShortcutItems);
    expect(capturedShortcuts.length).toBeGreaterThan(0);
  });
});
