import { act, renderHook } from "@testing-library/react";
import type { RemoteMutationRecord } from "@remote-dom/core";
import { describe, expect, it, vi } from "vitest";
import { stopRemoteUi } from "@/features/plugins/remote-ui/boundary";
import { usePluginRemoteUi } from "@/features/plugins/remote-ui/use-plugin-remote-ui";
import type { PluginLifecycle } from "@/features/plugins/types";

const INSERTS = [
  [0, "~", { id: "1", type: 1, element: "maibuk-evil", children: [] }, 0],
] as unknown as RemoteMutationRecord[];

describe("the Remote UI stop wiring", () => {
  it("stops the Plugin with remote-ui-limit", () => {
    const stop = vi.fn();
    const lifecycle = { stop } as unknown as PluginLifecycle;
    stopRemoteUi(lifecycle, "tracer");
    expect(stop).toHaveBeenCalledWith("tracer", "remote-ui-limit");
  });

  it("is a no-op with no lifecycle yet", () => {
    expect(() => stopRemoteUi(null, "tracer")).not.toThrow();
  });
});

describe("usePluginRemoteUi", () => {
  it("reports a refused declaration", () => {
    const onViolation = vi.fn();
    const { result } = renderHook(() => usePluginRemoteUi(onViolation));
    act(() => {
      result.current?.connection.mutate(INSERTS);
    });
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation.mock.calls[0][0].code).toBe("unknown-element");
  });

  it("disposes the receiver on unmount", () => {
    const { result, unmount } = renderHook(() => usePluginRemoteUi(() => {}));
    const ui = result.current;
    expect(ui).not.toBeNull();
    unmount();
    expect(ui?.disposed).toBe(true);
  });
});
