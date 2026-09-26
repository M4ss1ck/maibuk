import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const PRESETS = [
    { id: "6x9", name: "6x9", description: "6×9 in", width: 1800, height: 2700, dpi: 300 },
    { id: "5x8", name: "5x8", description: "5×8 in", width: 1500, height: 2400, dpi: 300 },
  ];
  return {
    PRESETS,
    getPreset: (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0],
    buildTemplateScene: vi.fn(),
    createTextLayer: vi.fn(() => ({ id: "text", type: "text" })),
    createShapeLayer: vi.fn(() => ({ id: "shape", type: "shape" })),
    createImageLayer: vi.fn(),
    store: {
      scene: {
        doc: {
          presetId: "6x9",
          width: 1800,
          height: 2700,
          dpi: 300,
          bleed: 0,
          safeMargin: 90,
        },
        layers: [],
      },
      selectedId: null,
      replaceScene: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      duplicateSelected: vi.fn(),
      setDoc: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      alignSelected: vi.fn(),
      overlays: false,
      snapping: false,
      setOverlays: vi.fn(),
      setSnapping: vi.fn(),
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../../features/covers/store", () => ({
  useCoverStore: (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store),
}));

vi.mock("../../../../features/covers/scene/defaults", () => ({
  PRESETS: mocks.PRESETS,
  createImageLayer: mocks.createImageLayer,
  createShapeLayer: mocks.createShapeLayer,
  createTextLayer: mocks.createTextLayer,
  getPreset: mocks.getPreset,
}));

vi.mock("../../../../features/covers/scene/templates", () => ({
  TEMPLATES: [
    { id: "t1", name: "Template 1" },
    { id: "t2", name: "Template 2" },
  ],
  buildTemplateScene: mocks.buildTemplateScene,
}));

vi.mock("../../../../components/ui", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipGroup: ({ children }: { children: ReactNode }) => children,
}));

import { Toolbar } from "@/components/cover-editor/Toolbar";

function renderToolbar() {
  const onExport = vi.fn();
  const view = render(<Toolbar onExport={onExport} bookTitle="Book" bookAuthor="Author" />);
  return { onExport, ...view };
}

async function openMenu(label: string) {
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: label });
  trigger.focus();
  await user.keyboard("{Enter}");
  await screen.findByRole("menu");
  return { user, trigger };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Cover toolbar menus (keyboard)", () => {
  it("advertises a menu on every dropdown trigger", () => {
    renderToolbar();
    for (const name of [
      "6x9",
      "cover.templates",
      "cover.addText",
      "cover.addShape",
      "cover.export",
    ]) {
      // React Aria reports the menu as `aria-haspopup="true"` (a menu).
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-haspopup", "true");
    }
  });

  it("moves through the Templates menu with arrows and applies the focused template", async () => {
    renderToolbar();
    const { user } = await openMenu("cover.templates");

    const first = screen.getByRole("menuitem", { name: "Template 1" });
    expect(first).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    const second = screen.getByRole("menuitem", { name: "Template 2" });
    expect(second).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(mocks.buildTemplateScene).toHaveBeenCalledWith(
      "t2",
      expect.objectContaining({ title: "Book", author: "Author", presetId: "6x9" })
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("selects a Cover Size Preset by arrow key", async () => {
    renderToolbar();
    const { user } = await openMenu("6x9");

    expect(screen.getByRole("menuitem", { name: /6x9/ })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /5x8/ })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(mocks.store.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ presetId: "5x8", width: 1500, height: 2400, dpi: 300 })
    );
  });

  it("adds a text and a shape layer from their menus", async () => {
    renderToolbar();

    const text = await openMenu("cover.addText");
    expect(screen.getByRole("menuitem", { name: "cover.toolbar.title" })).toHaveFocus();
    await text.user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "cover.toolbar.subtitle" })).toHaveFocus();
    await text.user.keyboard("{Enter}");
    expect(mocks.createTextLayer).toHaveBeenCalledWith(
      expect.objectContaining({ role: "subtitle" })
    );
    expect(mocks.store.addLayer).toHaveBeenCalledWith({ id: "text", type: "text" });

    const shape = await openMenu("cover.addShape");
    expect(screen.getByRole("menuitem", { name: "cover.shape.rect" })).toHaveFocus();
    await shape.user.keyboard("{Enter}");
    expect(mocks.createShapeLayer).toHaveBeenCalledWith(
      expect.objectContaining({ shape: "rect", docWidth: 1800, docHeight: 2700 })
    );
  });

  it("exports the format the arrow keys land on", async () => {
    const { onExport } = renderToolbar();
    const { user } = await openMenu("cover.export");

    expect(screen.getByRole("menuitem", { name: "cover.pngExport" })).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(onExport).toHaveBeenCalledWith("pdf");
  });

  it("closes with Escape and restores focus to the trigger", async () => {
    renderToolbar();
    const { user, trigger } = await openMenu("cover.templates");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe("Cover layout aid toggles", () => {
  it("exposes and flips the pressed state of the overlays and snapping toggles", async () => {
    const user = userEvent.setup();
    renderToolbar();

    const overlays = screen.getByRole("button", { name: "cover.toggleOverlays" });
    const snapping = screen.getByRole("button", { name: "cover.toggleSnapping" });
    expect(overlays).toHaveAttribute("aria-pressed", "false");
    expect(snapping).toHaveAttribute("aria-pressed", "false");

    overlays.focus();
    await user.keyboard("{Enter}");
    expect(mocks.store.setOverlays).toHaveBeenCalledWith(true);

    snapping.focus();
    await user.keyboard(" ");
    expect(mocks.store.setSnapping).toHaveBeenCalledWith(true);
  });
});
