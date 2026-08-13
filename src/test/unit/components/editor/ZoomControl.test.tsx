import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../../i18n", () => ({
  default: { language: "en", changeLanguage: vi.fn() },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("../../../../lib/platform", () => ({
  IS_ANDROID: false,
  setLaunchOnStartup: vi.fn().mockResolvedValue(undefined),
}));

const { ZoomControl } = await import("@/components/editor/ZoomControl");
const { useSettingsStore } = await import("@/features/settings/store");

describe("ZoomControl", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ editorZoom: 100 });
  });

  it("shows the current zoom percent on the trigger", () => {
    render(<ZoomControl />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("opens the popover and drives zoom via the slider", () => {
    render(<ZoomControl />);
    fireEvent.click(screen.getByText("100%"));
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "150" } });
    expect(useSettingsStore.getState().editorZoom).toBe(150);
    expect(screen.getByText("150%")).toBeInTheDocument();
  });

  it("steps with +/- and resets", () => {
    render(<ZoomControl />);
    fireEvent.click(screen.getByText("100%"));
    fireEvent.click(screen.getByRole("button", { name: "editor.zoomIn" }));
    expect(useSettingsStore.getState().editorZoom).toBe(110);
    fireEvent.click(screen.getByRole("button", { name: "editor.zoomOut" }));
    expect(useSettingsStore.getState().editorZoom).toBe(100);
    useSettingsStore.setState({ editorZoom: 200 });
    fireEvent.click(screen.getByText("editor.resetZoom"));
    expect(useSettingsStore.getState().editorZoom).toBe(100);
  });

  it("stays open when a click lands on a control's svg icon", () => {
    render(<ZoomControl />);
    fireEvent.click(screen.getByText("100%"));
    const icon = screen.getByRole("button", { name: "editor.zoomIn" }).querySelector("svg");
    expect(icon).not.toBeNull();
    fireEvent.mouseDown(icon as SVGSVGElement);
    expect(screen.queryByRole("slider")).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<ZoomControl />);

    const trigger = screen.getByText("100%");
    fireEvent.click(trigger);
    expect(screen.getByRole("slider")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("stops Escape propagation so an outer window Escape handler is not invoked", async () => {
    const user = userEvent.setup();
    const outerEscapeSpy = vi.fn();
    window.addEventListener("keydown", outerEscapeSpy);
    try {
      render(<ZoomControl />);

      fireEvent.click(screen.getByText("100%"));
      expect(screen.getByRole("slider")).toBeInTheDocument();

      await user.keyboard("{Escape}");

      expect(screen.queryByRole("slider")).not.toBeInTheDocument();
      expect(outerEscapeSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", outerEscapeSpy);
    }
  });

  it("wraps its fixed-width controls so the popover cannot overflow the viewport", () => {
    render(<ZoomControl />);
    fireEvent.click(screen.getByText("100%"));

    const popover = document.querySelector(".zoom-control-portal") as HTMLElement;
    expect(popover).not.toBeNull();
    expect(popover).toHaveClass("flex-wrap", "max-w-[calc(100vw-1rem)]");
  });
});
