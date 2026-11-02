import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasToolPanel } from "@/features/canvas/CanvasToolPanel";
import { useCanvasStore } from "@/features/canvas/store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/components/ui", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipGroup: ({ children }: { children: ReactNode }) => children,
}));

function callbacks() {
  return {
    onPlaceAtCenter: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFitView: vi.fn(),
  };
}

describe("CanvasToolPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCanvasStore.setState({ toolMode: "pen", interactivityLocked: false });
  });

  it("keyboard-activates every toolbar control in focus order", async () => {
    const user = userEvent.setup();
    const handlers = callbacks();
    render(<CanvasToolPanel {...handlers} />);

    const actions = [
      [
        "canvas.toolSelect",
        "{Enter}",
        () => expect(useCanvasStore.getState().toolMode).toBe("select"),
      ],
      ["canvas.toolPen", " ", () => expect(useCanvasStore.getState().toolMode).toBe("pen")],
      [
        "canvas.toolEraser",
        "{Enter}",
        () => expect(useCanvasStore.getState().toolMode).toBe("eraser"),
      ],
      [
        "canvas.addTextNode",
        " ",
        () => expect(useCanvasStore.getState().toolMode).toBe("textNode"),
      ],
      [
        "canvas.addNoteRef",
        "{Enter}",
        () => expect(useCanvasStore.getState().toolMode).toBe("noteRef"),
      ],
      ["canvas.zoomIn", " ", () => expect(handlers.onZoomIn).toHaveBeenCalledOnce()],
      ["canvas.zoomOut", "{Enter}", () => expect(handlers.onZoomOut).toHaveBeenCalledOnce()],
      ["canvas.fitView", " ", () => expect(handlers.onFitView).toHaveBeenCalledOnce()],
      [
        "canvas.lockInteractivity",
        "{Enter}",
        () => expect(useCanvasStore.getState().interactivityLocked).toBe(true),
      ],
    ] as const;

    for (const [label, key, assertOutcome] of actions) {
      await user.tab();
      expect(screen.getByRole("button", { name: label })).toHaveFocus();
      await user.keyboard(key);
      assertOutcome();
    }
    // Arming a placement tool never places on its own; only the second press does.
    expect(handlers.onPlaceAtCenter).not.toHaveBeenCalled();
  });

  it("uses larger mobile targets while preserving desktop dimensions", () => {
    render(<CanvasToolPanel {...callbacks()} />);

    const selectButton = screen.getByRole("button", { name: "canvas.toolSelect" });
    expect(selectButton).toHaveClass("size-9", "md:size-7");
    expect(selectButton.parentElement?.parentElement).toHaveClass("w-11", "md:w-9");
  });

  it("exposes the active tool as a pressed toggle and plain actions without aria-pressed", () => {
    render(<CanvasToolPanel {...callbacks()} />);

    expect(screen.getByRole("button", { name: "canvas.toolSelect" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "canvas.toolPen" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // A placement tool is a toggle too: pressed only while armed.
    expect(screen.getByRole("button", { name: "canvas.addTextNode" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "canvas.zoomIn" })).not.toHaveAttribute(
      "aria-pressed"
    );
  });

  it("shows the Text Node tool as pressed only while it is armed", () => {
    useCanvasStore.setState({ toolMode: "textNode" });
    render(<CanvasToolPanel {...callbacks()} />);

    expect(screen.getByRole("button", { name: "canvas.addTextNode" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "canvas.addNoteRef" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("moves focus vertically and activates the focused canvas tool", async () => {
    const user = userEvent.setup();
    render(<CanvasToolPanel {...callbacks()} />);
    const select = screen.getByRole("button", { name: "canvas.toolSelect" });
    const pen = screen.getByRole("button", { name: "canvas.toolPen" });

    select.focus();
    await user.keyboard("{ArrowDown}");
    expect(pen).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(useCanvasStore.getState().toolMode).toBe("pen");

    await user.keyboard("{ArrowUp}");
    expect(select).toHaveFocus();
    await user.keyboard(" ");
    expect(useCanvasStore.getState().toolMode).toBe("select");
  });

  describe.each([
    ["canvas.addTextNode", "textNode"],
    ["canvas.addNoteRef", "noteRef"],
  ] as const)("placement tool %s", (label, mode) => {
    it("arms with the first Enter and places at the center with the second", async () => {
      const user = userEvent.setup();
      const handlers = callbacks();
      render(<CanvasToolPanel {...handlers} />);

      screen.getByRole("button", { name: label }).focus();
      await user.keyboard("{Enter}");
      expect(useCanvasStore.getState().toolMode).toBe(mode);
      expect(handlers.onPlaceAtCenter).not.toHaveBeenCalled();

      await user.keyboard("{Enter}");
      expect(handlers.onPlaceAtCenter).toHaveBeenCalledOnce();
      expect(useCanvasStore.getState().toolMode).toBe(mode);
    });

    it("returns to Select without placing when the armed button is clicked with the mouse", async () => {
      const user = userEvent.setup();
      const handlers = callbacks();
      render(<CanvasToolPanel {...handlers} />);

      await user.click(screen.getByRole("button", { name: label }));
      expect(useCanvasStore.getState().toolMode).toBe(mode);

      await user.click(screen.getByRole("button", { name: label }));
      expect(useCanvasStore.getState().toolMode).toBe("select");
      expect(handlers.onPlaceAtCenter).not.toHaveBeenCalled();
    });

    it("switches to Pen without placing when Pen is chosen while armed", async () => {
      const user = userEvent.setup();
      const handlers = callbacks();
      render(<CanvasToolPanel {...handlers} />);

      screen.getByRole("button", { name: label }).focus();
      await user.keyboard("{Enter}");
      expect(useCanvasStore.getState().toolMode).toBe(mode);

      screen.getByRole("button", { name: "canvas.toolPen" }).focus();
      await user.keyboard("{Enter}");
      expect(useCanvasStore.getState().toolMode).toBe("pen");
      expect(handlers.onPlaceAtCenter).not.toHaveBeenCalled();
    });
  });
});
