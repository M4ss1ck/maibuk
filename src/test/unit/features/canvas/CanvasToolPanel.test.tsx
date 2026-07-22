import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasToolPanel } from "@/features/canvas/CanvasToolPanel";
import { useCanvasStore } from "@/features/canvas/store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/ui", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipGroup: ({ children }: { children: ReactNode }) => children,
}));

function callbacks() {
  return {
    onAddText: vi.fn(),
    onAddNoteRef: vi.fn(),
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
      ["canvas.toolSelect", "{Enter}", () => expect(useCanvasStore.getState().toolMode).toBe("select")],
      ["canvas.toolPen", " ", () => expect(useCanvasStore.getState().toolMode).toBe("pen")],
      ["canvas.toolEraser", "{Enter}", () => expect(useCanvasStore.getState().toolMode).toBe("eraser")],
      ["canvas.addTextNode", " ", () => expect(handlers.onAddText).toHaveBeenCalledOnce()],
      ["canvas.addNoteRef", "{Enter}", () => expect(handlers.onAddNoteRef).toHaveBeenCalledOnce()],
      ["canvas.zoomIn", " ", () => expect(handlers.onZoomIn).toHaveBeenCalledOnce()],
      ["canvas.zoomOut", "{Enter}", () => expect(handlers.onZoomOut).toHaveBeenCalledOnce()],
      ["canvas.fitView", " ", () => expect(handlers.onFitView).toHaveBeenCalledOnce()],
      ["canvas.lockInteractivity", "{Enter}", () => expect(useCanvasStore.getState().interactivityLocked).toBe(true)],
    ] as const;

    for (const [label, key, assertOutcome] of actions) {
      await user.tab();
      expect(screen.getByRole("button", { name: label })).toHaveFocus();
      await user.keyboard(key);
      assertOutcome();
    }
  });

  it("uses larger mobile targets while preserving desktop dimensions", () => {
    render(<CanvasToolPanel {...callbacks()} />);

    const selectButton = screen.getByRole("button", { name: "canvas.toolSelect" });
    expect(selectButton).toHaveClass("size-9", "md:size-7");
    expect(selectButton.parentElement?.parentElement).toHaveClass("w-11", "md:w-9");
  });
});
