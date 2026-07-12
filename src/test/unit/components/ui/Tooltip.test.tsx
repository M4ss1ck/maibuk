import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Tooltip, TooltipGroup } from "@/components/ui/Tooltip";

const invalidShortcutProps = (
  // @ts-expect-error shortcut and keys are mutually exclusive.
  <Tooltip content="Save" shortcut="editor.save" keys={["Ctrl+S"]}>
    <button type="button">Save book</button>
  </Tooltip>
);
void invalidShortcutProps;

describe("Tooltip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => vi.runOnlyPendingTimers());
    vi.useRealTimers();
  });

  it("renders only its child initially", () => {
    render(
      <Tooltip content="Save">
        <button type="button">Save book</button>
      </Tooltip>,
    );

    expect(screen.getByRole("button", { name: "Save book" })).toBeVisible();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens after the 500ms hover delay", () => {
    render(
      <Tooltip content="Save">
        <button type="button">Save book</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(499));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));

    expect(screen.getByRole("tooltip")).toHaveTextContent("Save");
  });

  it("separates floating positioning from surface animation transforms", () => {
    render(
      <Tooltip content="Save">
        <button type="button">Save book</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(600));

    const positioningElement = screen.getByRole("tooltip");
    const surface = positioningElement.firstElementChild as HTMLElement;
    expect(positioningElement.style.transform).toContain("translate(");
    expect(positioningElement.style.transform).not.toContain("translateY");
    expect(surface.style.transform).toContain("translateY");
  });

  it("opens immediately on focus and closes after blur", () => {
    render(
      <Tooltip content="Save">
        <button type="button">Save book</button>
      </Tooltip>,
    );

    const child = screen.getByRole("button");
    fireEvent.focus(child);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Save");
    fireEvent.blur(child);
    act(() => vi.advanceTimersByTime(200));

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not open from a touch start", () => {
    render(
      <Tooltip content="Save">
        <button type="button">Save book</button>
      </Tooltip>,
    );

    fireEvent.touchStart(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(600));

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens sibling tooltips instantly within a delay group", () => {
    render(
      <TooltipGroup>
        <Tooltip content="First tooltip">
          <button type="button">First</button>
        </Tooltip>
        <Tooltip content="Second tooltip">
          <button type="button">Second</button>
        </Tooltip>
      </TooltipGroup>,
    );

    const first = screen.getByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });
    fireEvent.mouseEnter(first);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("tooltip")).toHaveTextContent("First tooltip");

    fireEvent.mouseLeave(first);
    act(() => vi.advanceTimersByTime(50));
    expect(screen.getByRole("tooltip")).toHaveTextContent("First tooltip");
    fireEvent.mouseEnter(second);
    act(() => vi.advanceTimersByTime(1));

    expect(
      screen
        .getAllByRole("tooltip")
        .some((tooltip) => tooltip.textContent === "Second tooltip"),
    ).toBe(true);
  });

  it("closes without an additional standalone hover delay", () => {
    render(
      <Tooltip content="Save">
        <button type="button">Save book</button>
      </Tooltip>,
    );

    const child = screen.getByRole("button");
    fireEvent.mouseEnter(child);
    act(() => vi.advanceTimersByTime(600));
    fireEvent.mouseLeave(child);
    act(() => vi.advanceTimersByTime(300));

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renders the registered shortcut as separate keyboard chips", () => {
    render(
      <Tooltip content="Save" shortcut="editor.save">
        <button type="button">Save book</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(600));

    expect(screen.getByRole("tooltip").querySelectorAll("kbd")).toHaveLength(2);
  });

  it("keeps shortcut chips subject to the global visibility preference", () => {
    render(
      <Tooltip content="Save" shortcut="editor.save">
        <button type="button">Save book</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(600));

    expect(
      screen.getByRole("tooltip").querySelector(".kbd-shortcut"),
    ).not.toHaveClass("kbd-shortcut-always");
  });

  it("renders ad-hoc keys as one keyboard chip", () => {
    render(
      <Tooltip content="Open book" keys={["1-9"]}>
        <button type="button">Open book</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(600));

    expect(screen.getByRole("tooltip").querySelectorAll("kbd")).toHaveLength(1);
  });

  it("closes on Escape", () => {
    render(
      <Tooltip content="Save">
        <button type="button">Save book</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(600));
    fireEvent.keyDown(document, { key: "Escape" });
    act(() => vi.advanceTimersByTime(200));

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("describes its child while open", () => {
    render(
      <Tooltip content="Save">
        <button type="button">Save book</button>
      </Tooltip>,
    );

    const child = screen.getByRole("button");
    fireEvent.mouseEnter(child);
    act(() => vi.advanceTimersByTime(600));

    expect(child).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);
  });

  it("never opens when disabled", () => {
    render(
      <Tooltip content="Save" disabled>
        <button type="button">Save book</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(600));

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("preserves the child click handler", () => {
    const onClick = vi.fn();
    render(
      <Tooltip content="Save">
        <button type="button" onClick={onClick}>
          Save book
        </button>
      </Tooltip>,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders the markdown hint on its own row below the primary row", () => {
    render(
      <Tooltip content="Bold" shortcut="editor.bold" markdown="**bold**">
        <button type="button">Bold</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(600));

    const primaryRow = screen.getByTestId("tooltip-primary-row");
    const markdownRow = screen.getByTestId("tooltip-markdown-row");
    expect(primaryRow).toHaveTextContent("Bold");
    expect(primaryRow.querySelectorAll("kbd").length).toBeGreaterThan(0);
    expect(primaryRow.nextElementSibling).toBe(markdownRow);
    expect(markdownRow).toHaveTextContent("**bold**");
    expect(markdownRow.querySelector("kbd")).toBeNull();

    const hint = markdownRow.querySelector("code");
    expect(hint).not.toBeNull();
    expect(hint).toHaveTextContent("**bold**");
    expect(hint).not.toHaveClass("border");
    expect(hint).not.toHaveClass("rounded");
    expect(hint).not.toHaveClass("bg-muted");
    expect(hint).not.toHaveClass("px-1.5");
    expect(hint).not.toHaveClass("py-0.5");
  });

  it("renders one hint per spelling in the same markdown row", () => {
    render(
      <Tooltip
        content="Bold"
        shortcut="editor.bold"
        markdown={["**bold**", "__bold__"]}
      >
        <button type="button">Bold</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(600));

    const chips = screen
      .getByTestId("tooltip-markdown-row")
      .querySelectorAll("code");
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent("**bold**");
    expect(chips[1]).toHaveTextContent("__bold__");
  });

  it("syntax-highlights markdown hints like a markdown code block", () => {
    render(
      <Tooltip content="Bold" shortcut="editor.bold" markdown="**bold**">
        <button type="button">Bold</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(600));

    const hint = screen
      .getByTestId("tooltip-markdown-row")
      .querySelector("code");
    expect(hint).toHaveClass("markdown-hint");
    expect(hint?.querySelector(".hljs-strong")).not.toBeNull();
    expect(hint).toHaveTextContent("**bold**");
  });

  it("renders no markdown row when the prop is absent", () => {
    render(
      <Tooltip content="Bold" shortcut="editor.bold">
        <button type="button">Bold</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(600));

    expect(screen.getByTestId("tooltip-primary-row")).toHaveTextContent("Bold");
    expect(screen.queryByTestId("tooltip-markdown-row")).toBeNull();
    expect(screen.getByRole("tooltip").querySelector("code")).toBeNull();
  });
});
