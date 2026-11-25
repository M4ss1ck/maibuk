/** @jsxImportSource preact */
/**
 * The Reader Frame's overlays (#943 unit 3): Sheet, Dialog, Popover and Menu.
 * They are Preact portals to the document body, driven here through a real
 * Preact tree in jsdom. Every keyboard path is a real `user-event` press and
 * every assertion is the behavior a reader sees (rendered layer, focus, the
 * chosen row), never an attached handler or an attribute standing in for
 * operability.
 *
 * The layer stack is proven by nesting a Menu inside a Dialog: Escape closes
 * the Menu first and returns focus to the control inside the Dialog, and the
 * next Escape closes the Dialog and returns focus to its trigger.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configure, getConfig, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentChild, RefObject } from "preact";
import { createRef, render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, Menu, type MenuItem, Popover, Sheet } from "./index";

const containers: HTMLElement[] = [];
const nativeWidth = window.innerWidth;
const baseConfig = getConfig();
const sheetCss = readFileSync(join(__dirname, "..", "..", "assets", "ui", "kit.css"), "utf8");

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

async function mount(node: ComponentChild): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  await act(() => {
    render(node, container);
  });
  return container;
}

async function press(action: () => Promise<unknown>): Promise<void> {
  await act(async () => {
    await action();
  });
}

/** A DOMRect for the parts of it the overlays measure. */
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  setWidth(nativeWidth);
  configure({ asyncWrapper: async (callback) => callback() });
});

afterEach(async () => {
  await act(() => {
    for (const container of containers.splice(0)) {
      render(null, container);
      container.remove();
    }
  });
  vi.restoreAllMocks();
  vi.useRealTimers();
  configure({ asyncWrapper: baseConfig.asyncWrapper });
  setWidth(nativeWidth);
});

function SheetCase({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open sheet
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Reading options" doneLabel="Done">
        <button type="button">Body action</button>
      </Sheet>
    </div>
  );
}

function DialogCase({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Import report"
        actions={<button type="button">Save</button>}
      >
        <button type="button">Body action</button>
      </Dialog>
    </div>
  );
}

describe("Sheet", () => {
  it("renders only in Narrow", async () => {
    setWidth(500);
    await mount(<SheetCase startOpen />);
    expect(screen.getByRole("dialog", { name: "Reading options" })).toBeInTheDocument();

    setWidth(1024);
    await act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.queryByRole("dialog", { name: "Reading options" })).not.toBeInTheDocument();
  });

  it("focuses the Done button on open and traps Tab and Shift+Tab", async () => {
    setWidth(500);
    const user = userEvent.setup({ delay: null });
    await mount(<SheetCase startOpen />);

    const done = screen.getByRole("button", { name: "Done" });
    const body = screen.getByRole("button", { name: "Body action" });
    expect(document.activeElement).toBe(done);

    await press(() => user.tab());
    expect(document.activeElement).toBe(body);

    await press(() => user.tab());
    expect(document.activeElement).toBe(done);

    await press(() => user.tab({ shift: true }));
    expect(document.activeElement).toBe(body);
  });

  it("closes on Escape and returns focus to its trigger", async () => {
    setWidth(500);
    const user = userEvent.setup({ delay: null });
    await mount(<SheetCase />);

    const trigger = screen.getByRole("button", { name: "Open sheet" });
    await press(() => user.click(trigger));
    expect(screen.getByRole("dialog", { name: "Reading options" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Done" }));

    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("dialog", { name: "Reading options" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the scrim is clicked", async () => {
    setWidth(500);
    const user = userEvent.setup({ delay: null });
    await mount(<SheetCase />);

    await press(() => user.click(screen.getByRole("button", { name: "Open sheet" })));
    const scrim = document.querySelector(".kit-scrim");
    if (!(scrim instanceof HTMLElement)) throw new Error("Sheet has no scrim");

    await press(() => user.click(scrim));
    expect(screen.queryByRole("dialog", { name: "Reading options" })).not.toBeInTheDocument();
  });

  it("draws its 16 px top radii, grab handle, and sheet motion from tokens", () => {
    const rule = sheetCss.match(/\.kit-sheet\s*\{[^}]*\}/);
    expect(rule?.[0]).toMatch(/border-radius:\s*var\(--radius-sheet\)/);
    expect(rule?.[0]).toMatch(/var\(--motion-sheet\)/);
    expect(sheetCss).toMatch(/\.kit-sheet__grab\s*\{[^}]*\}/);
  });
});

describe("Dialog", () => {
  it("renders only in Wide", async () => {
    setWidth(1024);
    await mount(<DialogCase startOpen />);
    expect(screen.getByRole("dialog", { name: "Import report" })).toBeInTheDocument();

    setWidth(500);
    await act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.queryByRole("dialog", { name: "Import report" })).not.toBeInTheDocument();
  });

  it("caps its width at 640 px in the stylesheet", () => {
    expect(sheetCss).toMatch(/\.kit-dialog\s*\{[^}]*max-width:\s*640px/);
  });

  it("focuses the first control and traps Tab and Shift+Tab", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<DialogCase startOpen />);

    const body = screen.getByRole("button", { name: "Body action" });
    const save = screen.getByRole("button", { name: "Save" });
    expect(document.activeElement).toBe(body);

    await press(() => user.tab());
    expect(document.activeElement).toBe(save);

    await press(() => user.tab());
    expect(document.activeElement).toBe(body);

    await press(() => user.tab({ shift: true }));
    expect(document.activeElement).toBe(save);
  });

  it("closes on Escape, on the scrim, and returns focus to its trigger", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<DialogCase />);

    const trigger = screen.getByRole("button", { name: "Open dialog" });
    await press(() => user.click(trigger));
    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("dialog", { name: "Import report" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);

    await press(() => user.click(trigger));
    const scrim = document.querySelector(".kit-scrim");
    if (!(scrim instanceof HTMLElement)) throw new Error("Dialog has no scrim");
    await press(() => user.click(scrim));
    expect(screen.queryByRole("dialog", { name: "Import report" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});

function PopoverCase({ triggerRef }: { triggerRef: RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Open popover
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        label="More actions"
      >
        <button type="button">First</button>
        <button type="button">Second</button>
      </Popover>
    </div>
  );
}

function mockPopoverWidth(width: number) {
  const native = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("kit-popover")) return rect(0, 0, width, 100);
    return native.call(this);
  });
}

describe("Popover", () => {
  it("renders only in Wide", async () => {
    setWidth(500);
    const triggerRef = createRef<HTMLButtonElement>();
    const user = userEvent.setup({ delay: null });
    await mount(<PopoverCase triggerRef={triggerRef} />);
    await press(() => user.click(screen.getByRole("button", { name: "Open popover" })));
    expect(document.querySelector(".kit-popover")).toBeNull();
  });

  it("sits 8 px below its trigger, aligned to its left edge", async () => {
    setWidth(1024);
    mockPopoverWidth(200);
    const triggerRef = createRef<HTMLButtonElement>();
    const user = userEvent.setup({ delay: null });
    await mount(<PopoverCase triggerRef={triggerRef} />);

    const trigger = screen.getByRole("button", { name: "Open popover" });
    Object.defineProperty(trigger, "getBoundingClientRect", {
      configurable: true,
      value: () => rect(100, 20, 120, 30),
    });

    await press(() => user.click(trigger));
    const popover = document.querySelector<HTMLElement>(".kit-popover");
    expect(popover?.style.left).toBe("100px");
    expect(popover?.style.top).toBe("58px");
  });

  it("clamps inside the Frame viewport and follows resize and scroll", async () => {
    setWidth(1024);
    mockPopoverWidth(200);
    const triggerRef = createRef<HTMLButtonElement>();
    const user = userEvent.setup({ delay: null });
    await mount(<PopoverCase triggerRef={triggerRef} />);

    const trigger = screen.getByRole("button", { name: "Open popover" });
    let left = 900;
    let top = 20;
    Object.defineProperty(trigger, "getBoundingClientRect", {
      configurable: true,
      value: () => rect(left, top, 120, 30),
    });

    await press(() => user.click(trigger));
    expect(document.querySelector<HTMLElement>(".kit-popover")?.style.left).toBe("816px");
    expect(document.querySelector<HTMLElement>(".kit-popover")?.style.top).toBe("58px");

    // The trigger near the bottom edge pulls the popover up by its measured
    // height, still keeping the 8 px margin.
    top = window.innerHeight;
    await act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    const bottomEdge = Math.max(8, window.innerHeight - 100 - 8);
    expect(document.querySelector<HTMLElement>(".kit-popover")?.style.top).toBe(`${bottomEdge}px`);

    left = 300;
    top = 20;
    await act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(document.querySelector<HTMLElement>(".kit-popover")?.style.left).toBe("300px");
    expect(document.querySelector<HTMLElement>(".kit-popover")?.style.top).toBe("58px");

    left = 40;
    await act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(document.querySelector<HTMLElement>(".kit-popover")?.style.left).toBe("40px");
  });

  it("closes on Escape and returns focus to its trigger", async () => {
    setWidth(1024);
    const triggerRef = createRef<HTMLButtonElement>();
    const user = userEvent.setup({ delay: null });
    await mount(<PopoverCase triggerRef={triggerRef} />);

    const trigger = screen.getByRole("button", { name: "Open popover" });
    await press(() => user.click(trigger));
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();

    await press(() => user.keyboard("{Escape}"));
    expect(document.querySelector(".kit-popover")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("draws its 12 px radius in the stylesheet", () => {
    expect(sheetCss).toMatch(/\.kit-popover\s*\{[^}]*border-radius:\s*var\(--radius-card\)/);
  });
});

const MENU_ITEMS: MenuItem[] = [
  { id: "new", label: "New note", icon: "note" },
  { id: "delete", label: "Delete", icon: "trash", disabled: true },
  { id: "settings", label: "Settings", shortcut: "Ctrl+," },
];

function MenuCase({
  onSelect = () => {},
  items = MENU_ITEMS,
  startOpen = false,
}: {
  onSelect?: (id: string) => void;
  items?: MenuItem[];
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open menu
      </button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        label="Actions"
        items={items}
        onSelect={onSelect}
      />
    </div>
  );
}

/**
 * A Menu that is always open and hands `items` a new array and new rows on
 * every render, so a caller-supplied fresh array cannot re-run open focus.
 */
function FreshItemsMenuCase() {
  const [tick, setTick] = useState(0);
  return (
    <div>
      <button
        type="button"
        class="rerender-menu"
        data-tick={tick}
        onClick={() => setTick((value) => value + 1)}
      >
        Rerender
      </button>
      <Menu
        open
        onClose={() => {}}
        label="Actions"
        items={MENU_ITEMS.map((item) => ({ ...item }))}
        onSelect={() => {}}
      />
    </div>
  );
}

describe("Menu", () => {
  it("focuses its first enabled row and sizes rows 40 px by default", async () => {
    setWidth(1024);
    await mount(<MenuCase startOpen />);

    const first = screen.getByRole("menuitem", { name: "New note" });
    expect(document.activeElement).toBe(first);
    expect(first.style.height).toBe("40px");
  });

  it("draws 44 px rows when the layout asks for the larger target", async () => {
    setWidth(500);
    await mount(<MenuCase startOpen />);
    expect(screen.getByRole("menuitem", { name: "New note" }).style.height).toBe("44px");
  });

  it("keeps one tab stop and skips a disabled row with the arrow keys", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<MenuCase startOpen />);

    const items = screen.getAllByRole("menuitem");
    expect(items.filter((item) => item.getAttribute("tabindex") === "0")).toHaveLength(1);

    await press(() => user.keyboard("{ArrowDown}"));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Settings/ }));

    await press(() => user.keyboard("{ArrowUp}"));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "New note" }));
  });

  it("moves to the ends with Home and End", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<MenuCase startOpen />);

    await press(() => user.keyboard("{End}"));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Settings/ }));

    await press(() => user.keyboard("{Home}"));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "New note" }));
  });

  it("type-ahead jumps to a matching label and ignores a disabled one", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<MenuCase startOpen />);

    await press(() => user.keyboard("d"));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "New note" }));
  });

  it("type-ahead finds the next enabled label", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<MenuCase startOpen />);

    await press(() => user.keyboard("s"));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Settings/ }));
  });

  it("selects the active row with Enter and with Space, then closes", async () => {
    setWidth(1024);
    const seen: string[] = [];
    const user = userEvent.setup({ delay: null });
    await mount(<MenuCase startOpen onSelect={(id) => seen.push(id)} />);

    await press(() => user.keyboard("{Enter}"));
    expect(seen).toEqual(["new"]);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await press(() => user.click(screen.getByRole("button", { name: "Open menu" })));
    await press(() => user.keyboard("{ArrowDown}"));
    await press(() => user.keyboard(" "));
    expect(seen).toEqual(["new", "settings"]);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to its trigger", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<MenuCase />);

    const trigger = screen.getByRole("button", { name: "Open menu" });
    await press(() => user.click(trigger));
    expect(screen.getByRole("menuitem", { name: "New note" })).toHaveFocus();

    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("never selects a disabled row with a click", async () => {
    setWidth(1024);
    const seen: string[] = [];
    const user = userEvent.setup({ delay: null });
    await mount(<MenuCase startOpen onSelect={(id) => seen.push(id)} />);

    await press(() => user.click(screen.getByRole("menuitem", { name: "Delete" })));
    expect(seen).toEqual([]);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("keeps the focused row when it rerenders open with a fresh items array", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<FreshItemsMenuCase />);

    const settings = screen.getByRole("menuitem", { name: /Settings/ });
    await press(() => user.keyboard("{ArrowDown}"));
    expect(document.activeElement).toBe(settings);

    const rerender = document.querySelector<HTMLButtonElement>(".rerender-menu");
    if (!rerender) throw new Error("case has no rerender control");
    await act(() => {
      rerender.click();
    });
    expect(rerender.dataset.tick).toBe("1");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Settings/ }));
  });
});

function NestedCase() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setDialogOpen(true)}>
        Open dialog
      </button>
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Settings"
        actions={<button type="button">Close</button>}
      >
        <button type="button" onClick={() => setMenuOpen(true)}>
          Open menu
        </button>
        <Menu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          label="Actions"
          items={[{ id: "alpha", label: "Alpha" }]}
          onSelect={() => {}}
        />
      </Dialog>
    </div>
  );
}

describe("layer stack", () => {
  it("marks a Menu opened over a Dialog as nested", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<NestedCase />);

    await press(() => user.click(screen.getByRole("button", { name: "Open dialog" })));
    await press(() => user.click(screen.getByRole("button", { name: "Open menu" })));
    expect(screen.getByRole("menu")).toHaveClass("kit-menu--nested");
  });

  it("leaves a standalone Menu on the default popover layer", async () => {
    setWidth(1024);
    await mount(<MenuCase startOpen />);
    expect(screen.getByRole("menu")).not.toHaveClass("kit-menu--nested");
  });

  it("closes the Menu before the Dialog and returns focus inside the Dialog", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<NestedCase />);

    const dialogTrigger = screen.getByRole("button", { name: "Open dialog" });
    await press(() => user.click(dialogTrigger));
    const menuTrigger = screen.getByRole("button", { name: "Open menu" });

    await press(() => user.click(menuTrigger));
    expect(screen.getByRole("menuitem", { name: "Alpha" })).toHaveFocus();

    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(document.activeElement).toBe(menuTrigger);

    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(dialogTrigger);
  });
});
