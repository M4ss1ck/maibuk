/**
 * The Maibuk Plugin SDK's Worker-side Remote UI entry (ADR 0021, #438): it
 * answers the host's `ui.mount` and `ui.unmount` requests by rendering one of
 * the Plugin's pages into a Remote DOM root. Mutations of that root travel over
 * the mount's transferred MessagePort, batched to at most one flush per frame.
 *
 * This file is imported ONLY by a Plugin's Worker bundle. The host never imports
 * it (`src/features/plugins/` does not), and `src/plugin-sdk/index.ts` and
 * `src/plugin-sdk/ui.tsx` never re-export it. Its first imports install the
 * Remote DOM polyfill, which replaces the DOM globals with Remote DOM's
 * polyfill; loading it in host code would clobber the real DOM, so keep it out.
 */

import "@remote-dom/core/polyfill";
import "@remote-dom/react/polyfill";

import { BatchingRemoteConnection, RemoteRootElement } from "@remote-dom/core/elements";
import type { RemoteConnection, RemoteMutationRecord } from "@remote-dom/core";
import { ThreadMessagePort } from "@quilted/threads";
import type { ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { HostRequestHandler, PluginClient } from "@/plugin-sdk/index";
import {
  PLUGIN_UI_MOUNT_REQUEST,
  PLUGIN_UI_UNMOUNT_REQUEST,
  type PluginUiMountParams,
  type PluginUiUnmountParams,
} from "@/plugin-sdk/protocol";
import { installPluginUiElements } from "@/plugin-sdk/ui";

installPluginUiElements();

if (customElements.get("remote-root") === undefined) {
  customElements.define("remote-root", RemoteRootElement);
}

/** The UI kit's pages: a Plugin-local page id to the component that renders it. */
export type PluginUiPages = Record<string, ComponentType>;

/**
 * The Remote UI budget's flush window, in milliseconds. The host stops a Plugin
 * that exceeds `PLUGIN_UI_LIMITS.maxBatchesPerSecond` (120) batches in a second;
 * flushing on a 16 ms frame keeps a Plugin near 60, comfortably under it.
 */
export const PLUGIN_UI_BATCH_MS = 16;

/**
 * The `BatchingRemoteConnection` batch function: it coalesces every mutation
 * queued since the previous flush into at most one flush per `PLUGIN_UI_BATCH_MS`
 * window. The first flush runs on a microtask; a burst inside the window is
 * deferred to exactly the window's boundary.
 */
export function frameBatch(): (flush: () => void) => void {
  let last = -Infinity;
  return (flush) => {
    const wait = last + PLUGIN_UI_BATCH_MS - performance.now();
    const run = () => {
      last = performance.now();
      flush();
    };
    if (wait <= 0) queueMicrotask(run);
    else setTimeout(run, wait);
  };
}

/**
 * The methods the Worker imports from the host: the host exports `mutate` and
 * `call`, and both return a promise because they cross the thread boundary.
 */
interface HostConnectionImports {
  mutate(records: readonly RemoteMutationRecord[]): Promise<void>;
  call(id: string, method: string, ...args: readonly unknown[]): Promise<unknown>;
}

/** One live mount, keyed by its host-chosen surface id. */
interface MountedSurface {
  reactRoot: Root;
  connection: BatchingRemoteConnection;
  thread: ThreadMessagePort<HostConnectionImports>;
  port: MessagePort;
}

/**
 * Answers the host's Remote UI requests for one Plugin. `ui.mount` renders the
 * named page over the transferred port; `ui.unmount` tears the mount down.
 * Every other method is forwarded to `options.onHostRequest`, and throws the
 * same "No handler" error the client uses when no handler is given.
 */
export function servePluginUi(
  client: Pick<PluginClient, "onHostRequest">,
  options: { pages: PluginUiPages; onHostRequest?: HostRequestHandler }
): void {
  const mounted = new Map<string, MountedSurface>();

  function mount({ surface, page, port }: PluginUiMountParams): null {
    if (mounted.has(surface)) {
      throw new Error(`Surface ${surface} is already mounted`);
    }
    const Page = options.pages[page];
    if (Page === undefined) throw new Error(`Unknown page ${page}`);

    // @quilted/threads listens through `addEventListener`, which a MessagePort
    // only dispatches after `start()`.
    port.start();

    const thread = new ThreadMessagePort<HostConnectionImports>(port);
    const hostConnection: RemoteConnection = {
      mutate: (records) => void thread.imports.mutate(records).catch(() => {}),
      call: (id, method, ...args) => thread.imports.call(id, method, ...args),
    };

    const connection = new BatchingRemoteConnection(hostConnection, { batch: frameBatch() });
    const root = document.createElement("remote-root") as RemoteRootElement;
    root.connect(connection);
    const reactRoot = createRoot(root);
    reactRoot.render(<Page />);

    mounted.set(surface, { reactRoot, connection, thread, port });
    return null;
  }

  function unmount({ surface }: PluginUiUnmountParams): null {
    const entry = mounted.get(surface);
    if (entry === undefined) return null;
    mounted.delete(surface);

    entry.reactRoot.unmount();
    // The unmount's own removal mutations are still queued; flush them before
    // closing the port, or the host would never see the tree leave.
    entry.connection.flush();
    entry.thread.close();
    entry.port.close();
    return null;
  }

  client.onHostRequest((method, params) => {
    switch (method) {
      case PLUGIN_UI_MOUNT_REQUEST:
        return mount(params as PluginUiMountParams);
      case PLUGIN_UI_UNMOUNT_REQUEST:
        return unmount(params as PluginUiUnmountParams);
      default:
        if (options.onHostRequest === undefined) throw new Error(`No handler for ${method}`);
        return options.onHostRequest(method, params);
    }
  });
}
