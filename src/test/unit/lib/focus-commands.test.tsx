import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button as AriaButton } from "react-aria-components";
import { beforeEach, describe, expect, it, vi } from "vitest";
// Guards the private path: Tab order comes from React Aria itself, so an
// upgrade that moves it fails here instead of silently reordering Tab.
import { getFocusableTreeWalker } from "react-aria/private/focus/FocusScope";
import { Checkbox } from "@/components/ui/Checkbox";
import { ItemActionsMenu } from "@/components/ui/ItemActionsMenu";
import { Modal } from "@/components/ui/Modal";
import { useModalStore } from "@/components/ui/modal-store";
import { useTutorialStore } from "@/features/tutorial/store";
import { runCommand, type CommandRunOutcome } from "@/lib/command-runner";
import { focusCommandBindings, pressKey, moveFocus, useFocusCommands } from "@/lib/focus-commands";
import { isOutsideLayer, topmostLayer } from "@/lib/top-layer";

async function run(id: Parameters<typeof runCommand>[0]): Promise<CommandRunOutcome> {
  let outcome: CommandRunOutcome = "unavailable";
  await act(async () => {
    outcome = await runCommand(id, { source: "voice" });
  });
  return outcome;
}

function MenuHarness() {
  useFocusCommands();
  const [isOpen, setIsOpen] = useState(false);
  return (
    <ItemActionsMenu
      label="Item actions"
      actions={[
        { id: "one", label: "First action", onAction: () => {} },
        { id: "two", label: "Second action", onAction: () => {} },
        { id: "three", label: "Third action", onAction: () => {} },
      ]}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
    />
  );
}

function ModalHarness() {
  useFocusCommands();
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open dialog
      </button>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Test dialog">
        <button type="button" onClick={() => setIsOpen(false)}>
          Close dialog
        </button>
      </Modal>
    </>
  );
}

function TabHarness() {
  useFocusCommands();
  return (
    <>
      <button type="button">First</button>
      <div inert={true}>
        <button type="button" tabIndex={-1}>
          Hidden
        </button>
      </div>
      <button type="button">Second</button>
    </>
  );
}

function ActivateHarness({ onNative, onPress }: { onNative: () => void; onPress: () => void }) {
  useFocusCommands();
  return (
    <>
      <button type="button" onClick={onNative}>
        Native
      </button>
      <AriaButton onPress={onPress}>Aria</AriaButton>
    </>
  );
}

function CheckHarness({ onChange }: { onChange: (checked: boolean) => void }) {
  useFocusCommands();
  const [checked, setChecked] = useState(false);
  return (
    <>
      <button type="button">Before</button>
      <Checkbox
        checked={checked}
        onChange={(next) => {
          setChecked(next);
          onChange(next);
        }}
        label="Agree"
      />
    </>
  );
}

beforeEach(() => {
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  useTutorialStore.setState({ status: "idle" });
});

describe("focus command Tab order", () => {
  it("imports the walker from React Aria itself", () => {
    expect(typeof getFocusableTreeWalker).toBe("function");
  });

  it("exposes one binding per focus Command", () => {
    render(<MenuHarness />);
    const ids = focusCommandBindings().map((binding) => binding.id);
    expect(ids).toEqual([
      "focus.next",
      "focus.previous",
      "focus.up",
      "focus.down",
      "focus.left",
      "focus.right",
      "focus.first",
      "focus.last",
      "focus.activate",
      "focus.toggle",
      "focus.escape",
    ]);
  });
});

describe("focus arrows in a menu", () => {
  it("moves by voice the way the arrow keys move", async () => {
    const user = userEvent.setup();
    render(<MenuHarness />);

    screen.getByRole("button", { name: "Item actions" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "First action" })).toHaveFocus()
    );

    expect(await run("focus.down")).toBe("ran");
    expect(screen.getByRole("menuitem", { name: "Second action" })).toHaveFocus();
    expect(await run("focus.down")).toBe("ran");
    expect(screen.getByRole("menuitem", { name: "Third action" })).toHaveFocus();
    expect(await run("focus.up")).toBe("ran");
    expect(screen.getByRole("menuitem", { name: "Second action" })).toHaveFocus();
    expect(await run("focus.last")).toBe("ran");
    expect(screen.getByRole("menuitem", { name: "Third action" })).toHaveFocus();
    expect(await run("focus.first")).toBe("ran");
    expect(screen.getByRole("menuitem", { name: "First action" })).toHaveFocus();
    expect(await run("focus.left")).toBe("ran");
    expect(await run("focus.right")).toBe("ran");
  });
});

describe("focus.escape in a dialog", () => {
  it("closes the dialog and returns focus to its trigger", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    await screen.findByRole("dialog");

    expect(await run("focus.escape")).toBe("ran");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Open dialog" })).toHaveFocus();
  });
});

describe("focus.activate and focus.toggle", () => {
  it("runs a native button click once", async () => {
    const onNative = vi.fn();
    render(<ActivateHarness onNative={onNative} onPress={() => {}} />);

    screen.getByRole("button", { name: "Native" }).focus();
    expect(await run("focus.activate")).toBe("ran");
    expect(onNative).toHaveBeenCalledTimes(1);
  });

  it("runs a React Aria Button onPress exactly once", async () => {
    const onPress = vi.fn();
    render(<ActivateHarness onNative={() => {}} onPress={onPress} />);

    screen.getByRole("button", { name: "Aria" }).focus();
    expect(await run("focus.activate")).toBe("ran");
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("toggles the app Checkbox", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CheckHarness onChange={onChange} />);

    screen.getByRole("button", { name: "Before" }).focus();
    await user.tab();
    expect(screen.getByRole("checkbox", { name: "Agree" })).toHaveFocus();

    expect(await run("focus.toggle")).toBe("ran");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(await run("focus.toggle")).toBe("ran");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});

describe("focus.next and focus.previous", () => {
  it("skips an inert subtree and wraps around", async () => {
    render(<TabHarness />);

    screen.getByRole("button", { name: "First" }).focus();
    expect(await run("focus.next")).toBe("ran");
    expect(screen.getByRole("button", { name: "Second" })).toHaveFocus();
    expect(await run("focus.next")).toBe("ran");
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    expect(await run("focus.previous")).toBe("ran");
    expect(screen.getByRole("button", { name: "Second" })).toHaveFocus();
    expect(await run("focus.previous")).toBe("ran");
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("stays inside an open dialog", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    await screen.findByRole("dialog");
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Close dialog" });
    close.focus();

    expect(await run("focus.next")).toBe("ran");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(await run("focus.next")).toBe("ran");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(await run("focus.previous")).toBe("ran");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe("focus commands during a Tutorial run", () => {
  it("runs focus.next while the Tutorial is active", async () => {
    render(<TabHarness />);
    act(() => {
      useTutorialStore.setState({ status: "running" } as never);
    });

    expect(await runCommand("focus.next", { source: "voice" })).toBe("ran");
  });
});

describe("topmostLayer and isOutsideLayer", () => {
  it("is the page itself with no dialog open", () => {
    render(<TabHarness />);
    expect(topmostLayer()).toBe(document.body);
  });

  it("prefers the last aria-modal layer outside an inert subtree", () => {
    render(
      <div>
        <div aria-modal="true" role="dialog" aria-label="First">
          <button type="button">One</button>
        </div>
        <div inert={true}>
          <div aria-modal="true" role="dialog" aria-label="Buried">
            <button type="button">Two</button>
          </div>
        </div>
        <div aria-modal="true" role="dialog" aria-label="Top">
          <button type="button">Three</button>
        </div>
      </div>
    );
    expect(topmostLayer().getAttribute("aria-label")).toBe("Top");
  });

  it("sees inert and aria-hidden subtrees as outside the layer", () => {
    const { container } = render(
      <div>
        <div inert={true}>
          <button type="button">Buried</button>
        </div>
        <div aria-hidden="true">
          <button type="button">Hidden</button>
        </div>
        <button type="button">Shown</button>
      </div>
    );
    expect(isOutsideLayer(screen.getByRole("button", { name: "Buried" }))).toBe(true);
    expect(
      isOutsideLayer(container.querySelector('[aria-hidden="true"] button') as Element)
    ).toBe(true);
    expect(isOutsideLayer(screen.getByRole("button", { name: "Shown" }))).toBe(false);
  });

  it("pressKey and moveFocus are safe with nothing tabbable", () => {
    render(<div />);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(() => pressKey("Enter")).not.toThrow();
    expect(() => moveFocus(1)).not.toThrow();
  });
});
