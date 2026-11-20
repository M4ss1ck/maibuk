/**
 * The Clock Worker entry (Built-in Plugin). The sandbox hands this module the
 * init message with the Plugin's MessagePort; the module creates the SDK
 * client, wires the runtime, and signals ready.
 *
 * This file is the only one that imports the Worker's Remote DOM polyfill
 * (`@/plugin-sdk/worker-ui`), so it is never imported by a test; the tests
 * drive `./runtime` over the polyfill-free `@/plugin-sdk/ui-serve` entry.
 */

// The Worker entry installs the Remote DOM polyfill, so it stays first among
// the SDK imports: `@/plugin-sdk` touches HTMLElement when it is evaluated.
import { servePluginUi } from "@/plugin-sdk/worker-ui";
import { PLUGIN_READY_MESSAGE, createPluginClient } from "@/plugin-sdk";
import { startClock } from "./runtime";

/** The Worker global surface this plugin uses, without the DOM's Window types. */
interface ClockWorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown): void;
}

const worker = self as unknown as ClockWorkerScope;

worker.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (port === undefined) return;
  void startClock(createPluginClient(port), servePluginUi);
  worker.postMessage({ kind: PLUGIN_READY_MESSAGE.kind });
});
