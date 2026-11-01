import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Button,
  GridList,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  GridListItem,
  Toolbar,
  Tree,
  TreeItem,
  TreeItemContent,
} from "react-aria-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installArrowNavigation, keepTabInRowForm } from "@/lib/arrow-navigation";
import { pressKey } from "@/lib/focus-commands";

// jsdom has no layout: each element reads its rect from `data-rect`
// ("left top right bottom"); everything else is a zero-size box.
let rectReads = 0;
const realRect = Element.prototype.getBoundingClientRect;
function stubRects() {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    // Only the module's own reads count; React Aria measures on focus too.
    if (new Error().stack?.includes("/src/lib/arrow-navigation/")) rectReads += 1;
    const [left, top, right, bottom] = (this.getAttribute("data-rect") ?? "0 0 0 0")
      .split(" ")
      .map(Number);
    return {
      left,
      top,
      right,
      bottom,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

function NotesFixture({ rename = false }: { rename?: boolean }) {
  return (
    <main>
      <section data-focus-pane="sidebar" tabIndex={-1} aria-label="Sidebar" data-rect="0 0 300 800">
        <GridList aria-label="Notes" data-focus-pane-entry="" data-rect="0 50 300 200">
          <GridListItem id="a" textValue="Note A" data-rect="0 50 300 80">
            {rename ? <input aria-label="Rename A" data-rect="0 50 150 80" /> : "Note A"}
            <Button aria-label="Pin A" data-rect="200 50 240 80" />
            <Button aria-label="Delete A" data-rect="250 50 290 80" />
          </GridListItem>
          <GridListItem id="b" textValue="Note B" data-rect="0 80 300 110">
            Note B
          </GridListItem>
        </GridList>
        {/* biome-ignore lint/a11y/useSemanticElements: a focusable resize handle, as ResizeHandle renders it. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize"
          aria-valuenow={300}
          tabIndex={0}
          data-rect="298 0 302 800"
        />
      </section>
      <section
        data-focus-pane="title"
        tabIndex={-1}
        aria-label="Title bar"
        data-rect="300 0 1000 40"
      >
        <button type="button" data-rect="310 5 340 35">
          Back
        </button>
        <input aria-label="Title" data-rect="350 5 900 35" />
      </section>
      <section
        data-focus-pane="editor"
        tabIndex={-1}
        aria-label="Editor"
        data-rect="300 40 1000 800"
      >
        <Toolbar aria-label="Format" data-rect="300 40 1000 80">
          <Button data-rect="300 40 340 80">Bold</Button>
          <Button data-rect="340 40 380 80">Italic</Button>
        </Toolbar>
        <div contentEditable data-testid="text" data-rect="300 80 1000 800" />
      </section>
    </main>
  );
}

function GalleryFixture() {
  const card = (n: number, rect: string, buttonRect: string) => (
    <GridListItem id={`c${n}`} textValue={`Card ${n}`} data-rect={rect}>
      Card {n}
      <Button aria-label={`Menu ${n}`} data-rect={buttonRect} />
    </GridListItem>
  );
  return (
    <main>
      <section data-focus-pane="gallery" tabIndex={-1} aria-label="Gallery" data-rect="0 0 220 220">
        <GridList aria-label="Books" layout="grid" data-rect="0 0 220 220">
          {card(1, "0 0 100 100", "80 0 100 20")}
          {card(2, "110 0 210 100", "190 0 210 20")}
          {card(3, "0 110 100 210", "80 110 100 130")}
        </GridList>
      </section>
      <aside data-focus-pane="side" tabIndex={-1} aria-label="Side" data-rect="300 0 500 400">
        <button type="button" data-rect="310 10 400 40">
          Side action
        </button>
      </aside>
    </main>
  );
}

// The Chapter outline: a vertical toolbar of headings inside its Chapter's row.
function OutlineFixture() {
  return (
    <main>
      <section
        data-focus-pane="chapters"
        tabIndex={-1}
        aria-label="Chapters"
        data-rect="0 0 300 800"
      >
        <GridList aria-label="Chapter list" data-rect="0 0 300 300">
          <GridListItem id="c1" textValue="Chapter 1" data-rect="0 0 300 120">
            Chapter 1
            <Toolbar aria-label="Outline" orientation="vertical" data-rect="0 30 300 90">
              <button type="button" data-rect="0 30 300 60">
                Heading A
              </button>
              <button type="button" data-rect="0 60 300 90">
                Heading B
              </button>
            </Toolbar>
          </GridListItem>
          <GridListItem id="c2" textValue="Chapter 2" data-rect="0 120 300 150">
            Chapter 2
          </GridListItem>
        </GridList>
      </section>
      <section
        data-focus-pane="editor"
        tabIndex={-1}
        aria-label="Editor"
        data-rect="300 0 1000 800"
      >
        <button type="button" data-rect="310 10 400 40">
          Editor action
        </button>
      </section>
    </main>
  );
}

const row = (name: string) => screen.getByRole("row", { name });
const button = (name: string) => screen.getByRole("button", { name });

let uninstall: () => void;
beforeEach(() => {
  stubRects();
  rectReads = 0;
  uninstall = installArrowNavigation();
});
afterEach(() => {
  uninstall();
  Element.prototype.getBoundingClientRect = realRect;
});

describe("arrow navigation (ADR 0025)", () => {
  it("walks a row's buttons with React Aria, then leaves the list to the Pane on the right", async () => {
    const user = userEvent.setup();
    render(<NotesFixture />);
    act(() => row("Note A").focus());

    await user.keyboard("{ArrowRight}");
    expect(button("Pin A")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(button("Delete A")).toHaveFocus();
    // Past the last button React Aria would wrap back to the row.
    await user.keyboard("{ArrowRight}");
    expect(button("Bold")).toHaveFocus();
  });

  it("keeps focus on the row when Left has nowhere to go, instead of wrapping", async () => {
    const user = userEvent.setup();
    render(<NotesFixture />);
    act(() => row("Note A").focus());

    await user.keyboard("{ArrowLeft}");
    expect(row("Note A")).toHaveFocus();
  });

  it("never leaves a list with Up or Down", async () => {
    const user = userEvent.setup();
    render(<NotesFixture />);
    act(() => row("Note A").focus());

    await user.keyboard("{ArrowDown}");
    expect(row("Note B")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(row("Note B")).toHaveFocus();
  });

  it("moves inside a toolbar with no layout reads, and leaves it Up into the Pane above", async () => {
    const user = userEvent.setup();
    render(<NotesFixture />);
    act(() => button("Bold").focus());
    rectReads = 0;

    await user.keyboard("{ArrowRight}");
    expect(button("Italic")).toHaveFocus();
    expect(rectReads).toBe(0);

    // Up crosses into the title bar and lands on its first control that is not text entry.
    await user.keyboard("{ArrowUp}");
    expect(button("Back")).toHaveFocus();
  });

  it("does nothing at an edge with no stop and no Pane beyond", async () => {
    const user = userEvent.setup();
    render(<NotesFixture />);
    act(() => button("Bold").focus());

    await user.keyboard("{ArrowDown}");
    expect(button("Bold")).toHaveFocus();
  });

  it("returns to the control last used when an arrow re-enters a Pane", async () => {
    const user = userEvent.setup();
    render(<NotesFixture />);
    act(() => button("Italic").focus());
    await user.keyboard("{ArrowUp}");
    expect(button("Back")).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(button("Italic")).toHaveFocus();
  });

  it("leaves a text field inside a row its Left and Right keys", async () => {
    const user = userEvent.setup();
    render(<NotesFixture rename />);
    const field = screen.getByRole("textbox", { name: "Rename A" });
    act(() => field.focus());

    await user.keyboard("{ArrowRight}{ArrowLeft}");
    expect(field).toHaveFocus();
  });

  it("leaves arrow owners alone: text, the editor, and a resize handle", async () => {
    const user = userEvent.setup();
    render(<NotesFixture />);
    const separator = screen.getByRole("separator");
    act(() => separator.focus());
    await user.keyboard("{ArrowRight}{ArrowLeft}");
    expect(separator).toHaveFocus();

    const text = screen.getByTestId("text");
    act(() => text.focus());
    await user.keyboard("{ArrowUp}");
    expect(text).toHaveFocus();
  });

  it("leaves a Select trigger and anything in an open popover their arrows", async () => {
    const user = userEvent.setup();
    render(
      <main>
        <section data-focus-pane="bar" tabIndex={-1} aria-label="Bar" data-rect="0 0 400 40">
          <button type="button" data-rect="10 5 40 35">
            Plain
          </button>
          <button type="button" aria-haspopup="listbox" data-rect="50 5 80 35">
            Font
          </button>
          <div data-trigger="Select" data-rect="50 40 200 200">
            <button type="button" data-rect="60 50 190 70">
              Option
            </button>
          </div>
          <button type="button" data-rect="300 5 330 35">
            Target
          </button>
        </section>
      </main>
    );
    // From an ordinary button the arrow moves on, past the trigger: an owner
    // is never a target either.
    act(() => button("Plain").focus());
    await user.keyboard("{ArrowRight}");
    expect(button("Target")).toHaveFocus();

    act(() => button("Font").focus());
    await user.keyboard("{ArrowRight}");
    expect(button("Font")).toHaveFocus();

    act(() => button("Option").focus());
    await user.keyboard("{ArrowRight}");
    expect(button("Option")).toHaveFocus();
  });

  it("leaves an open React Aria Select's options their arrows", async () => {
    const user = userEvent.setup();
    render(
      <main>
        <section data-focus-pane="bar" tabIndex={-1} aria-label="Bar" data-rect="0 0 400 300">
          <Select aria-label="Font">
            <Button data-rect="10 5 80 35">
              <SelectValue />
            </Button>
            <Popover>
              <ListBox>
                <ListBoxItem id="serif">Serif</ListBoxItem>
                <ListBoxItem id="sans">Sans</ListBoxItem>
              </ListBox>
            </Popover>
          </Select>
          <button type="button" data-rect="300 5 330 35">
            Target
          </button>
        </section>
      </main>
    );
    act(() => screen.getByRole("button", { name: /Font/ }).focus());
    await user.keyboard("{ArrowDown}");
    const option = await screen.findByRole("option", { name: "Serif" });
    expect(option).toHaveFocus();

    // Two rules hold this: the option is inside the popover (an arrow owner),
    // and the popover is the topmost layer, which no arrow leaves.
    await user.keyboard("{ArrowRight}");
    expect(option).toHaveFocus();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("leaves a surface marked data-owns-arrows its arrows, focused or inside", async () => {
    const user = userEvent.setup();
    render(
      <>
        <NotesFixture />
        <div data-owns-arrows="" tabIndex={-1} data-testid="stage" data-rect="300 80 1000 800">
          <button type="button" data-rect="400 100 440 140">
            Node
          </button>
        </div>
      </>
    );
    const onKey = vi.fn();
    window.addEventListener("keydown", onKey);
    act(() => screen.getByTestId("stage").focus());
    await user.keyboard("{ArrowUp}");
    expect(screen.getByTestId("stage")).toHaveFocus();
    act(() => button("Node").focus());
    await user.keyboard("{ArrowLeft}");
    expect(button("Node")).toHaveFocus();
    // The keys still reach the page's own handlers (the Cover Designer nudge).
    expect(onKey).toHaveBeenCalledTimes(2);
    window.removeEventListener("keydown", onKey);
  });

  describe("a 2D card grid", () => {
    it("moves Right between cards by position, then leaves at the side edge instead of wrapping", async () => {
      const user = userEvent.setup();
      render(<GalleryFixture />);
      act(() => row("Card 1").focus());

      await user.keyboard("{ArrowRight}");
      expect(row("Card 2")).toHaveFocus();
      await user.keyboard("{ArrowRight}");
      expect(button("Side action")).toHaveFocus();
    });

    it("reads only the two cards involved when Right moves between cards of a large gallery", async () => {
      const user = userEvent.setup();
      // 60 cards, five to a visual row of 110 px columns.
      const cards = Array.from({ length: 60 }, (_, i) => {
        const left = (i % 5) * 110;
        const top = Math.floor(i / 5) * 110;
        return { n: i + 1, rect: `${left} ${top} ${left + 100} ${top + 100}` };
      });
      render(
        <main>
          <section
            data-focus-pane="gallery"
            tabIndex={-1}
            aria-label="Gallery"
            data-rect="0 0 560 1400"
          >
            <GridList aria-label="Books" layout="grid" data-rect="0 0 560 1400">
              {cards.map(({ n, rect }) => (
                <GridListItem key={n} id={`c${n}`} textValue={`Card ${n}`} data-rect={rect}>
                  Card {n}
                </GridListItem>
              ))}
            </GridList>
          </section>
        </main>
      );
      act(() => row("Card 7").focus());
      rectReads = 0;

      await user.keyboard("{ArrowRight}");
      expect(row("Card 8")).toHaveFocus();
      expect(rectReads).toBeLessThanOrEqual(2);
    });

    it("moves Left between cards and stays at the left edge with nothing beyond", async () => {
      const user = userEvent.setup();
      render(<GalleryFixture />);
      act(() => row("Card 2").focus());

      await user.keyboard("{ArrowLeft}");
      expect(row("Card 1")).toHaveFocus();
      await user.keyboard("{ArrowLeft}");
      expect(row("Card 1")).toHaveFocus();
    });

    it("from the last card of a visual row, Right leaves rather than wrapping to the next row", async () => {
      const user = userEvent.setup();
      render(<GalleryFixture />);
      act(() => row("Card 3").focus());

      await user.keyboard("{ArrowRight}");
      expect(button("Side action")).toHaveFocus();
    });

    it("moves Up and Down by position and never leaves the grid that way", async () => {
      const user = userEvent.setup();
      render(<GalleryFixture />);
      act(() => row("Card 1").focus());

      await user.keyboard("{ArrowDown}");
      expect(row("Card 3")).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(row("Card 3")).toHaveFocus();
      await user.keyboard("{ArrowUp}");
      expect(row("Card 1")).toHaveFocus();
    });
  });

  describe("a vertical widget inside a list row (the Chapter outline)", () => {
    it("moves Down and Up between its items with no layout reads", async () => {
      const user = userEvent.setup();
      render(<OutlineFixture />);
      act(() => button("Heading A").focus());
      rectReads = 0;

      // React Aria's row would send Down to Chapter 2; the outline keeps it.
      await user.keyboard("{ArrowDown}");
      expect(button("Heading B")).toHaveFocus();
      await user.keyboard("{ArrowUp}");
      expect(button("Heading A")).toHaveFocus();
      expect(rectReads).toBe(0);
    });

    it("returns Up from its first item to its own row", async () => {
      const user = userEvent.setup();
      render(<OutlineFixture />);
      act(() => button("Heading A").focus());

      await user.keyboard("{ArrowUp}");
      expect(row("Chapter 1")).toHaveFocus();
    });

    it("moves Down from its last item on to the next row", async () => {
      const user = userEvent.setup();
      render(<OutlineFixture />);
      act(() => button("Heading B").focus());

      await user.keyboard("{ArrowDown}");
      expect(row("Chapter 2")).toHaveFocus();
    });

    it("leaves Right to the Pane beside it", async () => {
      const user = userEvent.setup();
      render(<OutlineFixture />);
      act(() => button("Heading A").focus());

      await user.keyboard("{ArrowRight}");
      expect(button("Editor action")).toHaveFocus();
    });
  });

  // React Aria sends a Tab pressed anywhere in a list out of the list (it
  // focuses the list's last tabbable, then lets the browser move on). jsdom's
  // user-event picks the next element itself, so the browser half is proven by
  // the chapters-rename-type and chapters-delete E2E rows; this pins which Tab
  // presses the form keeps from the list.
  describe("keepTabInRowForm: a small form inside a list row", () => {
    function RowForm({ onListKey }: { onListKey: () => void }) {
      return (
        <div onKeyDown={(event) => event.key === "Tab" && onListKey()}>
          <div onKeyDown={keepTabInRowForm}>
            <button type="button">Chapter Type</button>
            <button type="button">Save</button>
            <button type="button">Cancel</button>
          </div>
        </div>
      );
    }

    it("keeps Tab and Shift+Tab between its own controls from the list", async () => {
      const user = userEvent.setup();
      const onListKey = vi.fn();
      render(<RowForm onListKey={onListKey} />);
      act(() => button("Chapter Type").focus());

      await user.tab();
      await user.tab();
      await user.tab({ shift: true });
      await user.tab({ shift: true });
      expect(button("Chapter Type")).toHaveFocus();
      expect(onListKey).not.toHaveBeenCalled();
    });

    it("lets the list take Tab past its last control and Shift+Tab before its first", async () => {
      const user = userEvent.setup();
      const onListKey = vi.fn();
      render(<RowForm onListKey={onListKey} />);

      act(() => button("Cancel").focus());
      await user.tab();
      expect(onListKey).toHaveBeenCalledTimes(1);

      act(() => button("Chapter Type").focus());
      await user.tab({ shift: true });
      expect(onListKey).toHaveBeenCalledTimes(2);
    });
  });

  // The Settings outline keeps the section on screen open: Left cannot
  // collapse it, so Left leaves from it as from a collapsed section.
  describe("a tree whose open section cannot collapse", () => {
    function OutlineTree({ keepsOpen }: { keepsOpen: boolean }) {
      return (
        <main>
          <section data-focus-pane="main" tabIndex={-1} aria-label="Main" data-rect="0 0 1000 800">
            <button type="button" data-rect="10 10 200 40">
              Light
            </button>
            <Tree
              aria-label="Settings sections"
              expandedKeys={new Set(["appearance"])}
              data-rect="700 0 1000 300"
            >
              <TreeItem
                id="appearance"
                textValue="Appearance"
                data-keeps-open={keepsOpen ? "" : undefined}
                data-rect="700 0 1000 30"
              >
                <TreeItemContent>Appearance</TreeItemContent>
                <TreeItem id="theme" textValue="Theme" data-rect="700 30 1000 60">
                  <TreeItemContent>Theme</TreeItemContent>
                </TreeItem>
              </TreeItem>
            </Tree>
          </section>
        </main>
      );
    }

    it("leaves Left from the open top-level section it marks as kept open", async () => {
      const user = userEvent.setup();
      render(<OutlineTree keepsOpen />);
      act(() => row("Appearance").focus());

      await user.keyboard("{ArrowLeft}");
      expect(button("Light")).toHaveFocus();
    });

    it("leaves an ordinary open section's Left to the tree, which collapses it", async () => {
      const user = userEvent.setup();
      render(<OutlineTree keepsOpen={false} />);
      act(() => row("Appearance").focus());

      await user.keyboard("{ArrowLeft}");
      expect(row("Appearance")).toHaveFocus();
    });
  });

  it("times each arrow that moves focus for the frame-rate lane, only when it asks", async () => {
    const user = userEvent.setup();
    render(<NotesFixture />);
    act(() => button("Bold").focus());
    const samples: number[] = [];
    window.__maibukArrowLeaveMs = samples;
    try {
      // Inside the toolbar: React Aria moves focus, nothing is timed.
      await user.keyboard("{ArrowRight}");
      expect(samples).toHaveLength(0);
      // Up leaves the toolbar for the title bar: one sample.
      await user.keyboard("{ArrowUp}");
      expect(button("Back")).toHaveFocus();
      expect(samples).toHaveLength(1);
      expect(samples[0]).toBeGreaterThanOrEqual(0);
    } finally {
      delete window.__maibukArrowLeaveMs;
    }
  });

  it("stops the sample when the target is decided, before the focus change runs", () => {
    render(<NotesFixture />);
    act(() => button("Bold").focus());
    const samples: number[] = [];
    window.__maibukArrowLeaveMs = samples;

    let now = 1000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    const burnFocusTime = (event: FocusEvent) => {
      if (event.target === button("Back")) now += 20;
    };
    document.addEventListener("focusin", burnFocusTime, true);
    try {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        window.dispatchEvent(event);
      });

      expect(event.defaultPrevented).toBe(true);
      expect(button("Back")).toHaveFocus();
      // The focus listener burned 20 ms; the sample must not include it.
      expect(now).toBe(1020);
      expect(samples).toHaveLength(1);
      expect(samples[0]).toBeLessThan(20);
    } finally {
      document.removeEventListener("focusin", burnFocusTime, true);
      nowSpy.mockRestore();
      delete window.__maibukArrowLeaveMs;
    }
  });

  it("stops the sample at a remembered control before its focus change runs", () => {
    render(<NotesFixture />);
    // Use Italic in the editor, then leave for the title bar so the next arrow
    // re-enters the editor through landInPane's remembered-control path.
    act(() => button("Italic").focus());
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })
      );
    });
    expect(button("Back")).toHaveFocus();

    const samples: number[] = [];
    window.__maibukArrowLeaveMs = samples;
    let now = 1000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    const burnFocusTime = (event: FocusEvent) => {
      if (event.target === button("Italic")) now += 20;
    };
    document.addEventListener("focusin", burnFocusTime, true);
    try {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        window.dispatchEvent(event);
      });

      expect(event.defaultPrevented).toBe(true);
      expect(button("Italic")).toHaveFocus();
      // The remembered control's focus listener burned 20 ms; the sample
      // stopped at the probe before it.
      expect(now).toBe(1020);
      expect(samples).toHaveLength(1);
      expect(samples[0]).toBeLessThan(20);
    } finally {
      document.removeEventListener("focusin", burnFocusTime, true);
      nowSpy.mockRestore();
      delete window.__maibukArrowLeaveMs;
    }
  });

  it("stops the sample before an in-widget move's focus change runs", () => {
    render(<GalleryFixture />);
    act(() => row("Card 1").focus());

    const samples: number[] = [];
    window.__maibukArrowLeaveMs = samples;
    let now = 1000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    const burnFocusTime = (event: FocusEvent) => {
      if (event.target === row("Card 2")) now += 20;
    };
    document.addEventListener("focusin", burnFocusTime, true);
    try {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        window.dispatchEvent(event);
      });

      expect(event.defaultPrevented).toBe(true);
      expect(row("Card 2")).toHaveFocus();
      // The grid moves focus itself (arrowOutcome's "move"), and the sample
      // stops before that focus call, not after its listener.
      expect(now).toBe(1020);
      expect(samples).toHaveLength(1);
      expect(samples[0]).toBeLessThan(20);
    } finally {
      document.removeEventListener("focusin", burnFocusTime, true);
      nowSpy.mockRestore();
      delete window.__maibukArrowLeaveMs;
    }
  });

  it("falls back from a removed remembered control, stopping the sample at the first probe", () => {
    render(<NotesFixture />);
    act(() => button("Italic").focus());
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })
      );
    });
    expect(button("Back")).toHaveFocus();
    // The editor's remembered control is gone: tryFocus cannot use it, so
    // landInPane falls back to the toolbar's first item.
    act(() => button("Italic").remove());

    const samples: number[] = [];
    window.__maibukArrowLeaveMs = samples;
    let now = 1000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    const burnFocusTime = (event: FocusEvent) => {
      if (event.target === button("Bold")) now += 20;
    };
    document.addEventListener("focusin", burnFocusTime, true);
    try {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        window.dispatchEvent(event);
      });

      expect(event.defaultPrevented).toBe(true);
      expect(button("Bold")).toHaveFocus();
      // The fallback is still timed, and stops before its focus change.
      expect(now).toBe(1020);
      expect(samples).toHaveLength(1);
      expect(samples[0]).toBeLessThan(20);
    } finally {
      document.removeEventListener("focusin", burnFocusTime, true);
      nowSpy.mockRestore();
      delete window.__maibukArrowLeaveMs;
    }
  });

  it("records no sample for arrows it does not act on, or when the lane has not asked", () => {
    render(<NotesFixture />);
    act(() => button("Bold").focus());
    const samples: number[] = [];
    window.__maibukArrowLeaveMs = samples;
    try {
      // Down from the last-row toolbar has nowhere to go: not handled.
      const down = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        window.dispatchEvent(down);
      });
      expect(down.defaultPrevented).toBe(false);
      expect(button("Bold")).toHaveFocus();
      expect(samples).toHaveLength(0);

      // With no array set, an arrow that does move focus records nothing.
      delete window.__maibukArrowLeaveMs;
      const up = new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        window.dispatchEvent(up);
      });
      expect(button("Back")).toHaveFocus();
      expect(samples).toHaveLength(0);
    } finally {
      delete window.__maibukArrowLeaveMs;
    }
  });

  it("does no layout reads for keys it does not handle", async () => {
    const user = userEvent.setup();
    render(<NotesFixture />);
    act(() => row("Note A").focus());
    rectReads = 0;

    await user.keyboard("x{Shift>}{ArrowRight}{/Shift}{Control>}{ArrowLeft}{/Control}{Tab}");
    expect(rectReads).toBe(0);
  });

  it("checks a long list's visibility once, not once per row button, when an arrow leaves it", async () => {
    const user = userEvent.setup();
    const ids = Array.from({ length: 200 }, (_, i) => `n${i}`);
    render(
      <main>
        <section data-focus-pane="list" tabIndex={-1} aria-label="List" data-rect="0 0 300 800">
          <GridList aria-label="Notes" data-rect="0 0 300 800">
            {ids.map((id, i) => (
              <GridListItem key={id} id={id} textValue={id} data-rect={`0 ${i} 300 ${i + 1}`}>
                {id}
                <Button aria-label={`Edit ${id}`} />
                <Button aria-label={`Delete ${id}`} />
              </GridListItem>
            ))}
          </GridList>
        </section>
        <section
          data-focus-pane="editor"
          tabIndex={-1}
          aria-label="Editor"
          data-rect="300 0 1000 800"
        >
          <button type="button" data-rect="310 5 340 35">
            Bold
          </button>
        </section>
      </main>
    );
    act(() => button("Delete n0").focus());
    // The visibility check reads computed styles (jsdom has no checkVisibility).
    let styleReads = 0;
    const realStyle = window.getComputedStyle;
    window.getComputedStyle = (...args) => {
      if (new Error().stack?.includes("/src/lib/arrow-navigation/")) styleReads += 1;
      return realStyle(...args);
    };
    try {
      await user.keyboard("{ArrowRight}");
    } finally {
      window.getComputedStyle = realStyle;
    }
    expect(button("Bold")).toHaveFocus();
    // Each check walks up a few ancestors; 400 row buttons would cost thousands.
    expect(styleReads).toBeLessThan(100);
  });

  it("counts an empty list, which is itself the Tab stop, as an arrow stop", async () => {
    const user = userEvent.setup();
    render(
      <main>
        <section
          data-focus-pane="editor"
          tabIndex={-1}
          aria-label="Editor"
          data-rect="0 0 1000 800"
        >
          <button type="button" data-rect="10 5 40 35">
            Bold
          </button>
          <GridList
            aria-label="Notes"
            data-rect="10 100 600 300"
            renderEmptyState={() => "No notes"}
          >
            {[]}
          </GridList>
        </section>
      </main>
    );
    act(() => button("Bold").focus());

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("grid", { name: "Notes" })).toHaveFocus();
  });

  it("from nothing focused, Down lands on the main area's entry and Up on its last stop", async () => {
    const user = userEvent.setup();
    render(<NotesFixture />);
    act(() => (document.activeElement as HTMLElement | null)?.blur());

    await user.keyboard("{ArrowDown}");
    expect(row("Note A")).toHaveFocus();

    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard("{ArrowUp}");
    expect(button("Bold")).toHaveFocus();
  });

  it("from a Pane container itself, Down lands on that Pane's first stop", async () => {
    const user = userEvent.setup();
    render(<NotesFixture />);
    act(() => document.querySelector<HTMLElement>('[data-focus-pane="title"]')!.focus());

    await user.keyboard("{ArrowDown}");
    expect(button("Back")).toHaveFocus();
  });

  it("stays inside an open dialog and never crosses Panes from it", async () => {
    const user = userEvent.setup();
    render(
      <>
        <NotesFixture />
        <div role="dialog" aria-modal="true" aria-label="Dialog" data-rect="400 300 700 500">
          <button type="button" data-rect="420 450 500 480">
            Cancel
          </button>
          <button type="button" data-rect="520 450 600 480">
            Save
          </button>
        </div>
      </>
    );
    act(() => button("Cancel").focus());

    await user.keyboard("{ArrowRight}");
    expect(button("Save")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(button("Save")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(button("Save")).toHaveFocus();
  });

  it("runs the same way for a voice key press", () => {
    render(<NotesFixture />);
    act(() => button("Delete A").focus());

    act(() => pressKey("ArrowRight"));
    expect(button("Bold")).toHaveFocus();
  });

  it("stops listening once uninstalled", async () => {
    const user = userEvent.setup();
    render(<NotesFixture />);
    uninstall();
    uninstall = vi.fn();
    act(() => button("Bold").focus());

    await user.keyboard("{ArrowUp}");
    expect(button("Bold")).toHaveFocus();
  });
});

// A grid whose rows are virtualized: only rows first..last are mounted, and
// each carries its position in the whole grid (aria-rowindex, 1-based) out of
// aria-rowcount. Panes sit on either side, so a leave is observable as focus.
function VirtualGridFixture({
  first,
  last,
  count,
  columns = 1,
}: {
  first: number;
  last: number;
  count: number;
  columns?: number;
}) {
  const rows = [];
  for (let i = first; i <= last; i += 1) {
    const visualRow = Math.floor((i - 1) / columns);
    rows.push(
      // biome-ignore lint/a11y/useSemanticElements: a grid of divs, as the Virtualizer mounts them.
      <div
        key={i}
        role="row"
        tabIndex={-1}
        aria-label={`Card ${i}`}
        aria-rowindex={i}
        data-rect={`200 ${visualRow * 40} 400 ${visualRow * 40 + 40}`}
      >
        Card {i}
      </div>
    );
  }
  return (
    <main>
      <section data-focus-pane="sidebar" tabIndex={-1} aria-label="Sidebar" data-rect="0 0 200 800">
        <button type="button" data-rect="10 10 100 40">
          Sidebar action
        </button>
      </section>
      <section
        data-focus-pane="gallery"
        tabIndex={-1}
        aria-label="Gallery"
        data-rect="200 0 400 800"
      >
        {/* biome-ignore lint/a11y/useSemanticElements: a 2D grid of divs, as the gallery renders it. */}
        <div
          role="grid"
          data-layout="grid"
          aria-label="Books"
          aria-rowcount={count}
          data-rect="200 0 400 800"
        >
          {rows}
        </div>
      </section>
      <section
        data-focus-pane="editor"
        tabIndex={-1}
        aria-label="Editor"
        data-rect="400 0 1000 800"
      >
        <button type="button" data-rect="410 10 450 40">
          Editor action
        </button>
      </section>
    </main>
  );
}

describe("virtualized grid rows (aria-rowindex / aria-rowcount)", () => {
  it("does not leave a grid through its right edge while the next row is unmounted", async () => {
    const user = userEvent.setup();
    render(<VirtualGridFixture first={5} last={9} count={20} />);
    act(() => row("Card 9").focus());

    await user.keyboard("{ArrowRight}");
    expect(row("Card 9")).toHaveFocus();
  });

  it("does not leave a grid through its left edge while the previous row is unmounted", async () => {
    const user = userEvent.setup();
    render(<VirtualGridFixture first={5} last={9} count={20} />);
    act(() => row("Card 5").focus());

    await user.keyboard("{ArrowLeft}");
    expect(row("Card 5")).toHaveFocus();
  });

  it("still leaves through the right edge at the true last row", async () => {
    const user = userEvent.setup();
    render(<VirtualGridFixture first={16} last={20} count={20} />);
    act(() => row("Card 20").focus());

    await user.keyboard("{ArrowRight}");
    expect(button("Editor action")).toHaveFocus();
  });

  it("keeps Up and Down inside a virtualized list at its mounted ends", async () => {
    const user = userEvent.setup();
    render(<VirtualGridFixture first={5} last={9} count={20} />);
    act(() => row("Card 9").focus());

    await user.keyboard("{ArrowDown}");
    expect(row("Card 9")).toHaveFocus();
    act(() => row("Card 5").focus());
    await user.keyboard("{ArrowUp}");
    expect(row("Card 5")).toHaveFocus();
  });

  // A multi-column grid mounts whole visual rows, so the unmounted neighbor
  // beside the row's last (or first) card is on another visual row: the row's
  // side edge is a true edge even while that neighbor is unmounted (#562).
  it("leaves a multi-column grid through its right edge while the next row is unmounted", async () => {
    const user = userEvent.setup();
    render(<VirtualGridFixture first={5} last={12} count={20} columns={2} />);
    act(() => row("Card 12").focus());

    await user.keyboard("{ArrowRight}");
    expect(button("Editor action")).toHaveFocus();
  });

  it("leaves a multi-column grid through its left edge while the previous row is unmounted", async () => {
    const user = userEvent.setup();
    render(<VirtualGridFixture first={5} last={12} count={20} columns={2} />);
    act(() => row("Card 5").focus());

    await user.keyboard("{ArrowLeft}");
    expect(button("Sidebar action")).toHaveFocus();
  });

  it("wraps right inside a multi-column row to the card beside it", async () => {
    const user = userEvent.setup();
    render(<VirtualGridFixture first={5} last={12} count={20} columns={2} />);
    act(() => row("Card 5").focus());

    await user.keyboard("{ArrowRight}");
    expect(row("Card 6")).toHaveFocus();
  });

  it("leaves right at the true last card of a multi-column grid", async () => {
    const user = userEvent.setup();
    render(<VirtualGridFixture first={17} last={20} count={20} columns={2} />);
    act(() => row("Card 20").focus());

    await user.keyboard("{ArrowRight}");
    expect(button("Editor action")).toHaveFocus();
  });
});

// The Customize toolbar previews (#672): a horizontal grid list box whose
// items wrap onto rows like a toolbar, with the tray below it.
function WrappedRowFixture() {
  const items = [
    { id: "a", rect: "0 0 40 30" },
    { id: "b", rect: "50 0 150 30" },
    { id: "c", rect: "160 0 200 30" },
    { id: "d", rect: "0 40 40 70" },
    { id: "e", rect: "90 40 130 70" },
  ];
  return (
    <main>
      <ListBox aria-label="Preview" layout="grid" orientation="horizontal" data-rect="0 0 200 70">
        {items.map(({ id, rect }) => (
          <ListBoxItem key={id} id={id} textValue={`Item ${id}`} data-rect={rect}>
            Item {id}
          </ListBoxItem>
        ))}
      </ListBox>
      <ListBox aria-label="Tray" layout="grid" orientation="horizontal" data-rect="0 100 200 130">
        <ListBoxItem id="t" textValue="Tray item" data-rect="0 100 40 130">
          Tray item
        </ListBoxItem>
      </ListBox>
    </main>
  );
}

describe("a horizontal grid list box that wraps like a toolbar", () => {
  const option = (name: string) => screen.getByRole("option", { name });

  it("moves Left and Right in reading order across its rows", async () => {
    const user = userEvent.setup();
    render(<WrappedRowFixture />);
    act(() => option("Item c").focus());

    await user.keyboard("{ArrowRight}");
    expect(option("Item d")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(option("Item c")).toHaveFocus();
  });

  it("moves Up and Down between its rows by position", async () => {
    const user = userEvent.setup();
    render(<WrappedRowFixture />);
    act(() => option("Item b").focus());

    await user.keyboard("{ArrowDown}");
    expect(option("Item e")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(option("Item b")).toHaveFocus();
  });

  it("leaves its last row Down into the widget below, and comes back Up", async () => {
    const user = userEvent.setup();
    render(<WrappedRowFixture />);
    act(() => option("Item d").focus());

    await user.keyboard("{ArrowDown}");
    expect(option("Tray item")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("listbox", { name: "Preview" }).contains(document.activeElement)).toBe(
      true
    );
  });
});
