import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolbarButton } from "@/components/editor/ToolbarButton";

vi.mock("../../../../components/ui", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

describe("ToolbarButton", () => {
  it("reports an active toggle as pressed", () => {
    render(
      <ToolbarButton onClick={vi.fn()} isActive label="Bold">
        B
      </ToolbarButton>
    );

    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reports an inactive toggle as not pressed", () => {
    render(
      <ToolbarButton onClick={vi.fn()} isActive={false} label="Bold">
        B
      </ToolbarButton>
    );

    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "false");
  });

  it("leaves plain actions without a pressed state", () => {
    render(
      <ToolbarButton onClick={vi.fn()} label="Undo">
        U
      </ToolbarButton>
    );

    expect(screen.getByRole("button", { name: "Undo" })).not.toHaveAttribute("aria-pressed");
  });
});
