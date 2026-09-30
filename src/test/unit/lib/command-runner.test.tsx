import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "@/components/ui/Modal";
import { useModalStore } from "@/components/ui/modal-store";
import { useTutorialStore } from "@/features/tutorial/store";
import { useItemCommands } from "@/hooks/useItemCommands";
import { runCommand } from "@/lib/command-runner";
import { useShortcuts } from "@/lib/shortcuts";
import type { CommandId } from "@/lib/shortcut-registry";

function Binding({
  id,
  onTrigger,
  enabled,
}: {
  id: CommandId;
  onTrigger: (event?: KeyboardEvent) => void;
  enabled?: boolean;
}) {
  useShortcuts([{ id, onTrigger, enabled }]);
  return null;
}

function DisabledBinding({ id, onTrigger }: { id: CommandId; onTrigger: () => void }) {
  useShortcuts([{ id, onTrigger }], { enabled: false });
  return null;
}

function Item({ onAction }: { onAction: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useItemCommands(ref, [{ commandId: "noteItem.delete", onAction }]);
  return (
    <div ref={ref}>
      <button type="button">inside</button>
    </div>
  );
}

let path = "/";
function LocationProbe() {
  path = useLocation().pathname;
  return null;
}

/** A screen where global.gotoNotes navigates, with a dismissable dialog over it. */
function NavigatingHarness({ onCloseCalls }: { onCloseCalls?: string[] }) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  useShortcuts([
    {
      id: "global.gotoNotes",
      onTrigger: () => {
        navigate("/notes");
      },
    },
    {
      id: "global.toggleTheme",
      onTrigger: () => {},
    },
  ]);
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open dialog
      </button>
      <Modal
        isOpen={isOpen}
        onClose={() => {
          onCloseCalls?.push("dialog");
          setIsOpen(false);
        }}
        title="Test dialog"
      >
        <p>Dialog body</p>
      </Modal>
      <Routes>
        <Route path="/" element={<h1>Home</h1>} />
        <Route path="/notes" element={<h1>Notes</h1>} />
      </Routes>
    </>
  );
}

function renderNavigating(onCloseCalls?: string[]) {
  path = "/";
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <NavigatingHarness onCloseCalls={onCloseCalls} />
      <LocationProbe />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  useTutorialStore.setState({ status: "idle" });
});

describe("runCommand()", () => {
  it("runs the newest mounted binding; after it unmounts the previous one runs", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <>
        <Binding id="common.save" onTrigger={first} />
        <Binding id="common.save" onTrigger={second} />
      </>
    );

    expect(await runCommand("common.save", { source: "palette" })).toBe("ran");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    rerender(<Binding id="common.save" onTrigger={first} />);
    expect(await runCommand("common.save", { source: "palette" })).toBe("ran");
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable once every binding has unmounted", async () => {
    const onTrigger = vi.fn();
    const { unmount } = render(<Binding id="common.save" onTrigger={onTrigger} />);
    unmount();

    expect(await runCommand("common.save", { source: "palette" })).toBe("unavailable");
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("reports unavailable for a binding with enabled false", async () => {
    const onTrigger = vi.fn();
    render(<Binding id="common.save" onTrigger={onTrigger} enabled={false} />);

    expect(await runCommand("common.save", { source: "palette" })).toBe("unavailable");
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("reports unavailable when the whole useShortcuts instance is disabled", async () => {
    const onTrigger = vi.fn();
    render(<DisabledBinding id="common.save" onTrigger={onTrigger} />);

    expect(await runCommand("common.save", { source: "palette" })).toBe("unavailable");
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("refuses a non-global Command while a Modal is open but runs a non-navigating global one over it", async () => {
    const save = vi.fn();
    const help = vi.fn();
    render(
      <>
        <Binding id="common.save" onTrigger={save} />
        <Binding id="global.showHelp" onTrigger={help} />
      </>
    );
    act(() => {
      useModalStore.getState().register("modal-1");
    });

    expect(await runCommand("common.save", { source: "palette" })).toBe("refused-dialog");
    expect(save).not.toHaveBeenCalled();
    expect(await runCommand("global.showHelp", { source: "palette" })).toBe("ran");
    expect(help).toHaveBeenCalledTimes(1);
    // The dialog stays open: a non-navigating global Command runs over it.
    expect(useModalStore.getState().modalIds).toEqual(["modal-1"]);
  });

  it("runs tutorial.skip but refuses anything else while a Tutorial runs", async () => {
    const skip = vi.fn();
    const help = vi.fn();
    render(
      <>
        <Binding id="tutorial.skip" onTrigger={skip} />
        <Binding id="global.showHelp" onTrigger={help} />
      </>
    );
    act(() => {
      useTutorialStore.setState({ status: "running" } as never);
    });

    expect(await runCommand("tutorial.skip", { source: "voice" })).toBe("ran");
    expect(skip).toHaveBeenCalledTimes(1);
    expect(await runCommand("global.showHelp", { source: "voice" })).toBe("refused-tutorial");
    expect(help).not.toHaveBeenCalled();
  });

  it("runs an item Command only while focus is inside the item", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <>
        <button type="button">outside</button>
        <Item onAction={onAction} />
      </>
    );

    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(await runCommand("noteItem.delete", { source: "palette" })).toBe("unavailable");
    expect(onAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "inside" }));
    expect(await runCommand("noteItem.delete", { source: "palette" })).toBe("ran");
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("calls onTrigger with no event", async () => {
    const seen: Array<KeyboardEvent | undefined> = [];
    render(
      <Binding
        id="common.save"
        onTrigger={(event) => {
          seen.push(event);
        }}
      />
    );

    expect(await runCommand("common.save", { source: "voice" })).toBe("ran");
    expect(seen).toEqual([undefined]);
  });

  it("a navigating Command closes the dialog first, restores focus, then navigates", async () => {
    const user = userEvent.setup();
    renderNavigating();
    const trigger = screen.getByRole("button", { name: "Open dialog" });

    await user.click(trigger);
    await screen.findByRole("dialog");

    // Outside act: the close path commits and unregisters between macrotasks,
    // the way it does in production; act would batch it past the wait loop.
    const outcome = await runCommand("global.gotoNotes", { source: "palette" });
    expect(outcome).toBe("ran");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(path).toBe("/notes");
    // Focus is back on the trigger that opened the dialog.
    expect(document.activeElement).toBe(trigger);
  });

  it("nested Modals close topmost first before navigating", async () => {
    const user = userEvent.setup();
    const onCloseCalls: string[] = [];
    function NestedHarness() {
      const navigate = useNavigate();
      const [outerOpen, setOuterOpen] = useState(false);
      const [innerOpen, setInnerOpen] = useState(false);
      useShortcuts([
        {
          id: "global.gotoNotes",
          onTrigger: () => {
            navigate("/notes");
          },
        },
      ]);
      return (
        <>
          <button type="button" onClick={() => setOuterOpen(true)}>
            Open outer
          </button>
          <Modal
            isOpen={outerOpen}
            onClose={() => {
              onCloseCalls.push("outer");
              setOuterOpen(false);
            }}
            title="Outer"
          >
            <button type="button" onClick={() => setInnerOpen(true)}>
              Open inner
            </button>
          </Modal>
          <Modal
            isOpen={innerOpen}
            onClose={() => {
              onCloseCalls.push("inner");
              setInnerOpen(false);
            }}
            title="Inner"
          >
            <p>Inner body</p>
          </Modal>
          <Routes>
            <Route path="/" element={<h1>Home</h1>} />
            <Route path="/notes" element={<h1>Notes</h1>} />
          </Routes>
        </>
      );
    }
    path = "/";
    render(
      <MemoryRouter initialEntries={["/"]}>
        <NestedHarness />
        <LocationProbe />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("button", { name: "Open outer" }));
    await screen.findByRole("dialog", { name: "Outer" });
    await user.click(screen.getByRole("button", { name: "Open inner" }));
    await screen.findByRole("dialog", { name: "Inner" });
    expect(useModalStore.getState().modalIds).toHaveLength(2);

    // Outside act: closers commit between macrotasks, as in production.
    const outcome = await runCommand("global.gotoNotes", { source: "palette" });
    expect(outcome).toBe("ran");
    expect(onCloseCalls).toEqual(["inner", "outer"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(path).toBe("/notes");
  });

  it("a dialog that refuses to close stops the navigation", async () => {
    const user = userEvent.setup();
    function StuckHarness() {
      const navigate = useNavigate();
      const [isOpen, setIsOpen] = useState(false);
      useShortcuts([
        {
          id: "global.gotoNotes",
          onTrigger: () => {
            navigate("/notes");
          },
        },
      ]);
      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>
            Open stuck
          </button>
          {/* onClose does nothing: the dialog cannot be dismissed. */}
          <Modal isOpen={isOpen} onClose={() => {}} title="Stuck">
            <p>Stuck body</p>
          </Modal>
          <Routes>
            <Route path="/" element={<h1>Home</h1>} />
            <Route path="/notes" element={<h1>Notes</h1>} />
          </Routes>
        </>
      );
    }
    path = "/";
    render(
      <MemoryRouter initialEntries={["/"]}>
        <StuckHarness />
        <LocationProbe />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("button", { name: "Open stuck" }));
    await screen.findByRole("dialog");

    const outcome = await runCommand("global.gotoNotes", { source: "palette" });
    expect(outcome).toBe("refused-dialog-close");
    expect(path).toBe("/");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("a Modal registered with no close path refuses the navigation", async () => {
    const navigate = vi.fn();
    function BareHarness() {
      useShortcuts([
        {
          id: "global.gotoNotes",
          onTrigger: () => {
            navigate("/notes");
          },
        },
      ]);
      return null;
    }
    render(
      <MemoryRouter initialEntries={["/"]}>
        <BareHarness />
      </MemoryRouter>
    );
    act(() => {
      useModalStore.getState().register("bare-modal");
    });

    expect(await runCommand("global.gotoNotes", { source: "palette" })).toBe(
      "refused-dialog-close"
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(useModalStore.getState().modalIds).toEqual(["bare-modal"]);
  });
});
