import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contrastRatio } from "@/lib/color";

const mocks = vi.hoisted(() => ({
  updateTextNode: vi.fn(),
  previewNodeColor: vi.fn(),
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
    selector({
      ...mocks.state,
      updateTextNode: mocks.updateTextNode,
      previewNodeColor: mocks.previewNodeColor,
    }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { NodeColorPanel } = await import("@/features/canvas/NodeColorPanel");

const COLOR_PAIRS = [
  { id: "slate", textColor: "#1e293b", backgroundColor: "#e2e8f0" },
  { id: "rose", textColor: "#7f1d1d", backgroundColor: "#fee2e2" },
  { id: "amber", textColor: "#451a03", backgroundColor: "#fef3c7" },
  { id: "emerald", textColor: "#064e3b", backgroundColor: "#d1fae5" },
  { id: "blue", textColor: "#1e3a8a", backgroundColor: "#dbeafe" },
  { id: "violet", textColor: "#4c1d95", backgroundColor: "#ede9fe" },
];

async function openPanel() {
  const user = userEvent.setup();
  render(<NodeColorPanel />);
  const trigger = screen.getByRole("button", { name: "canvas.nodeColors" });
  trigger.focus();
  await user.keyboard("{Enter}");
  return user;
}

async function activateInOrder(
  user: ReturnType<typeof userEvent.setup>,
  actions: Array<{ button: HTMLElement; patch: Record<string, string> }>
) {
  for (const { button, patch } of actions) {
    while (document.activeElement !== button) await user.tab();
    await user.keyboard(" ");
    expect(mocks.updateTextNode).toHaveBeenLastCalledWith("node", patch);
  }
}

describe("NodeColorPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies every accessible color pair from the keyboard", async () => {
    const user = await openPanel();

    await activateInOrder(
      user,
      COLOR_PAIRS.map((pair) => ({
        button: screen.getByRole("button", {
          name: `canvas.colorPair: canvas.colorPairNames.${pair.id}`,
        }),
        patch: { textColor: pair.textColor, backgroundColor: pair.backgroundColor },
      }))
    );
  });

  it("keeps automatic text and selects a custom text color by keyboard", async () => {
    const user = await openPanel();
    await activateInOrder(user, [
      {
        button: screen.getByRole("button", { name: "canvas.automaticTextColor" }),
        patch: { textColor: "" },
      },
    ]);
    const trigger = screen.getByRole("button", { name: "canvas.customTextColor" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const field = await screen.findByRole("textbox", { name: "colorPicker.hexValue" });
    await user.clear(field);
    await user.type(field, "#123456{Enter}");
    expect(mocks.updateTextNode).toHaveBeenLastCalledWith("node", { textColor: "#123456" });
  });

  it("can choose the displayed text fallback as an explicit color", async () => {
    const user = await openPanel();
    const trigger = screen.getByRole("button", { name: "canvas.customTextColor" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const field = await screen.findByRole("textbox", { name: "colorPicker.hexValue" });
    expect(field).toHaveValue("#1C1917");
    await user.click(field);
    await user.keyboard("{Enter}");
    expect(mocks.updateTextNode).toHaveBeenLastCalledWith("node", { textColor: "#1C1917" });
  });

  it("keeps transparent background and selects a custom background by keyboard", async () => {
    const user = await openPanel();
    await activateInOrder(user, [
      {
        button: screen.getByRole("button", { name: "canvas.transparentBackground" }),
        patch: { backgroundColor: "" },
      },
    ]);
    const trigger = screen.getByRole("button", { name: "canvas.customBackgroundColor" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const field = await screen.findByRole("textbox", { name: "colorPicker.hexValue" });
    await user.clear(field);
    await user.type(field, "#abcdef{Enter}");
    expect(mocks.updateTextNode).toHaveBeenLastCalledWith("node", { backgroundColor: "#ABCDEF" });
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
