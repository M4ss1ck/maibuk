/**
 * The Maibuk Plugin SDK's Worker-side Remote UI entry (ADR 0021, #438): it
 * answers the host's `ui.mount` and `ui.unmount` requests by rendering one of
 * the Plugin's pages, or one Settings row body, into a Remote DOM root.
 * Mutations of that root travel over the mount's transferred MessagePort,
 * batched to at most one flush per 16 ms window.
 *
 * This file is imported ONLY by a Plugin's Worker bundle. The host never imports
 * it (`src/features/plugins/` does not), and `src/plugin-sdk/index.ts` and
 * `src/plugin-sdk/ui.tsx` never re-export it. Its first imports install the
 * Remote DOM polyfill, which replaces the DOM globals with Remote DOM's own
 * polyfill; loading it in host code would clobber the real DOM, so keep it out.
 *
 * Everything else lives in the polyfill-free `ui-serve.tsx` and is re-exported
 * here so a Worker keeps one import. The Worker differs there in exactly one
 * way: how the page attaches. A real DOM (the host's tests) needs a
 * `MutationObserver` to turn DOM mutations into Remote DOM records; a Worker has
 * no DOM, so the polyfill's hooks report every insert and removal as it happens,
 * and the `remote-root` element drives the connection directly.
 */

import "@remote-dom/core/polyfill";
import "@remote-dom/react/polyfill";
import {
  enableRemoteElementCount,
  setRemoteElementLimitHandler,
} from "@/plugin-sdk/ui-node-budget";
import { PLUGIN_UI_NODE_LIMIT_MARKER } from "@/plugin-sdk/ui-node-limit";
import { PLUGIN_ERROR_MESSAGE } from "@/plugin-sdk/protocol";

// Only a Plugin Worker counts its live elements; the host never imports this file.
enableRemoteElementCount();
// At the limit the Worker reports the marker through its own scope, the channel
// every Plugin error uses; the frame relays it and the lifecycle maps the marker
// to remote-ui-limit.
setRemoteElementLimitHandler(() => {
  (self as unknown as { postMessage(data: unknown): void }).postMessage({
    kind: PLUGIN_ERROR_MESSAGE.kind,
    message: PLUGIN_UI_NODE_LIMIT_MARKER,
  });
});

export * from "@/plugin-sdk/ui-serve";

import { RemoteRootElement } from "@remote-dom/core/elements";
import type { RemoteConnection } from "@remote-dom/core";
import {
  servePluginUi as serveUi,
  type PluginUiAttach,
  type ServePluginUiOptions,
} from "@/plugin-sdk/ui-serve";
import type { PluginClient } from "@/plugin-sdk/index";

/**
 * The Worker's attachment: a `remote-root` custom element, defined lazily the
 * first time a page mounts. Its polyfill hooks drive `connection` directly, so
 * there is nothing to detach.
 */
function remoteRoot(): PluginUiAttach {
  return (connection: RemoteConnection) => {
    if (customElements.get("remote-root") === undefined) {
      customElements.define("remote-root", RemoteRootElement);
    }
    const root = document.createElement("remote-root") as RemoteRootElement;
    root.connect(connection);
    return { container: root, detach: () => {} };
  };
}

/**
 * The Worker's `servePluginUi`: the polyfill-free implementation with the
 * Worker's `remote-root` attachment. It shadows the re-export above so a Worker
 * that imports this module gets the polyfill path even though the shared code
 * lives in `ui-serve.tsx`.
 */
export function servePluginUi(
  client: Pick<PluginClient, "onHostRequest">,
  options: Omit<ServePluginUiOptions, "attach">
): void {
  serveUi(client, { ...options, attach: remoteRoot() });
}
