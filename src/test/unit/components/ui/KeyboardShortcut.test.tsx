import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KeyboardShortcut } from "@/components/ui/KeyboardShortcut";

describe("KeyboardShortcut", () => {
  it("renders each key in a combination as its own chip", () => {
    const { container } = render(
      <KeyboardShortcut shortcut={{ groups: [["Ctrl", "S"]], isSequence: false }} />,
    );

    expect(container.querySelectorAll("kbd")).toHaveLength(2);
    expect(screen.getByText("Ctrl").tagName).toBe("KBD");
    expect(screen.getByText("S").tagName).toBe("KBD");
  });

  it("separates sequence groups with a visible arrow", () => {
    render(
      <KeyboardShortcut
        shortcut={{ groups: [["G"], ["N"]], isSequence: true }}
      />,
    );

    expect(screen.getByText("→")).toBeVisible();
  });

  it("does not add arrows between alternative groups", () => {
    render(
      <KeyboardShortcut
        shortcut={{ groups: [["↑/↓"], ["j/k"]], isSequence: false }}
      />,
    );

    expect(screen.queryByText("→")).not.toBeInTheDocument();
  });

  it("applies the shortcut root and always-visible classes", () => {
    const { container } = render(
      <KeyboardShortcut
        shortcut={{ groups: [["?"]], isSequence: false }}
        alwaysVisible
      />,
    );

    expect(container.firstChild).toHaveClass("kbd-shortcut", "kbd-shortcut-always");
  });
});
