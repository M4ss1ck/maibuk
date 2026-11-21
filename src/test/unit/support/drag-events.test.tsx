import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, GridList, GridListItem, useDragAndDrop } from "react-aria-components";
import { isVirtualDragging } from "react-aria/private/dnd/DragManager";
import { describe, expect, it } from "vitest";
import {
  endKeyboardDrag,
  endLeakedKeyboardDrag,
  waitForKeyboardDrag,
} from "@/test/support/drag-events";

// The setup file's afterEach relies on endLeakedKeyboardDrag to stop one
// leaked keyboard drag from hiding every later test's screen.

function ReorderList() {
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ "text/plain": String(key) })),
    onReorder: () => {},
  });
  return (
    <>
      <button type="button">Outside</button>
      <GridList aria-label="Items" dragAndDropHooks={dragAndDropHooks}>
        {["Alpha", "Bravo"].map((name) => (
          <GridListItem key={name} id={name} textValue={name}>
            <Button slot="drag">Drag {name}</Button>
            {name}
          </GridListItem>
        ))}
      </GridList>
    </>
  );
}

async function liftBravo() {
  const user = userEvent.setup();
  render(<ReorderList />);
  // Taken before the drag hides it: a hidden element has no accessible name.
  const outside = screen.getByRole("button", { name: "Outside" });
  screen.getByRole("row", { name: "Bravo" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("button", { name: "Drag Bravo" })).toHaveFocus();
  await user.keyboard("{Enter}");
  return { user, outside };
}

describe("endLeakedKeyboardDrag", () => {
  it("returns null when no drag runs", async () => {
    render(<ReorderList />);
    expect(await endLeakedKeyboardDrag()).toBeNull();
  });

  // Escape pressed before the drag's first frame is the leak it exists for.
  it("ends a drag left before its first frame", async () => {
    await liftBravo();
    expect(isVirtualDragging()).toBe(true);

    expect(await endLeakedKeyboardDrag()).toBe("ended");
    expect(isVirtualDragging()).toBe(false);
    expect(screen.getByRole("button", { name: "Outside" })).toBeInTheDocument();
  });

  it("ends a drag that has set up", async () => {
    await liftBravo();
    await waitForKeyboardDrag();

    expect(await endLeakedKeyboardDrag()).toBe("ended");
    expect(isVirtualDragging()).toBe(false);
  });
});

describe("endKeyboardDrag", () => {
  it("waits for the drag to expose the outside element again", async () => {
    const { user, outside } = await liftBravo();
    await waitForKeyboardDrag();

    await endKeyboardDrag(user, "{Escape}", outside);
    expect(isVirtualDragging()).toBe(false);
    expect(screen.getByRole("button", { name: "Outside" })).toBe(outside);
  });

  it("fails when the drag never hid the element", async () => {
    const { user } = await liftBravo();
    await waitForKeyboardDrag();
    const dropTarget = document.activeElement as HTMLElement;

    await expect(endKeyboardDrag(user, "{Escape}", dropTarget)).rejects.toThrow(
      "the drag should hide `outside`"
    );
    await endLeakedKeyboardDrag();
  });
});
