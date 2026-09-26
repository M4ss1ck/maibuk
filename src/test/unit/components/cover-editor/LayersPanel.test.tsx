import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const layers = [
    {
      id: "layer-title",
      name: "title",
      type: "text",
      text: "Arrival",
      hidden: false,
      locked: false,
    },
    {
      id: "layer-rect",
      name: "rect",
      type: "shape",
      hidden: true,
      locked: true,
    },
  ];
  return {
    layers,
    store: {
      scene: { layers },
      selectedId: "layer-title",
      select: vi.fn(),
      updateLayer: vi.fn(),
      toggleHidden: vi.fn(),
      toggleLocked: vi.fn(),
      bringForward: vi.fn(),
      sendBackward: vi.fn(),
    },
  };
});

const strings: Record<string, string> = {
  "cover.layers.title": "Layers",
  "cover.layers.empty": "No layers yet",
  "cover.layers.reorderUp": "Bring forward",
  "cover.layers.reorderDown": "Send backward",
  "cover.layers.toggleVisible": "Toggle visibility",
  "cover.layers.toggleLock": "Toggle lock",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => strings[key] ?? key }),
}));

vi.mock("../../../../features/covers/store", () => ({
  useCoverStore: (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store),
}));

vi.mock("../../../../components/ui", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

import { LayersPanel } from "@/components/cover-editor/panels/LayersPanel";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LayersPanel", () => {
  it("renders one row per layer, top first, named by its label", () => {
    render(<LayersPanel />);
    const rows = screen.getAllByRole("button", { name: /Arrival|rect/ });
    expect(rows.map((row) => row.textContent)).toEqual(["rect", "Arrival"]);
  });

  it("exposes the hidden and locked state on the toggle buttons", () => {
    render(<LayersPanel />);
    const visibility = screen.getAllByRole("button", { name: "Toggle visibility" });
    const lock = screen.getAllByRole("button", { name: "Toggle lock" });
    // Top row (rect) is hidden and locked; the title row is neither.
    expect(visibility[0]).toHaveAttribute("aria-pressed", "true");
    expect(visibility[1]).toHaveAttribute("aria-pressed", "false");
    expect(lock[0]).toHaveAttribute("aria-pressed", "true");
    expect(lock[1]).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles visibility and lock on the pressed row", async () => {
    const user = userEvent.setup();
    render(<LayersPanel />);
    const visibility = screen.getAllByRole("button", { name: "Toggle visibility" })[1];
    await user.click(visibility);
    expect(mocks.store.toggleHidden).toHaveBeenCalledWith("layer-title");

    const lock = screen.getAllByRole("button", { name: "Toggle lock" })[0];
    await user.click(lock);
    expect(mocks.store.toggleLocked).toHaveBeenCalledWith("layer-rect");
  });
});
