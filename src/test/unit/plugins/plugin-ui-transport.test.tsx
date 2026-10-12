/**
 * The host Plugin page's Remote UI transport, in process (#438): a real broker
 * and SDK client stand in for the host↔Worker channel, and a
 * `@quilted/threads` thread stands in for the Worker's side of a mount. The
 * Plugin side here never imports `worker-ui` (which installs the Remote DOM
 * polyfill and must not load in jsdom); it answers `ui.mount` by creating a
 * thread over the transferred port and importing the host's `mutate`.
 */
import { act, render, screen } from "@testing-library/react";
import type { RemoteMutationRecord } from "@remote-dom/core";
import { ThreadMessagePort } from "@quilted/threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { createPluginBroker } from "@/features/plugins/broker";

/**
 * The host-side `PluginRemoteUi` instances the boundary created, so a test can
 * observe that the mount was disposed. The wrapper keeps the real receiver.
 */
const created = vi.hoisted(() => ({ uis: [] as { disposed: boolean }[] }));
vi.mock("@/features/plugins/remote-ui/receiver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/plugins/remote-ui/receiver")>();
  return {
    ...actual,
    createPluginRemoteUi: (options: Parameters<typeof actual.createPluginRemoteUi>[0]) => {
      const ui = actual.createPluginRemoteUi(options);
      created.uis.push(ui);
      return ui;
    },
  };
});

import {
  resetPluginLifecycleForTests,
  setPluginLifecycleInstance,
} from "@/features/plugins/lifecycle-instance";
import { PluginRemoteUiBoundary } from "@/features/plugins/remote-ui/boundary";
import type {
  PluginBroker,
  PluginLifecycle,
  PluginLifecycleChange,
  PluginLifecycleState,
  PluginRuntime,
} from "@/features/plugins/types";
import { createPluginClient } from "@/plugin-sdk";
import {
  PLUGIN_UI_MOUNT_REQUEST,
  PLUGIN_UI_UNMOUNT_REQUEST,
  type PluginUiMountParams,
  type PluginUiUnmountParams,
} from "@/plugin-sdk/protocol";

/** The host methods the Plugin side imports over the mount's thread. */
interface HostUiImports {
  mutate(records: readonly RemoteMutationRecord[]): Promise<void>;
  call(id: string, method: string, ...args: readonly unknown[]): Promise<unknown>;
}

const channels: MessageChannel[] = [];
const threads: { close(): void }[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
  for (const thread of threads.splice(0)) thread.close();
  created.uis.length = 0;
  resetPluginLifecycleForTests();
  vi.restoreAllMocks();
});

/** One `maibuk-heading` holding one text child, as an insert-child batch. */
function heading(text: string): RemoteMutationRecord[] {
  return [
    [
      0,
      "~",
      {
        id: "1",
        type: 1,
        element: "maibuk-heading",
        properties: {},
        children: [{ id: "2", type: 3, data: text }],
      },
      0,
    ],
  ] as unknown as RemoteMutationRecord[];
}

/** An element the validator refuses, as an insert-child batch. */
function evil(): RemoteMutationRecord[] {
  return [
    [0, "~", { id: "1", type: 1, element: "maibuk-evil", children: [] }, 0],
  ] as unknown as RemoteMutationRecord[];
}

function runtimeOf(broker: PluginBroker): PluginRuntime {
  return { broker } as unknown as PluginRuntime;
}

/**
 * A host↔Worker pair over one real `MessageChannel`. `plugin` plays the Worker:
 * it receives the mount's transferred port and answers by sending mutations.
 * `unmounts` records the host's `ui.unmount` requests.
 */
function createRun(plugin: (mount: PluginUiMountParams) => void) {
  const channel = new MessageChannel();
  channels.push(channel);
  const broker = createPluginBroker({
    pluginId: "sample",
    port: channel.port1,
    declared: [],
    granted: () => [],
  });
  const client = createPluginClient(channel.port2);
  const mounts: PluginUiMountParams[] = [];
  const unmounts: PluginUiUnmountParams[] = [];
  client.onHostRequest(async (method, params) => {
    if (method === PLUGIN_UI_MOUNT_REQUEST) {
      const mount = params as PluginUiMountParams;
      mounts.push(mount);
      mount.port.start();
      plugin(mount);
      return null;
    }
    if (method === PLUGIN_UI_UNMOUNT_REQUEST) {
      unmounts.push(params as PluginUiUnmountParams);
      return null;
    }
    return null;
  });
  return { broker, mounts, unmounts };
}

/** The Worker side of a normal mount: send these mutations to the host. */
function sends(records: () => RemoteMutationRecord[]) {
  return (mount: PluginUiMountParams) => {
    const thread = new ThreadMessagePort<HostUiImports>(mount.port);
    threads.push(thread);
    void thread.imports.mutate(records()).catch(() => {});
  };
}

/** One tiny insert-child batch under a fresh id. */
function tinyInsert(index: number): RemoteMutationRecord[] {
  return [
    [0, "~", { id: `n${index}`, type: 1, element: "maibuk-text", children: [] }, 0],
  ] as unknown as RemoteMutationRecord[];
}

/** The Worker side of a flooding mount: send `count` tiny batches at once. */
function floods(count: number) {
  return (mount: PluginUiMountParams) => {
    const thread = new ThreadMessagePort<HostUiImports>(mount.port);
    threads.push(thread);
    for (let i = 0; i < count; i++) {
      // A reply still in flight when the mount tears down rejects; the test
      // only asserts the host's reaction, so ignore the transport's own errors.
      void thread.imports.mutate(tinyInsert(i)).catch(() => {});
    }
  };
}

interface FakeLifecycle {
  runtime(): PluginRuntime | null;
  state(): PluginLifecycleState | null;
  subscribe(listener: (change: PluginLifecycleChange) => void): () => void;
  stop: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  setRuntime(runtime: PluginRuntime | null, status: PluginLifecycleState["status"]): void;
}

function fakeLifecycle(initial: {
  runtime: PluginRuntime | null;
  status: PluginLifecycleState["status"] | null;
}): FakeLifecycle {
  let current = initial;
  const listeners = new Set<(change: PluginLifecycleChange) => void>();
  const stop = vi.fn();
  const dispose = vi.fn();
  const lifecycle: FakeLifecycle = {
    runtime: () => current.runtime,
    state: () => {
      switch (current.status) {
        case null:
          return null;
        case "stopped":
          return { status: "stopped", reason: null, refusal: null };
        case "starting":
          return { status: "starting", startReason: "launch" };
        case "ready":
          return { status: "ready", startReason: "launch" };
        case "unavailable":
          return { status: "unavailable", startReason: "launch", heartbeatMisses: 3 };
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stop,
    dispose,
    setRuntime(runtime, status) {
      current = { runtime, status };
      const state = lifecycle.state();
      if (state === null) return;
      for (const listener of [...listeners]) {
        listener({ pluginId: "sample", name: "Sample", state });
      }
    },
  };
  return lifecycle;
}

function install(lifecycle: FakeLifecycle): void {
  setPluginLifecycleInstance(lifecycle as unknown as PluginLifecycle);
}

function renderBoundary(): ReturnType<typeof render> {
  return render(<PluginRemoteUiBoundary pluginId="sample" pageId="report" />);
}

describe("the Plugin page's Remote UI transport", () => {
  it("renders the tree the Plugin sends over the mount", async () => {
    const run = createRun(sends(() => heading("Hello")));
    install(fakeLifecycle({ runtime: runtimeOf(run.broker), status: "ready" }));

    renderBoundary();
    expect(await screen.findByRole("heading", { name: "Hello" })).toBeInTheDocument();
  });

  it("shows the could-not-display text when the mount is refused and does not stop the Plugin", async () => {
    const run = createRun(() => {
      throw new Error("no servePluginUi");
    });
    const lifecycle = fakeLifecycle({ runtime: runtimeOf(run.broker), status: "ready" });
    install(lifecycle);

    renderBoundary();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be displayed|no se pudo mostrar/i
    );
    expect(lifecycle.stop).not.toHaveBeenCalled();
  });

  it("stops the Plugin with remote-ui-limit on an unsupported element", async () => {
    const run = createRun(sends(() => evil()));
    const lifecycle = fakeLifecycle({ runtime: runtimeOf(run.broker), status: "ready" });
    install(lifecycle);

    renderBoundary();
    await vi.waitFor(() =>
      expect(lifecycle.stop).toHaveBeenCalledWith("sample", "remote-ui-limit")
    );
  });

  it("restarts on a fresh runtime: the old mount unmounts and the new one mounts", async () => {
    const first = createRun(sends(() => heading("First")));
    const lifecycle = fakeLifecycle({ runtime: runtimeOf(first.broker), status: "ready" });
    install(lifecycle);
    renderBoundary();
    expect(await screen.findByRole("heading", { name: "First" })).toBeInTheDocument();
    const firstSurface = first.mounts[0].surface;

    const second = createRun(sends(() => heading("Second")));
    act(() => {
      lifecycle.setRuntime(runtimeOf(second.broker), "ready");
    });

    await vi.waitFor(() => expect(first.unmounts).toHaveLength(1));
    expect(first.unmounts[0].surface).toBe(firstSurface);
    await vi.waitFor(() => expect(second.mounts).toHaveLength(1));
    expect(second.mounts[0].surface).not.toBe(firstSurface);
    expect(await screen.findByRole("heading", { name: "Second" })).toBeInTheDocument();
  });

  it("renders nothing and sends no mount while the Plugin is starting", async () => {
    const run = createRun(sends(() => heading("Never")));
    install(fakeLifecycle({ runtime: runtimeOf(run.broker), status: "starting" }));

    renderBoundary();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(run.mounts).toHaveLength(0);
  });

  it("sends ui.unmount once when the page unmounts", async () => {
    const run = createRun(sends(() => heading("Bye")));
    install(fakeLifecycle({ runtime: runtimeOf(run.broker), status: "ready" }));

    const { unmount } = renderBoundary();
    await screen.findByRole("heading", { name: "Bye" });
    unmount();
    await vi.waitFor(() => expect(run.unmounts).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(run.unmounts).toHaveLength(1);
  });

  it("tears the mount down without ui.unmount once the Plugin stops", async () => {
    const run = createRun(sends(() => heading("Gone")));
    const lifecycle = fakeLifecycle({ runtime: runtimeOf(run.broker), status: "ready" });
    install(lifecycle);
    renderBoundary();
    await screen.findByRole("heading", { name: "Gone" });
    const ui = created.uis.at(-1);

    // The Plugin stops: its runtime is gone and the broker no longer answers.
    act(() => {
      run.broker.stop("requested");
      lifecycle.setRuntime(null, "stopped");
    });

    // The boundary tears the mount down (the receiver is disposed) and asks the
    // stopped Plugin nothing: no ui.unmount crosses the dead channel.
    await vi.waitFor(() => expect(ui?.disposed).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(run.unmounts).toHaveLength(0);
  });

  it("stops the Plugin with remote-ui-limit when the mount floods the host", async () => {
    const run = createRun(floods(121));
    const lifecycle = fakeLifecycle({ runtime: runtimeOf(run.broker), status: "ready" });
    install(lifecycle);

    renderBoundary();
    await vi.waitFor(() =>
      expect(lifecycle.stop).toHaveBeenCalledWith("sample", "remote-ui-limit")
    );
  });
});
