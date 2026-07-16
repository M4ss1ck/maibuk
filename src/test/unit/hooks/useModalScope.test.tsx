import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";

import { useModalStore } from "@/components/ui/modal-store";
import { useModalScope } from "@/hooks/useModalScope";

describe("modal store stack", () => {
  beforeEach(() => {
    useModalStore.setState({ modalIds: [], openCount: 0 });
  });

  it("duplicate registration of same ID is idempotent", () => {
    useModalStore.getState().register("modal-a");
    expect(useModalStore.getState().openCount).toBe(1);
    expect(useModalStore.getState().modalIds).toEqual(["modal-a"]);

    useModalStore.getState().register("modal-a");
    expect(useModalStore.getState().openCount).toBe(1);
    expect(useModalStore.getState().modalIds).toEqual(["modal-a"]);
  });

  it("duplicate after nested registration does not duplicate", () => {
    useModalStore.getState().register("modal-a");
    useModalStore.getState().register("modal-b");
    useModalStore.getState().register("modal-a");

    expect(useModalStore.getState().openCount).toBe(2);
    expect(useModalStore.getState().modalIds).toEqual(["modal-a", "modal-b"]);
  });

  it("closing a modal removes only its own ID", () => {
    useModalStore.setState({
      modalIds: ["modal-a", "modal-b", "modal-c"],
      openCount: 3,
    });

    act(() => {
      useModalStore.getState().unregister("modal-b");
    });

    expect(useModalStore.getState().openCount).toBe(2);
    expect(useModalStore.getState().modalIds).toEqual(["modal-a", "modal-c"]);
  });

  it("openCount never goes negative", () => {
    useModalStore.setState({ modalIds: [], openCount: 0 });

    act(() => {
      useModalStore.getState().unregister("phantom");
    });

    expect(useModalStore.getState().openCount).toBe(0);
    expect(useModalStore.getState().modalIds).toEqual([]);
  });

  it("unregistering a non-existent ID does nothing", () => {
    useModalStore.setState({
      modalIds: ["first"],
      openCount: 1,
    });

    act(() => {
      useModalStore.getState().unregister("nonexistent");
    });

    expect(useModalStore.getState().modalIds).toEqual(["first"]);
    expect(useModalStore.getState().openCount).toBe(1);
  });
});

describe("useModalScope", () => {
  beforeEach(() => {
    useModalStore.setState({ modalIds: [], openCount: 0 });
  });

  it("registers on mount and unregisters on unmount when isOpen is true", () => {
    const { unmount } = renderHook(({ open }: { open: boolean }) => useModalScope(open), {
      initialProps: { open: true },
    });

    expect(useModalStore.getState().openCount).toBe(1);
    expect(useModalStore.getState().modalIds).toHaveLength(1);

    unmount();

    expect(useModalStore.getState().openCount).toBe(0);
    expect(useModalStore.getState().modalIds).toEqual([]);
  });

  it("does not register when isOpen is false", () => {
    renderHook(() => useModalScope(false));

    expect(useModalStore.getState().openCount).toBe(0);
    expect(useModalStore.getState().modalIds).toEqual([]);
  });

  it("unregisters when isOpen transitions from true to false", () => {
    const { rerender } = renderHook(({ open }: { open: boolean }) => useModalScope(open), {
      initialProps: { open: true },
    });

    expect(useModalStore.getState().openCount).toBe(1);

    rerender({ open: false });

    expect(useModalStore.getState().openCount).toBe(0);
    expect(useModalStore.getState().modalIds).toEqual([]);
  });

  it("does not double-register on re-render with same isOpen", () => {
    const { rerender } = renderHook(({ open }: { open: boolean }) => useModalScope(open), {
      initialProps: { open: true },
    });

    expect(useModalStore.getState().openCount).toBe(1);

    rerender({ open: true });

    expect(useModalStore.getState().openCount).toBe(1);
    expect(useModalStore.getState().modalIds).toHaveLength(1);
  });
});
