import { useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ItemActionsMenu, ItemActionsPopover } from "@/components/ui/ItemActionsMenu";
import type { ItemAction } from "@/components/ui/ItemActionsMenu";
import { useItemContextMenu, useTouchDragFromHandle } from "@/hooks/useItemContextMenu";
import { installPointerEvent, touchLongPress, touchTap } from "@/test/support/pointer-events";

beforeAll(installPointerEvent);

afterEach(() => {
  vi.useRealTimers();
});

function Row({
  actions,
  onSelect,
  onDragStart = vi.fn(),
}: {
  actions: ItemAction[];
  onSelect: () => void;
  onDragStart?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { itemProps } = useItemContextMenu({ onOpen: () => setIsOpen(true) });
  const dragGuard = useTouchDragFromHandle();

  return (
    <div {...dragGuard}>
      <div
        data-testid="row"
        draggable
        onDragStart={onDragStart}
        onClick={(event) => {
          if (event.currentTarget.contains(event.target as Node)) onSelect();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.currentTarget === event.target) onSelect();
        }}
        {...itemProps}
      >
        <span data-testid="title">Row title</span>
        <span data-testid="handle" data-drag-handle="">
          grip
        </span>
        <input aria-label="rename" defaultValue="Row title" />
        <ItemActionsMenu
          label="More actions for Row title"
          actions={actions}
          isOpen={isOpen}
          onOpenChange={setIsOpen}
        />
      </div>
    </div>
  );
}

function MenuSurface({
  name,
  kind,
  onAction,
}: {
  name: string;
  kind: "button" | "popover";
  onAction: () => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const { itemProps } = useItemContextMenu({ onOpen: () => setIsOpen(true) });
  const props = {
    label: `${name} actions`,
    isOpen,
    onOpenChange: setIsOpen,
    actions: [
      { id: "run", label: `Run ${name}`, onAction },
      {
        id: "move",
        label: `Move ${name}`,
        children: [{ id: "book", label: `Book for ${name}`, onAction }],
      },
    ],
  };
  return (
    <div ref={anchorRef} {...itemProps}>
      <span>{name}</span>
      {kind === "button" ? (
        <ItemActionsMenu {...props} anchorRef={anchorRef} />
      ) : (
        <ItemActionsPopover {...props} triggerRef={anchorRef} />
      )}
    </div>
  );
}

function buildActions(overrides: Partial<Record<string, () => void>> = {}): ItemAction[] {
  return [
    { id: "rename", label: "Rename", onAction: overrides.rename ?? vi.fn() },
    { id: "duplicate", label: "Duplicate", onAction: overrides.duplicate ?? vi.fn() },
    {
      id: "move",
      label: "Move to",
      children: [
        { id: "a", label: "Book A", isCurrent: true, onAction: overrides.a ?? vi.fn() },
        { id: "b", label: "Book B", isCurrent: false, onAction: overrides.b ?? vi.fn() },
      ],
    },
    {
      id: "delete",
      label: "Delete",
      isDestructive: true,
      onAction: overrides.delete ?? vi.fn(),
    },
  ];
}

describe("ItemActionsMenu keyboard", () => {
  it("opens from the ⋯ button, moves with arrows, runs the action with Enter", async () => {
    const user = userEvent.setup();
    const duplicate = vi.fn();
    const onSelect = vi.fn();
    render(<Row actions={buildActions({ duplicate })} onSelect={onSelect} />);

    const trigger = screen.getByRole("button", { name: "More actions for Row title" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const menu = await screen.findByRole("menu");
    expect(menu).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("toggles closed from its touch button and opens the last action with ArrowUp", async () => {
    const user = userEvent.setup();
    render(<Row actions={buildActions()} onSelect={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "More actions for Row title" });
    await user.pointer({ target: trigger, keys: "[TouchA]" });
    await screen.findByRole("menu");
    await user.pointer({ target: trigger, keys: "[TouchA]" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    trigger.focus();
    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus());
  });

  it("Escape closes the menu and returns focus to the ⋯ button", async () => {
    const user = userEvent.setup();
    render(<Row actions={buildActions()} onSelect={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "More actions for Row title" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("opens a submenu with ArrowRight and runs the chosen entry", async () => {
    const user = userEvent.setup();
    const b = vi.fn();
    render(<Row actions={buildActions({ b })} onSelect={vi.fn()} />);

    screen.getByRole("button", { name: "More actions for Row title" }).focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Move to" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");

    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Book A" })).toHaveFocus());
    await user.keyboard("{ArrowDown}{Enter}");
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("opens from the context-menu key on the focused row", async () => {
    render(<Row actions={buildActions()} onSelect={vi.fn()} />);

    fireEvent.contextMenu(screen.getByTestId("row"));

    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });
});

describe("ItemActionsMenu pointer gestures", () => {
  it("right click opens the menu without selecting the row", async () => {
    const onSelect = vi.fn();
    render(<Row actions={buildActions()} onSelect={onSelect} />);

    const title = screen.getByTestId("title");
    const event = fireEvent.contextMenu(title);

    expect(event).toBe(false);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("leaves the native context menu alone inside text inputs", () => {
    render(<Row actions={buildActions()} onSelect={vi.fn()} />);

    const notPrevented = fireEvent.contextMenu(screen.getByRole("textbox", { name: "rename" }));

    expect(notPrevented).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("touch long-press opens the menu and swallows the trailing click", async () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(<Row actions={buildActions()} onSelect={onSelect} />);

    touchLongPress(screen.getByTestId("title"));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("a short touch tap selects the row and does not open the menu", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(<Row actions={buildActions()} onSelect={onSelect} />);

    touchTap(screen.getByTestId("title"));
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("the tap after a long-press selects the row again", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(<Row actions={buildActions()} onSelect={onSelect} />);

    touchLongPress(screen.getByTestId("title"));
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    touchTap(screen.getByTestId("title"));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a long-press on the drag handle is left to drag-and-drop", () => {
    vi.useFakeTimers();
    render(<Row actions={buildActions()} onSelect={vi.fn()} />);

    touchLongPress(screen.getByTestId("handle"));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("holding the mouse still does not open the menu and the click still selects", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(<Row actions={buildActions()} onSelect={onSelect} />);

    const title = screen.getByTestId("title");
    act(() => {
      fireEvent.pointerDown(title, { pointerType: "mouse", button: 0, buttons: 1 });
      vi.advanceTimersByTime(1000);
      fireEvent.pointerUp(title, { pointerType: "mouse", button: 0 });
      fireEvent.click(title);
    });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("useTouchDragFromHandle", () => {
  it("blocks a touch drag that starts on the row body", () => {
    const onDragStart = vi.fn();
    render(<Row actions={buildActions()} onSelect={vi.fn()} onDragStart={onDragStart} />);

    const row = screen.getByTestId("row");
    fireEvent.pointerDown(screen.getByTestId("title"), { pointerType: "touch" });
    const notPrevented = fireEvent.dragStart(row);

    expect(notPrevented).toBe(false);
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("lets a touch drag start from the drag handle", () => {
    const onDragStart = vi.fn();
    render(<Row actions={buildActions()} onSelect={vi.fn()} onDragStart={onDragStart} />);

    fireEvent.pointerDown(screen.getByTestId("handle"), { pointerType: "touch" });
    fireEvent.dragStart(screen.getByTestId("row"));

    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  it("keeps mouse drags from anywhere on the row", () => {
    const onDragStart = vi.fn();
    render(<Row actions={buildActions()} onSelect={vi.fn()} onDragStart={onDragStart} />);

    fireEvent.pointerDown(screen.getByTestId("title"), { pointerType: "mouse" });
    fireEvent.dragStart(screen.getByTestId("row"));

    expect(onDragStart).toHaveBeenCalledTimes(1);
  });
});

describe.each(["button", "popover"] as const)("%s Item Menu handoff", (kind) => {
  it("replaces the open menu, then switches back without invoking either item", async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();
    render(
      <>
        <MenuSurface name="First" kind={kind} onAction={first} />
        <MenuSurface name="Second" kind={kind} onAction={second} />
      </>
    );

    for (const name of ["First", "Second", "First"]) {
      const target = screen.getByText(name);
      expect(target.closest("[inert], [aria-hidden='true']")).toBeNull();
      fireEvent.pointerDown(target, { button: 2, pointerType: "mouse" });
      expect(fireEvent.contextMenu(target)).toBe(false);
      fireEvent.pointerUp(target, { button: 2, pointerType: "mouse" });
      const menu = await screen.findByRole("menu", { name: `${name} actions` });
      expect(screen.getAllByRole("menu")).toHaveLength(1);
      await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    }
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on a blank-area click or right-click while leaving native menus outside items available", async () => {
    const user = userEvent.setup();
    render(
      <>
        <MenuSurface name="First" kind={kind} onAction={vi.fn()} />
        <div data-testid="blank">Blank area</div>
      </>
    );
    await user.pointer({ target: screen.getByText("First"), keys: "[MouseRight]" });
    await screen.findByRole("menu");
    await user.click(screen.getByTestId("blank"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.pointer({ target: screen.getByText("First"), keys: "[MouseRight]" });
    await screen.findByRole("menu");
    fireEvent.pointerDown(screen.getByTestId("blank"), { button: 2, pointerType: "mouse" });
    expect(fireEvent.contextMenu(screen.getByTestId("blank"))).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps a touch long-press menu open after the browser's trailing contextmenu event", () => {
    vi.useFakeTimers();
    render(
      <>
        <MenuSurface name="First" kind={kind} onAction={vi.fn()} />
        <MenuSurface name="Second" kind={kind} onAction={vi.fn()} />
      </>
    );
    touchLongPress(screen.getByText("First"));
    expect(screen.getByRole("menu", { name: "First actions" })).toBeInTheDocument();
    touchLongPress(screen.getByText("Second"));
    expect(screen.getByRole("menu", { name: "Second actions" })).toBeInTheDocument();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });
});

describe("Item Menu submenus during handoff", () => {
  it("replaces the entire menu while a submenu is open", async () => {
    const user = userEvent.setup();
    render(
      <>
        <MenuSurface name="First" kind="button" onAction={vi.fn()} />
        <MenuSurface name="Second" kind="button" onAction={vi.fn()} />
      </>
    );
    screen.getByRole("button", { name: "First actions" }).focus();
    await user.keyboard("{Enter}{ArrowDown}{ArrowRight}");
    await screen.findByRole("menuitem", { name: "Book for First" });
    const second = screen.getByText("Second");
    expect(second.closest("[inert], [aria-hidden='true']")).toBeNull();
    await user.pointer({ target: second, keys: "[MouseRight]" });
    await screen.findByRole("menu", { name: "Second actions" });
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(screen.queryByRole("menuitem", { name: "Book for First" })).not.toBeInTheDocument();
  });

  it("does not dismiss before a portaled submenu action runs", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<MenuSurface name="First" kind="button" onAction={onAction} />);
    screen.getByRole("button", { name: "First actions" }).focus();
    await user.keyboard("{Enter}{ArrowDown}{ArrowRight}");
    await user.click(await screen.findByRole("menuitem", { name: "Book for First" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
