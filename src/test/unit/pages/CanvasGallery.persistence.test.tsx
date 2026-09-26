import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({
  IS_ANDROID: false,
  IS_TAURI: false,
  IS_DESKTOP: false,
  IS_WEB: false,
  getOS: vi.fn(),
  setLaunchOnStartup: vi.fn(),
}));

const { mockNavigate, canvasState } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  canvasState: {
    canvases: [
      { id: "c1", title: "Alpha", pinned: false, doc: { nodes: [], edges: [] }, updatedAt: 0 },
      { id: "c2", title: "Beta", pinned: false, doc: { nodes: [], edges: [] }, updatedAt: 0 },
    ],
    loadCanvases: vi.fn(() => Promise.resolve()),
    createCanvas: vi.fn(() => Promise.resolve({ id: "c3" })),
    deleteCanvas: vi.fn(),
    renameCanvas: vi.fn(),
    updateCanvas: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/features/canvas/store", () => ({
  useCanvasStore: (selector: (s: typeof canvasState) => unknown) => selector(canvasState),
}));

import { CanvasGallery } from "@/pages/CanvasGallery";
import { useSettingsStore } from "@/features/settings/store";

describe("CanvasGallery search persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ canvasSearch: "" });
  });

  it("activates a card action button without opening the canvas", async () => {
    const user = userEvent.setup();
    render(<CanvasGallery />);

    const pin = (await screen.findAllByRole("button", { name: "canvas.pinCanvas" }))[0];
    pin.focus();
    await user.keyboard("{Enter}");

    expect(canvasState.updateCanvas).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("keeps the search query when the page is left and reopened", async () => {
    const user = userEvent.setup();
    const first = render(<CanvasGallery />);

    await user.type(screen.getByPlaceholderText("canvas.searchPlaceholder"), "Beta");
    expect(screen.getByPlaceholderText("canvas.searchPlaceholder")).toHaveValue("Beta");

    first.unmount();
    render(<CanvasGallery />);

    expect(screen.getByPlaceholderText("canvas.searchPlaceholder")).toHaveValue("Beta");
  });

  it("marks the gallery as a container and lays the canvas grid out with container variants", () => {
    const { container } = render(<CanvasGallery />);

    expect(container.firstElementChild).toHaveClass("@container");

    const grid = screen.getByText("Alpha").closest(".grid");
    expect(grid).not.toBeNull();
    expect(grid).toHaveClass(
      "grid-cols-1",
      "@sm:grid-cols-2",
      "@3xl:grid-cols-3",
      "@5xl:grid-cols-4"
    );
    expect(grid).not.toHaveClass("lg:grid-cols-3", "xl:grid-cols-4");
  });

  it("moves between cards with the arrow keys and opens the focused card with Enter", async () => {
    const user = userEvent.setup();
    render(<CanvasGallery />);

    const rows = await screen.findAllByRole("row");
    expect(rows).toHaveLength(2);

    rows[0].focus();
    expect(rows[0]).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(rows[1]).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(mockNavigate).toHaveBeenCalledWith("/canvas/c2");
  });
});
