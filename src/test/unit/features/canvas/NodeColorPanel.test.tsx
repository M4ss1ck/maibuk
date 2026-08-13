import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateTextNode: vi.fn(),
  state: {
    selectedNodeId: "node",
    doc: {
      nodes: [
        {
          id: "node",
          kind: "text",
          html: "<p>Idea</p>",
          position: { x: 0, y: 0 },
        },
      ],
    },
  },
}));

vi.mock("../../../../features/canvas/store", () => ({
  useCanvasStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ ...mocks.state, updateTextNode: mocks.updateTextNode }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { NodeColorPanel } = await import("@/features/canvas/NodeColorPanel");

const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];

describe("NodeColorPanel", () => {
  it("supports every text and background color action from the keyboard", async () => {
    const user = userEvent.setup();
    render(<NodeColorPanel />);

    const trigger = screen.getByRole("button", { name: "canvas.nodeColors" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const actions = [
      {
        button: screen.getByRole("button", { name: "canvas.automaticTextColor" }),
        patch: { textColor: "" },
      },
      ...COLORS.map((color) => ({
        button: screen.getByRole("button", { name: `canvas.textColor: ${color}` }),
        patch: { textColor: color },
      })),
      {
        button: screen.getByRole("button", { name: "canvas.transparentBackground" }),
        patch: { backgroundColor: "" },
      },
      ...COLORS.map((color) => ({
        button: screen.getByRole("button", { name: `canvas.backgroundColor: ${color}` }),
        patch: { backgroundColor: color },
      })),
    ];

    for (const { button, patch } of actions) {
      while (document.activeElement !== button) await user.tab();
      await user.keyboard(" ");
      expect(mocks.updateTextNode).toHaveBeenLastCalledWith("node", patch);
    }
  });

  it("closes with Escape and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<NodeColorPanel />);

    const trigger = screen.getByRole("button", { name: "canvas.nodeColors" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "canvas.nodeColors" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "canvas.nodeColors" })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });
});
