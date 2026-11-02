import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasCard } from "@/components/canvas/CanvasCard";
import { createDefaultCanvasDoc } from "@/features/canvas/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

function renderCard() {
  render(
    <CanvasCard
      canvas={{
        id: "canvas",
        title: "Map",
        doc: createDefaultCanvasDoc(),
        pinned: false,
        order: 0,
        createdAt: 1,
        updatedAt: 1,
        contentUpdatedAt: 1,
      }}
      onOpen={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onTogglePinned={vi.fn()}
    />
  );
}

describe("CanvasCard", () => {
  it("keeps the rename input outside the open-canvas button", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "canvas.renameCanvas" }));
    expect(screen.getByDisplayValue("Map").closest("button")).toBeNull();
  });

  it("swaps the metadata for the delete prompt so it fits the fixed-height card", () => {
    renderCard();
    expect(screen.getByText("canvas.nodeCount")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "canvas.deleteCanvas" }));
    expect(screen.getByText("canvas.deleteCanvasConfirm")).toBeInTheDocument();
    expect(screen.queryByText("canvas.nodeCount")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(screen.getByText("canvas.nodeCount")).toBeInTheDocument();
  });
});
