/**
 * The Worker entry `manifest.json` names. The sandbox prelude imports this
 * module in a Worker and replays the host's init message with the Plugin's
 * MessagePort; the module creates the SDK client, starts `./plugin`, and
 * signals ready.
 *
 * Only this file imports the Remote DOM polyfill (`@maibuk/plugin-sdk/worker-ui`),
 * so a test never imports it; tests drive `./plugin` instead.
 */

// The polyfill stays first among the SDK imports: `@maibuk/plugin-sdk` touches
// HTMLElement when it is evaluated, and a Worker has no DOM until it runs.
import { servePluginUi } from "@maibuk/plugin-sdk/worker-ui";
import { createPluginClient, PLUGIN_READY_MESSAGE } from "@maibuk/plugin-sdk";
import { start } from "./plugin";

/** The Worker global surface this entry uses, without the DOM's Window types. */
interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (port === undefined) return;
  start(createPluginClient(port), servePluginUi);
  scope.postMessage({ kind: PLUGIN_READY_MESSAGE.kind });
});
