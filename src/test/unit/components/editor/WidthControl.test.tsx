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
const {
  EDITOR_CONTENT_WIDTH_FULL,
  EDITOR_CONTENT_WIDTH_MAX,
  EDITOR_CONTENT_WIDTH_STEP,
} = await import("../../../../features/settings/types");

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

  it("maps the slider end to the Full preset", () => {
    render(<WidthControl />);
    fireEvent.click(screen.getByTitle("editor.contentWidth"));

    const slider = screen.getByRole("slider");
    const fullSliderValue = EDITOR_CONTENT_WIDTH_MAX + EDITOR_CONTENT_WIDTH_STEP;
    expect(slider).toHaveAttribute("max", String(fullSliderValue));

    fireEvent.change(slider, { target: { value: String(fullSliderValue) } });

    expect(useSettingsStore.getState().editorContentWidth).toBe(
      EDITOR_CONTENT_WIDTH_FULL,
    );
    expect(
      screen.getByRole("button", { name: /editor\.widthFull/i }),
    ).toHaveClass("bg-background");
  });

  it("commits a typed px value from the input", () => {
    render(<WidthControl />);
    fireEvent.click(screen.getByTitle("editor.contentWidth"));

    const valueButton = screen.getByRole("button", {
      name: "editor.contentWidth px",
    });
    expect(valueButton).toHaveTextContent("720px");
    expect(valueButton).toHaveClass("h-8", "w-20");
    expect(valueButton).not.toHaveClass("border", "bg-background");

    fireEvent.click(valueButton);

    const input = screen.getByRole("textbox", {
      name: "editor.contentWidth px",
    });
    expect(input).toHaveClass("h-8", "w-20");
    expect(input).toHaveClass("border", "bg-background", "shadow-sm");
    fireEvent.change(input, { target: { value: "731" } });

    expect(useSettingsStore.getState().editorContentWidth).toBe(720);

    fireEvent.blur(input);

    expect(useSettingsStore.getState().editorContentWidth).toBe(740);
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
