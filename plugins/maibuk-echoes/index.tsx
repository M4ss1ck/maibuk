/**
 * The Echoes Worker entry (Built-in Plugin, ADR 0019/0021). The sandbox hands
 * this module the init message with the Plugin's MessagePort; the module
 * creates the SDK client, wires the runtime, and signals ready.
 *
 * This file is the only one that imports the Worker's Remote DOM polyfill
 * (`@/plugin-sdk/worker-ui`), so it is never imported by a test; the tests
 * drive `./runtime` over the polyfill-free `@/plugin-sdk/ui-serve` entry.
 */

// The Worker entry installs the Remote DOM polyfill, so it stays first among
// the SDK imports: `@/plugin-sdk` touches HTMLElement when it is evaluated.
import { servePluginUi } from "@/plugin-sdk/worker-ui";
import { PLUGIN_READY_MESSAGE, createPluginClient } from "@/plugin-sdk";
import { startEchoes } from "./runtime";

/** The Worker global surface this plugin uses, without the DOM's Window types. */
interface EchoWorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown): void;
}

const worker = self as unknown as EchoWorkerScope;

worker.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (port === undefined) return;
  startEchoes(createPluginClient(port), servePluginUi);
  worker.postMessage({ kind: PLUGIN_READY_MESSAGE.kind });
});
