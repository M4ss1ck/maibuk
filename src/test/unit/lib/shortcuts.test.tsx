import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

import { useModalStore } from "@/components/ui/modal-store";

describe("useShortcuts modal blocking", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useModalStore.setState({ modalIds: [], openCount: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fire shortcuts while any modal is open (listener removed)", async () => {
    useModalStore.setState({ modalIds: ["modal-1"], openCount: 1 });

    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ keys: ["ctrl+s"], onTrigger }]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("does not fire allowInInput shortcuts while modal is open", async () => {
    useModalStore.setState({ modalIds: ["modal-1"], openCount: 1 });

    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ keys: ["F11"], onTrigger, allowInInput: true }]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F11", bubbles: true }));
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("fires shortcuts when no modal is open", async () => {
    useModalStore.setState({ modalIds: [], openCount: 0 });

    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ keys: ["ctrl+s"], onTrigger }]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("re-enables shortcuts when the final modal closes (effect re-attaches listener)", async () => {
    useModalStore.setState({ modalIds: ["modal-1"], openCount: 1 });

    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ keys: ["ctrl+s"], onTrigger }]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    expect(onTrigger).not.toHaveBeenCalled();

    act(() => {
      useModalStore.setState({ modalIds: [], openCount: 0 });
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("fires a modifier shortcut even when a pressable stops keydown propagation", async () => {
    useModalStore.setState({ modalIds: [], openCount: 0 });

    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ keys: ["ctrl+s"], onTrigger }]));

    // React Spectrum pressables (React Aria menus, listboxes, toolbars) stop
    // keydown propagation, which would otherwise hide shortcut keys.
    const pressable = document.createElement("button");
    pressable.addEventListener("keydown", (event) => event.stopPropagation());
    document.body.appendChild(pressable);
    pressable.focus();

    pressable.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })
    );

    expect(onTrigger).toHaveBeenCalledTimes(1);
    pressable.remove();
  });

  it("preserves sequence matching when no modal is open", async () => {
    useModalStore.setState({ modalIds: [], openCount: 0 });

    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ sequence: ["g", "p"] as const, onTrigger }]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("suppresses sequence matching while modal is open", async () => {
    useModalStore.setState({ modalIds: ["modal-1"], openCount: 1 });

    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ sequence: ["g", "p"] as const, onTrigger }]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("discards a partial sequence when modal scope opens", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ sequence: ["g", "p"] as const, onTrigger }]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));

    act(() => {
      useModalStore.getState().register("modal-1");
    });
    act(() => {
      useModalStore.getState().unregister("modal-1");
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));

    expect(onTrigger).not.toHaveBeenCalled();
  });
});

describe("useShortcuts capture phase and typing targets", () => {
  beforeEach(() => {
    useModalStore.setState({ modalIds: [], openCount: 0 });
  });

  it("does not fire a Mod shortcut without allowInInput while focus is in a textbox", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ keys: ["ctrl+s"], onTrigger }]));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })
    );

    expect(onTrigger).not.toHaveBeenCalled();
    input.remove();
  });

  it("does not fire a Mod shortcut without allowInInput while focus is in a contenteditable", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ keys: ["ctrl+s"], onTrigger }]));

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);

    editable.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })
    );

    expect(onTrigger).not.toHaveBeenCalled();
    editable.remove();
  });

  it("fires a shortcut exactly once when both capture and bubble listeners see the event", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ keys: ["ctrl+s"], onTrigger }]));

    // A modifier combo reaches both the capture listener and the bubble
    // listener; the shared handled set keeps it from triggering twice.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })
    );

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });
});
