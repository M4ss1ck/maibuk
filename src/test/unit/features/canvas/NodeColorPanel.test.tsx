import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const COLORS = [
  "#7f1d1d",
  "#ef4444",
  "#92400e",
  "#f59e0b",
  "#065f46",
  "#10b981",
  "#1e3a8a",
  "#3b82f6",
  "#4c1d95",
  "#8b5cf6",
  "#831843",
  "#ec4899",
];

const COLOR_PAIRS = [
  { id: "slate", textColor: "#1e293b", backgroundColor: "#e2e8f0" },
  { id: "rose", textColor: "#7f1d1d", backgroundColor: "#fee2e2" },
  { id: "amber", textColor: "#451a03", backgroundColor: "#fef3c7" },
  { id: "emerald", textColor: "#064e3b", backgroundColor: "#d1fae5" },
  { id: "blue", textColor: "#1e3a8a", backgroundColor: "#dbeafe" },
  { id: "violet", textColor: "#4c1d95", backgroundColor: "#ede9fe" },
];

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  if (!channels) return 0;
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("NodeColorPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supports every text and background color action from the keyboard", async () => {
    const user = userEvent.setup();
    render(<NodeColorPanel />);

    const trigger = screen.getByRole("button", { name: "canvas.nodeColors" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const actions = [
      ...COLOR_PAIRS.map((pair) => ({
        button: screen.getByRole("button", {
          name: `canvas.colorPair: canvas.colorPairNames.${pair.id}`,
        }),
        patch: { textColor: pair.textColor, backgroundColor: pair.backgroundColor },
      })),
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

    const customTextColor = screen.getByLabelText("canvas.customTextColor");
    while (document.activeElement !== customTextColor) await user.tab();
    fireEvent.change(customTextColor, { target: { value: "#123456" } });
    expect(mocks.updateTextNode).toHaveBeenLastCalledWith("node", { textColor: "#123456" });

    const customBackgroundColor = screen.getByLabelText("canvas.customBackgroundColor");
    while (document.activeElement !== customBackgroundColor) await user.tab();
    fireEvent.change(customBackgroundColor, { target: { value: "#abcdef" } });
    expect(mocks.updateTextNode).toHaveBeenLastCalledWith("node", {
      backgroundColor: "#abcdef",
    });
  });

  it("offers preset pairs that meet enhanced text contrast", () => {
    for (const pair of COLOR_PAIRS) {
      expect(contrastRatio(pair.textColor, pair.backgroundColor)).toBeGreaterThanOrEqual(7);
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
