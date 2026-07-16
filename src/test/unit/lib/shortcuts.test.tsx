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
