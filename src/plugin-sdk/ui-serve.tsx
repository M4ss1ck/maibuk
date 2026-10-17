/**
 * The Maibuk Plugin SDK's polyfill-free Remote UI entry (ADR 0021, #438): it
 * answers the host's `ui.mount` and `ui.unmount` requests by rendering one of
 * the Plugin's pages, or one Settings row body, into a container a Remote
 * connection observes, carrying that container's mutations over the mount's
 * transferred MessagePort, batched to at most one flush per 16 ms window.
 *
 * This is the entry a host-side test imports (jsdom and the web lane), because
 * it loads no Remote DOM polyfill: it leaves the real DOM and its own
 * `MutationObserver` alone, and attaches through a plain element watched by
 * `RemoteMutationObserver` — the native observer a browser (and jsdom) provides.
 * A real Worker has no such observer, so it imports `worker-ui.tsx` instead,
 * which installs the polyfill and attaches through a `remote-root` whose
 * polyfill hooks drive the connection directly. See `worker-ui.tsx` for why the
 * two paths exist.
 */

import { BatchingRemoteConnection, RemoteMutationObserver } from "@remote-dom/core/elements";
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
import { createRemovalWatch, resetRemoteElementCount } from "@/plugin-sdk/ui-node-budget";
import { PLUGIN_UI_LIMITS } from "@/plugin-sdk/ui-table";

/**
 * Cuts one flush into in-order batches of at most `max` records, the most the
 * host accepts in one batch. Each insert already carries its props (ADR 0027),
 * so a cut anywhere leaves every batch valid on its own. A flush within the
 * limit goes out as it is.
 */
export function splitMutationRecords(
  records: readonly RemoteMutationRecord[],
  max: number
): RemoteMutationRecord[][] {
  if (records.length <= max) return [records as RemoteMutationRecord[]];
  const batches: RemoteMutationRecord[][] = [];
  for (let start = 0; start < records.length; start += max) {
    batches.push(records.slice(start, start + max));
  }
  return batches;
}

/** Defines the UI kit's custom elements if they are not defined yet (idempotent). */
function ensureRemoteElements(): void {
  installPluginUiElements();
}

/** The UI kit's pages: a Plugin-local page id to the component that renders it. */
export type PluginUiPages = Record<string, ComponentType>;

/**
 * Attaches a Remote `connection` to a DOM container the Plugin's page renders
 * into, returning that container and how to detach it again. The unit that
 * differs between the Worker (a polyfilled `remote-root`) and the host's real
 * DOM (a `div` watched by a `MutationObserver`).
 */
export type PluginUiAttach = (connection: RemoteConnection) => {
  container: Element;
  detach(): void;
};

/**
 * The default attachment, for a real DOM: a plain `div` watched by a
 * `RemoteMutationObserver`, which turns the DOM's own mutation records into
 * Remote DOM's. `detach` disconnects the observer.
 */
export function observeContainer(): PluginUiAttach {
  return (connection) => {
    const container = document.createElement("div");
    const observer = new RemoteMutationObserver(connection);
    observer.observe(container);
    return {
      container,
      detach() {
        observer.disconnect();
      },
    };
  };
}

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
  detach(): void;
  /**
   * Marks the mount closed so a late batch (a `frameBatch` timer that fires
   * after teardown) never touches the closed thread.
   */
  close(): void;
}

export interface ServePluginUiOptions {
  pages: PluginUiPages;
  /** The Settings row bodies, keyed by each row's Plugin-local id. */
  settingsRows?: PluginUiPages;
  onHostRequest?: HostRequestHandler;
  /** How the page's tree attaches to a connection; defaults to `observeContainer()`. */
  attach?: PluginUiAttach;
}

/**
 * Yields one task, so a `MutationObserver`'s queued records reach its callback.
 * A DOM mutation is delivered after the task that made it, never synchronously,
 * so a flush that must carry the removal records has to wait for the queue.
 */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Answers the host's Remote UI requests for one Plugin. `ui.mount` renders the
 * named page, or the named Settings row body, into a container `options.attach`
 * produces (a plain observed `div` by default); `ui.unmount` tears the mount
 * down. Every other method is forwarded to `options.onHostRequest`, and throws
 * the same "No handler" error the client uses when no handler is given.
 */
export function servePluginUi(
  client: Pick<PluginClient, "onHostRequest">,
  options: ServePluginUiOptions
): void {
  const attach = options.attach ?? observeContainer();
  const mounted = new Map<string, MountedSurface>();

  /**
   * Releases the live element count as this mount's removals are made, so a
   * Plugin that churns under the limit never trips it (#516, decision 2a). The
   * count itself runs in the UI kit's element constructor.
   */
  function watchRemovals(connection: BatchingRemoteConnection): void {
    const watch = createRemovalWatch();
    const queue = connection.mutate.bind(connection);
    connection.mutate = (records) => {
      watch.observe(records);
      queue(records);
    };
  }

  function mount({ surface, kind, page, port }: PluginUiMountParams): null {
    if (mounted.has(surface)) {
      throw new Error(`Surface ${surface} is already mounted`);
    }
    const settingsRow = kind === "settingsRow";
    const registry = settingsRow ? options.settingsRows : options.pages;
    const Page = registry?.[page];
    if (Page === undefined) {
      throw new Error(settingsRow ? `Unknown Settings row ${page}` : `Unknown page ${page}`);
    }

    // The kit elements only exist once defined; a Worker's polyfill provides the
    // registry, so define them here, on first mount, not at module load.
    ensureRemoteElements();

    // @quilted/threads listens through `addEventListener`, which a MessagePort
    // only dispatches after `start()`.
    port.start();

    const thread = new ThreadMessagePort<HostConnectionImports>(port);
    // A batch the `frameBatch` timer schedules just before teardown can fire
    // after the thread and port are closed; the flag makes `mutate`/`call` a
    // no-op then instead of touching the closed thread.
    const state = { closed: false };
    const hostConnection: RemoteConnection = {
      // The host refuses a batch over maxRecordsPerBatch whole and stops the
      // Plugin, so a large flush goes out in in-order batches under it.
      mutate: (records) => {
        for (const batch of splitMutationRecords(records, PLUGIN_UI_LIMITS.maxRecordsPerBatch)) {
          if (state.closed) return;
          void thread.imports.mutate(batch).catch(() => {});
        }
      },
      call: (id, method, ...args) => {
        if (state.closed) {
          return Promise.reject(new Error(`The Remote UI mount ${surface} is closed`));
        }
        return thread.imports.call(id, method, ...args);
      },
    };

    const connection = new BatchingRemoteConnection(hostConnection, { batch: frameBatch() });
    watchRemovals(connection);
    const { container, detach } = attach(connection);
    const reactRoot = createRoot(container);
    reactRoot.render(<Page />);

    mounted.set(surface, {
      reactRoot,
      connection,
      thread,
      port,
      detach,
      close() {
        state.closed = true;
      },
    });
    return null;
  }

  /**
   * Tears one mount down. Unmounting React removes the tree's DOM nodes, but a
   * `MutationObserver` reports that removal asynchronously; the flush must wait
   * for the removal records to reach the connection, or the host would never see
   * the tree leave. A Worker's polyfill hooks report synchronously, so the wait
   * is a no-op there (see `worker-ui.tsx`).
   */
  async function teardown(entry: MountedSurface): Promise<null> {
    entry.reactRoot.unmount();
    await nextTask();
    // The unmount's own removal mutations are now queued; flush them before
    // closing the port, or the host would never see the tree leave.
    entry.connection.flush();
    entry.detach();
    // Close before the thread/port: a batch timer that fires from here on sees
    // the flag and does not touch the closed thread.
    entry.close();
    entry.thread.close();
    entry.port.close();
    return null;
  }

  // A surface that is not mounted stays synchronous (`null`), so a repeated
  // unmount is the same no-op the client's callers already expect.
  function unmount({ surface }: PluginUiUnmountParams): null | Promise<null> {
    const entry = mounted.get(surface);
    if (entry === undefined) return null;
    mounted.delete(surface);
    // The last mount gone resets the Plugin's live element count (#516).
    if (mounted.size === 0) resetRemoteElementCount();
    return teardown(entry);
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
