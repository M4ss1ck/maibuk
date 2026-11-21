import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { useSettingsStore } from "@/features/settings/store";
import { DEFAULT_PRIMARY_COLOR } from "@/features/settings/types";
import { useThemeStore } from "@/features/theme/store";

const { strings } = vi.hoisted(() => ({
  strings: {
    "settings.einkMode": "E-ink mode",
    "settings.primaryColorEinkNote":
      "E-ink mode uses ink instead of the primary color. Your color returns when you turn it off.",
  } as Record<string, string>,
}));

vi.mock("../../../../i18n", () => ({
  default: {
    language: "en",
    changeLanguage: vi.fn(),
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
  },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => strings[key] ?? key }),
}));

const CUSTOM_PRIMARY_COLOR = "#EF4444";

async function tabTo(user: ReturnType<typeof userEvent.setup>, target: HTMLElement) {
  const group = screen.getByRole("group", { name: "settings.theme" });
  within(group).getAllByRole("button")[0].focus();
  for (let i = 0; i < 10 && document.activeElement !== target; i++) {
    await user.tab();
  }
  expect(document.activeElement).toBe(target);
}

describe("AppearanceSection — E-ink mode", () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState({ eink: false });
    useSettingsStore.setState({
      appFontSize: 16,
      appFont: "sans",
      primaryColor: CUSTOM_PRIMARY_COLOR,
    });
  });

  it("toggles E-ink mode with Space and disables the primary color while on", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);

    const toggle = screen.getByRole("switch", { name: "E-ink mode" });
    const picker = screen.getByRole("button", { name: "settings.primaryColor" });
    const reset = screen.getByRole("button", { name: "settings.resetPrimaryColor" });
    expect(toggle).not.toBeChecked();
    expect(picker).not.toBeDisabled();
    expect(reset).not.toBeDisabled();
    expect(screen.queryByText(strings["settings.primaryColorEinkNote"])).toBeNull();

    await tabTo(user, toggle);
    await user.keyboard(" ");

    expect(useThemeStore.getState().eink).toBe(true);
    expect(screen.getByRole("switch", { name: "E-ink mode" })).toBeChecked();
    expect(picker).toBeDisabled();
    expect(reset).toBeDisabled();
    expect(screen.getByText(strings["settings.primaryColorEinkNote"])).toBeInTheDocument();
    expect(useSettingsStore.getState().primaryColor).toBe(CUSTOM_PRIMARY_COLOR);

    await user.keyboard(" ");

    expect(useThemeStore.getState().eink).toBe(false);
    expect(screen.getByRole("switch", { name: "E-ink mode" })).not.toBeChecked();
    expect(picker).not.toBeDisabled();
    expect(reset).not.toBeDisabled();
    expect(screen.queryByText(strings["settings.primaryColorEinkNote"])).toBeNull();
    expect(useSettingsStore.getState().primaryColor).toBe(CUSTOM_PRIMARY_COLOR);
    expect(useSettingsStore.getState().primaryColor).not.toBe(DEFAULT_PRIMARY_COLOR);
  });
});
