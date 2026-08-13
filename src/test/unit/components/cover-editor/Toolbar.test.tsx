import { fireEvent, render, screen } from "@testing-library/react";
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
  createImageLayer: vi.fn(),
  createShapeLayer: vi.fn(),
  createTextLayer: vi.fn(),
  getPreset: mocks.getPreset,
}));

vi.mock("../../../../features/covers/scene/templates", () => ({
  TEMPLATES: [{ id: "t1", name: "Template 1" }],
  buildTemplateScene: mocks.buildTemplateScene,
}));

vi.mock("../../../../components/ui", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipGroup: ({ children }: { children: ReactNode }) => children,
}));

import { Toolbar } from "@/components/cover-editor/Toolbar";
import type { ExportChoice } from "@/components/cover-editor/Toolbar";

function renderToolbar() {
  const onExport = vi.fn();
  const view = render(
    <Toolbar onExport={onExport} bookTitle="Book" bookAuthor="Author" />
  );
  return { onExport, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Cover Toolbar dropdowns", () => {
  it("exposes expanded state and closes on Escape with focus on the trigger", async () => {
    const user = userEvent.setup();
    renderToolbar();

    const trigger = screen.getByRole("button", { name: "6x9" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /5x8/ })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /5x8/ })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("restores focus to the trigger after selecting a menu item", async () => {
    const user = userEvent.setup();
    renderToolbar();

    const trigger = screen.getByRole("button", { name: "6x9" });
    await user.click(trigger);
    const fiveByEight = screen.getByRole("button", { name: /5x8/ });
    await user.click(fiveByEight);

    expect(mocks.store.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ presetId: "5x8" })
    );
    expect(screen.queryByRole("button", { name: /5x8/ })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on outside pointer-down and triggers export callbacks", () => {
    const { onExport } = renderToolbar();

    const exportTrigger = screen.getByRole("button", { name: "cover.export" });
    fireEvent.click(exportTrigger);
    expect(exportTrigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "cover.pngExport" }));
    expect(onExport).toHaveBeenCalledWith("png" as ExportChoice);
    expect(exportTrigger).toHaveFocus();

    fireEvent.click(exportTrigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("button", { name: "cover.pngExport" })).not.toBeInTheDocument();
  });

  it("exposes expanded state on every dropdown trigger", async () => {
    const user = userEvent.setup();
    renderToolbar();

    const triggers = [
      screen.getByRole("button", { name: "6x9" }),
      screen.getByRole("button", { name: "cover.templates" }),
      screen.getByRole("button", { name: "cover.addText" }),
      screen.getByRole("button", { name: "cover.addShape" }),
      screen.getByRole("button", { name: "cover.export" }),
    ];
    for (const trigger of triggers) {
      expect(trigger).toHaveAttribute("aria-haspopup", "menu");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      await user.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      await user.keyboard("{Escape}");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    }
  });
});
