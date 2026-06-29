import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasCard } from "@/components/canvas/CanvasCard";
import { createDefaultCanvasDoc } from "@/features/canvas/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

describe("CanvasCard", () => {
  it("keeps the rename input outside the open-canvas button", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "canvas.renameCanvas" }));
    expect(screen.getByDisplayValue("Map").closest("button")).toBeNull();
  });
});
