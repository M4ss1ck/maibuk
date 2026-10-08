import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "@/components/ui/ResizeHandle";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { width?: number }) =>
      key === "nav.sidebarWidthValue" ? `${options?.width} pixels` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const MIN = 200;
const MAX = 480;

function Harness({
  side,
  initial = 280,
  onResize,
}: {
  side: "left" | "right";
  initial?: number;
  onResize?: (width: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ResizeHandle
      side={side}
      value={value}
      min={MIN}
      max={MAX}
      label="Resize panel"
      onResize={(width) => {
        setValue(width);
        onResize?.(width);
      }}
    />
  );
}

function getHandle() {
  return screen.getByRole("separator", { name: "Resize panel" });
}

describe("ResizeHandle", () => {
  it("renders a focusable vertical separator with its value range", () => {
    render(<Harness side="right" />);

    const handle = getHandle();
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("tabindex", "0");
    expect(handle).toHaveAttribute("aria-valuenow", "280");
    expect(handle).toHaveAttribute("aria-valuemin", "200");
    expect(handle).toHaveAttribute("aria-valuemax", "480");
    expect(handle).toHaveAttribute("aria-valuetext", "280 pixels");
  });

  it("widens a left panel with ArrowRight and narrows it with ArrowLeft", async () => {
    const user = userEvent.setup();
    render(<Harness side="right" />);

    const handle = getHandle();
    handle.focus();

    await user.keyboard("{ArrowRight}");
    expect(handle).toHaveAttribute("aria-valuenow", "296");
    expect(handle).toHaveAttribute("aria-valuetext", "296 pixels");
    expect(handle).toHaveFocus();

    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(handle).toHaveAttribute("aria-valuenow", "264");
    expect(handle).toHaveFocus();
  });

  it("widens a right panel with ArrowLeft and narrows it with ArrowRight", async () => {
    const user = userEvent.setup();
    render(<Harness side="left" />);

    const handle = getHandle();
    handle.focus();

    await user.keyboard("{ArrowLeft}");
    expect(handle).toHaveAttribute("aria-valuenow", "296");

    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(handle).toHaveAttribute("aria-valuenow", "264");
  });

  it("clamps keyboard resizing at the maximum", async () => {
    const user = userEvent.setup();
    render(<Harness side="right" initial={472} />);

    const handle = getHandle();
    handle.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");

    expect(handle).toHaveAttribute("aria-valuenow", "480");
  });

  it("clamps keyboard resizing at the minimum", async () => {
    const user = userEvent.setup();
    render(<Harness side="right" initial={208} />);

    const handle = getHandle();
    handle.focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");

    expect(handle).toHaveAttribute("aria-valuenow", "200");
  });

  it("leaves the width unchanged on vertical arrows", async () => {
    const user = userEvent.setup();
    render(<Harness side="right" />);

    const handle = getHandle();
    handle.focus();
    await user.keyboard("{ArrowUp}{ArrowDown}");

    expect(handle).toHaveAttribute("aria-valuenow", "280");
    expect(handle).toHaveFocus();
  });

  it("resizes on a mouse drag, clamped to the range", () => {
    const onResize = vi.fn();
    const { container } = render(<Harness side="right" onResize={onResize} />);
    const handle = container.querySelector(".cursor-col-resize");
    expect(handle).not.toBeNull();

    fireEvent.mouseDown(handle as Element, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 150 });
    expect(onResize).toHaveBeenLastCalledWith(330);

    fireEvent.mouseMove(document, { clientX: 1000 });
    expect(onResize).toHaveBeenLastCalledWith(480);

    fireEvent.mouseUp(document);
    fireEvent.mouseMove(document, { clientX: 100 });
    expect(onResize).toHaveBeenLastCalledWith(480);
  });

  it("drags a right panel in the opposite direction", () => {
    const onResize = vi.fn();
    const { container } = render(<Harness side="left" onResize={onResize} />);
    const handle = container.querySelector(".cursor-col-resize");

    fireEvent.mouseDown(handle as Element, { clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 150 });
    expect(onResize).toHaveBeenLastCalledWith(330);

    fireEvent.mouseUp(document);
  });
});
