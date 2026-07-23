import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  IS_ANDROID: true,
}));

import { Tooltip } from "@/components/ui/Tooltip";

describe("Tooltip on Android", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => vi.runOnlyPendingTimers());
    vi.useRealTimers();
  });

  it("omits the shortcut chip but keeps the tooltip content", () => {
    render(
      <Tooltip content="Bold" keys={["Ctrl+B"]}>
        <button type="button">Bold</button>
      </Tooltip>
    );

    fireEvent.mouseEnter(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(600));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Bold");
    expect(tooltip.querySelectorAll("kbd")).toHaveLength(0);
  });

  it("still renders markdown hints", () => {
    render(
      <Tooltip content="Bold" keys={["Ctrl+B"]} markdown="**text**">
        <button type="button">Bold</button>
      </Tooltip>
    );

    fireEvent.mouseEnter(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(600));

    expect(screen.getByTestId("tooltip-markdown-row")).toHaveTextContent("**text**");
  });
});
