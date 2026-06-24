import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../../i18n", () => ({
  default: { language: "en", changeLanguage: vi.fn() },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("../../../../lib/platform", () => ({
  setLaunchOnStartup: vi.fn().mockResolvedValue(undefined),
}));

const { WidthControl } = await import(
  "../../../../components/editor/WidthControl"
);
const { useSettingsStore } = await import(
  "../../../../features/settings/store"
);

describe("WidthControl", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      editorContentWidth: 720,
      editorShowBorder: false,
    });
  });

  it("opens the popover from the trigger", () => {
    render(<WidthControl />);
    fireEvent.click(screen.getByTitle("editor.contentWidth"));
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("selects a preset", () => {
    render(<WidthControl />);
    fireEvent.click(screen.getByTitle("editor.contentWidth"));
    fireEvent.click(screen.getByText("editor.widthWide"));
    expect(useSettingsStore.getState().editorContentWidth).toBe(960);
  });

  it("drives width via the slider", () => {
    render(<WidthControl />);
    fireEvent.click(screen.getByTitle("editor.contentWidth"));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "600" } });
    expect(useSettingsStore.getState().editorContentWidth).toBe(600);
  });

  it("keeps the nearest preset visually selected while the slider moves", () => {
    render(<WidthControl />);
    fireEvent.click(screen.getByTitle("editor.contentWidth"));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "860" } });

    expect(
      screen.getByRole("button", { name: /editor\.widthWide/i }),
    ).toHaveClass("bg-background");
    expect(
      screen.getByRole("button", { name: /editor\.widthComfortable/i }),
    ).not.toHaveClass("bg-background");
    expect(screen.getByText("960px")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("toggles the show-border checkbox", () => {
    render(<WidthControl />);
    fireEvent.click(screen.getByTitle("editor.contentWidth"));
    fireEvent.click(screen.getByRole("checkbox"));
    expect(useSettingsStore.getState().editorShowBorder).toBe(true);
  });

  it("resets to the default width", () => {
    useSettingsStore.setState({ editorContentWidth: 960 });
    render(<WidthControl />);
    fireEvent.click(screen.getByTitle("editor.contentWidth"));
    fireEvent.click(screen.getByText("editor.resetWidth"));
    expect(useSettingsStore.getState().editorContentWidth).toBe(720);
  });
});
