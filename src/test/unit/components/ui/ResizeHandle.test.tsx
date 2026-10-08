import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import { installPaneMemory } from "@/lib/arrow-navigation/panes";

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

/** The handle inside the Pane it resizes, the way every screen places it. */
function PaneHarness() {
  return (
    <>
      <button type="button">Outside</button>
      <section data-focus-pane="panel" tabIndex={-1} aria-label="Panel">
        <button type="button">First</button>
        <button type="button">Second</button>
        <Harness side="right" />
      </section>
    </>
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

  it("resizes on a pointer drag, clamped to the range", () => {
    const onResize = vi.fn();
    const { container } = render(<Harness side="right" onResize={onResize} />);
    const handle = container.querySelector(".cursor-col-resize");
    expect(handle).not.toBeNull();

    fireEvent.pointerDown(handle as Element, { clientX: 100 });
    fireEvent.pointerMove(document, { clientX: 150 });
    expect(onResize).toHaveBeenLastCalledWith(330);

    fireEvent.pointerMove(document, { clientX: 1000 });
    expect(onResize).toHaveBeenLastCalledWith(480);

    fireEvent.pointerUp(document);
    fireEvent.pointerMove(document, { clientX: 100 });
    expect(onResize).toHaveBeenLastCalledWith(480);
  });

  it("resizes on a touch drag, and a cancelled touch ends the drag", () => {
    const onResize = vi.fn();
    const { container } = render(<Harness side="right" onResize={onResize} />);
    const handle = container.querySelector(".cursor-col-resize") as Element;
    // A touch on the handle drags it instead of scrolling the page.
    expect(handle).toHaveClass("touch-none");

    fireEvent.pointerDown(handle, { clientX: 100, pointerType: "touch" });
    fireEvent.pointerMove(document, { clientX: 140, pointerType: "touch" });
    expect(onResize).toHaveBeenLastCalledWith(320);

    fireEvent.pointerCancel(document, { pointerType: "touch" });
    fireEvent.pointerMove(document, { clientX: 200, pointerType: "touch" });
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it("drags a right panel in the opposite direction", () => {
    const onResize = vi.fn();
    const { container } = render(<Harness side="left" onResize={onResize} />);
    const handle = container.querySelector(".cursor-col-resize");

    fireEvent.pointerDown(handle as Element, { clientX: 200 });
    fireEvent.pointerMove(document, { clientX: 150 });
    expect(onResize).toHaveBeenLastCalledWith(330);

    fireEvent.pointerUp(document);
  });

  describe("Escape", () => {
    let uninstall: (() => void) | undefined;
    afterEach(() => {
      uninstall?.();
      uninstall = undefined;
    });

    it("returns focus to the panel control used before the handle, keeping the width", async () => {
      const user = userEvent.setup();
      render(<PaneHarness />);

      screen.getByRole("button", { name: "Second" }).focus();
      await user.tab();
      const handle = getHandle();
      expect(handle).toHaveFocus();
      await user.keyboard("{ArrowRight}");

      await user.keyboard("{Escape}");
      expect(screen.getByRole("button", { name: "Second" })).toHaveFocus();
      expect(handle).toHaveAttribute("aria-valuenow", "296");
    });

    it("lands in the panel it resizes when focus arrived from outside the panel", async () => {
      const user = userEvent.setup();
      uninstall = installPaneMemory();
      render(<PaneHarness />);

      screen.getByRole("button", { name: "Outside" }).focus();
      // F6 or a Tutorial step can land on the handle from another Pane, and
      // Pane memory then names the handle as the Pane's last used control.
      getHandle().focus();

      await user.keyboard("{Escape}");
      expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    });

    it("keeps the Escape it handles from the panel around it", async () => {
      const user = userEvent.setup();
      const onPanelEscape = vi.fn();
      render(
        <section
          data-focus-pane="panel"
          tabIndex={-1}
          aria-label="Panel"
          onKeyDown={(event) => {
            if (event.key === "Escape") onPanelEscape();
          }}
        >
          <button type="button">First</button>
          <Harness side="left" />
        </section>
      );

      await user.tab();
      await user.tab();
      await user.keyboard("{Escape}");
      expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
      expect(onPanelEscape).not.toHaveBeenCalled();

      await user.keyboard("{Escape}");
      expect(onPanelEscape).toHaveBeenCalledTimes(1);
    });

    it("lands in the panel when the control used before the handle is gone", async () => {
      const user = userEvent.setup();
      uninstall = installPaneMemory();
      render(<PaneHarness />);

      const second = screen.getByRole("button", { name: "Second" });
      second.focus();
      await user.tab();
      second.remove();

      await user.keyboard("{Escape}");
      expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    });
  });
});
