import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  useModalStore.setState({ modalIds: [], openCount: 0 });
  useTutorialStore.setState({ status: "idle" });
});

describe("runCommand()", () => {
  it("runs the newest mounted binding; after it unmounts the previous one runs", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <>
        <Binding id="common.save" onTrigger={first} />
        <Binding id="common.save" onTrigger={second} />
      </>
    );

    expect(runCommand("common.save", { source: "palette" })).toBe("ran");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    rerender(<Binding id="common.save" onTrigger={first} />);
    expect(runCommand("common.save", { source: "palette" })).toBe("ran");
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable once every binding has unmounted", () => {
    const onTrigger = vi.fn();
    const { unmount } = render(<Binding id="common.save" onTrigger={onTrigger} />);
    unmount();

    expect(runCommand("common.save", { source: "palette" })).toBe("unavailable");
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("reports unavailable for a binding with enabled false", () => {
    const onTrigger = vi.fn();
    render(<Binding id="common.save" onTrigger={onTrigger} enabled={false} />);

    expect(runCommand("common.save", { source: "palette" })).toBe("unavailable");
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("reports unavailable when the whole useShortcuts instance is disabled", () => {
    const onTrigger = vi.fn();
    render(<DisabledBinding id="common.save" onTrigger={onTrigger} />);

    expect(runCommand("common.save", { source: "palette" })).toBe("unavailable");
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("refuses a non-global Command while a Modal is open but runs a global one", () => {
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

    expect(runCommand("common.save", { source: "palette" })).toBe("refused-dialog");
    expect(save).not.toHaveBeenCalled();
    expect(runCommand("global.showHelp", { source: "palette" })).toBe("ran");
    expect(help).toHaveBeenCalledTimes(1);
  });

  it("runs tutorial.skip but refuses anything else while a Tutorial runs", () => {
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

    expect(runCommand("tutorial.skip", { source: "voice" })).toBe("ran");
    expect(skip).toHaveBeenCalledTimes(1);
    expect(runCommand("global.showHelp", { source: "voice" })).toBe("refused-tutorial");
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
    expect(runCommand("noteItem.delete", { source: "palette" })).toBe("unavailable");
    expect(onAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "inside" }));
    expect(runCommand("noteItem.delete", { source: "palette" })).toBe("ran");
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("calls onTrigger with no event", () => {
    const seen: Array<KeyboardEvent | undefined> = [];
    render(
      <Binding
        id="common.save"
        onTrigger={(event) => {
          seen.push(event);
        }}
      />
    );

    expect(runCommand("common.save", { source: "voice" })).toBe("ran");
    expect(seen).toEqual([undefined]);
  });
});
