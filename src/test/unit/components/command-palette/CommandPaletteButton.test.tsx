import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPaletteButton } from "@/components/command-palette/CommandPaletteButton";
import { useCommandPaletteStore } from "@/features/command-palette/store";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { DEFAULT_SHORTCUT_SETTINGS } from "@/lib/shortcut-resolve";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "shortcuts.openCommandPalette") return "Open command palette";
      return key;
    },
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const BUTTON_NAME = "Open command palette";

function renderButton() {
  render(<CommandPaletteButton />);
  return screen.getByRole("button", { name: BUTTON_NAME });
}

beforeEach(() => {
  useCommandPaletteStore.setState({ isOpen: false, opener: null, snapshot: new Map() });
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
});

describe("CommandPaletteButton", () => {
  it("opens the palette with Enter on the focused button", async () => {
    const user = userEvent.setup();
    const button = renderButton();
    button.focus();
    expect(button).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(useCommandPaletteStore.getState().isOpen).toBe(true);
  });

  it("opens the palette with Space on the focused button", async () => {
    const user = userEvent.setup();
    const button = renderButton();
    button.focus();

    await user.keyboard(" ");
    expect(useCommandPaletteStore.getState().isOpen).toBe(true);
  });

  it("shows the live Shortcut in its tooltip and follows a Custom Shortcut", async () => {
    const button = renderButton();
    const chips = () =>
      [...screen.getByTestId("tooltip-primary-row").querySelectorAll("kbd")].map(
        (chip) => chip.textContent
      );

    fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Open command palette");
    expect(chips()).toEqual(["F1"]);

    act(() => {
      useShortcutSettingsStore
        .getState()
        .setCommandShortcuts("global.openCommandPalette", [["Mod+k"]]);
    });
    expect(chips()).toEqual(["Ctrl", "K"]);
  });

  it("is always visible with a coarse-pointer target and no hover reveal", () => {
    const button = renderButton();
    expect(button.className).toContain("pointer-coarse:min-h-10");
    expect(button.className).toContain("pointer-coarse:min-w-10");
    expect(button.className).not.toContain("group-hover:");
    expect(button.className).not.toContain("opacity-0");
  });
});
