import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponsiveToggleGroup } from "../../../../components/ui/ResponsiveToggleGroup";
import type { ResponsiveToggleOption } from "../../../../components/ui/ResponsiveToggleGroup";

const options: ResponsiveToggleOption<"list" | "tree">[] = [
  {
    value: "list",
    label: "List",
    icon: <span aria-hidden="true">L</span>,
    labelTestId: "toggle-label-list",
  },
  {
    value: "tree",
    label: "Tree",
    icon: <span aria-hidden="true">T</span>,
    labelTestId: "toggle-label-tree",
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ResponsiveToggleGroup", () => {
  it("shows labels when the measured full toggle fits the available width", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("data-testid") === "view-toggle-group" ? 180 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("data-testid") === "view-toggle-measure" ? 140 : 0;
    });

    render(
      <ResponsiveToggleGroup
        value="list"
        options={options}
        onChange={vi.fn()}
        testId="view"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("view-toggle-group")).toHaveAttribute("data-label-mode", "full");
    });

    expect(screen.getByTestId("toggle-label-list")).not.toHaveClass("sr-only");
    expect(screen.getByTestId("toggle-label-tree")).not.toHaveClass("sr-only");
  });

  it("hides labels visually when the measured full toggle does not fit", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("data-testid") === "view-toggle-group" ? 110 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("data-testid") === "view-toggle-measure" ? 160 : 0;
    });

    render(
      <ResponsiveToggleGroup
        value="list"
        options={options}
        onChange={vi.fn()}
        testId="view"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("view-toggle-group")).toHaveAttribute("data-label-mode", "icon");
    });

    expect(screen.getByTestId("toggle-label-list")).toHaveClass("sr-only");
    expect(screen.getByTestId("toggle-label-tree")).toHaveClass("sr-only");
  });

  it("calls onChange with the selected option value", () => {
    const onChange = vi.fn();

    render(
      <ResponsiveToggleGroup
        value="list"
        options={options}
        onChange={onChange}
        testId="view"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    expect(onChange).toHaveBeenCalledWith("tree");
  });
});
