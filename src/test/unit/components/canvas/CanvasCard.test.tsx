import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasCard, CanvasCardFace } from "@/components/canvas/CanvasCard";
import type { Canvas } from "@/features/canvas/types";
import { createDefaultCanvasDoc } from "@/features/canvas/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

function makeCanvas(title: string): Canvas {
  return {
    id: "canvas",
    title,
    doc: createDefaultCanvasDoc(),
    pinned: false,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    contentUpdatedAt: 1,
  };
}

function renderCard() {
  render(
    <CanvasCard
      canvas={makeCanvas("Map")}
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

  it("saves a rename on Enter but not while an IME is composing", () => {
    const onRename = vi.fn();
    render(
      <CanvasCard
        canvas={makeCanvas("Map")}
        onOpen={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
        onTogglePinned={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "canvas.renameCanvas" }));
    const field = screen.getByDisplayValue("Map");
    fireEvent.change(field, { target: { value: "Atlas" } });

    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Atlas")).toBeInTheDocument();

    fireEvent.keyDown(field, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("Atlas");
    expect(screen.queryByDisplayValue("Atlas")).toBeNull();
  });
});

describe("CanvasCardFace", () => {
  it("renders the title and metadata with no actions of its own", () => {
    render(<CanvasCardFace canvas={makeCanvas("Map")} />);

    expect(screen.getByRole("heading", { name: "Map" })).toBeInTheDocument();
    expect(screen.getByText("canvas.nodeCount")).toBeInTheDocument();
    expect(screen.getByText("canvas.edgeCount")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
