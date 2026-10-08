import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, GridList, GridListItem, Toolbar } from "react-aria-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installArrowNavigation } from "@/lib/arrow-navigation";
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

  it("does no layout reads for keys it does not handle", async () => {
    const user = userEvent.setup();
    render(<NotesFixture />);
    act(() => row("Note A").focus());
    rectReads = 0;

    await user.keyboard("x{Shift>}{ArrowRight}{/Shift}{Control>}{ArrowLeft}{/Control}{Tab}");
    expect(rectReads).toBe(0);
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
