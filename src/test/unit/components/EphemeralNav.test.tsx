import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { GlobalShortcuts } from "@/components/GlobalShortcuts";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/features/version", () => ({
  useVersionCheck: () => ({ latestVersion: null, isOutdated: false }),
}));

const settingsState = {
  mainSidebarWidth: 280,
  setMainSidebarWidth: () => {},
  hideKeyboardHints: false,
  setHideKeyboardHints: vi.fn(),
  alwaysOnTop: false,
  setAlwaysOnTop: vi.fn(),
};

vi.mock("@/features/settings/store", () => ({
  useSettingsStore: (selector: (s: typeof settingsState) => unknown) =>
    selector(settingsState),
}));

vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

const themeState = { theme: "light", setTheme: vi.fn() };
vi.mock("@/features/theme", () => ({
  useThemeStore: (selector: (s: typeof themeState) => unknown) => selector(themeState),
  getCycledTheme: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({ IS_TAURI: false, isMac: () => false }));
vi.mock("@/features/sync/store", () => ({
  useSyncStore: { getState: () => ({ authStatus: "logged-out", syncStatus: "idle" }) },
}));
vi.mock("@/features/notes", () => ({
  useNoteStore: { getState: () => ({ currentNote: null }) },
}));
vi.mock("@/features/sync/crypto", () => ({ getPassphrase: () => null }));
vi.mock("@/hooks", () => ({ useActiveShortcuts: () => [] }));
vi.mock("@/components/ShortcutsHelpDialog", () => ({ ShortcutsHelpDialog: () => null }));

function ShortcutHarness() {
  const location = useLocation();

  return (
    <>
      <GlobalShortcuts />
      <textarea aria-label="Typing target" />
      <button type="button">Outside</button>
      <output aria-label="Current pathname">{location.pathname}</output>
    </>
  );
}

describe("Ephemeral nav item", () => {
  it("renders between Canvas and Metrics", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Layout />
      </MemoryRouter>
    );
    const hrefs = Array.from(container.querySelectorAll("a[href]")).map((el) =>
      el.getAttribute("href")
    );
    const canvasIdx = hrefs.indexOf("/canvas");
    const ephemeralIdx = hrefs.indexOf("/ephemeral");
    const metricsIdx = hrefs.indexOf("/metrics");
    expect(canvasIdx).toBeGreaterThanOrEqual(0);
    expect(ephemeralIdx).toBe(canvasIdx + 1);
    expect(metricsIdx).toBe(ephemeralIdx + 1);
  });

  it("suppresses g e in typing targets and navigates from a non-typing target", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ShortcutHarness />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("textbox", { name: "Typing target" }));
    await user.keyboard("ge");
    expect(screen.getByRole("status", { name: "Current pathname" })).toHaveTextContent("/");

    await user.click(screen.getByRole("button", { name: "Outside" }));
    await user.keyboard("ge");
    expect(screen.getByRole("status", { name: "Current pathname" })).toHaveTextContent(
      "/ephemeral"
    );
  });
});
