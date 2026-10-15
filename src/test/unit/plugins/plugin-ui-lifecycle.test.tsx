import { act, renderHook } from "@testing-library/react";
import type { RemoteMutationRecord } from "@remote-dom/core";
import { describe, expect, it, vi } from "vitest";
import { stopRemoteUi } from "@/features/plugins/remote-ui/boundary";
import { usePluginRemoteUi } from "@/features/plugins/remote-ui/use-plugin-remote-ui";
import type { PluginLifecycle, PluginRuntime } from "@/features/plugins/types";

const INSERTS = [
  [0, "~", { id: "1", type: 1, element: "maibuk-evil", children: [] }, 0],
] as unknown as RemoteMutationRecord[];

/**
 * A runtime whose broker never answers a mount: the hook under test only needs
 * a broker to open the mount over, and every reply is irrelevant here.
 */
function fakeRuntime(): Pick<PluginRuntime, "broker"> {
  return {
    broker: {
      request: () => new Promise<unknown>(() => {}),
      emit: () => false,
      stop: () => {},
      stopped: false,
    },
  };
}

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
    const runtime = fakeRuntime();
    const { result } = renderHook(() => usePluginRemoteUi(runtime, "page.one", onViolation));
    act(() => {
      result.current.ui?.connection.mutate(INSERTS);
    });
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation.mock.calls[0][0].code).toBe("unknown-element");
  });

  it("reports mounted only once the Plugin accepts the mount", async () => {
    let accept = (_value: unknown) => {};
    const runtime: Pick<PluginRuntime, "broker"> = {
      broker: {
        ...fakeRuntime().broker,
        request: () =>
          new Promise<unknown>((resolve) => {
            accept = resolve;
          }),
      },
    };
    const { result } = renderHook(() => usePluginRemoteUi(runtime, "page.one", () => {}));
    expect(result.current.mounted).toBe(false);
    await act(async () => {
      accept(null);
    });
    expect(result.current.mounted).toBe(true);
    expect(result.current.failed).toBe(false);
  });

  it("disposes the receiver on unmount", () => {
    const runtime = fakeRuntime();
    const { result, unmount } = renderHook(() =>
      usePluginRemoteUi(runtime, "page.one", () => {})
    );
    const ui = result.current.ui;
    expect(ui).not.toBeNull();
    unmount();
    expect(ui?.disposed).toBe(true);
  });
});
