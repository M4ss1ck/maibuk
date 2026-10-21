/**
 * The MCP Server Worker entry (Built-in Plugin). The sandbox hands this module
 * the init message with the Plugin's MessagePort; the module creates the SDK
 * client, starts the MCP server on the Plugin Endpoint and serves the MCP
 * Server page from the same Worker, then signals ready.
 *
 * This file is the only one that imports the Worker's Remote DOM polyfill
 * (`@/plugin-sdk/worker-ui`), so it is never imported by a test; the tests
 * drive `./plugin` over the polyfill-free `@/plugin-sdk/ui-serve` entry.
 */

// The Worker entry installs the Remote DOM polyfill, so it stays first among
// the SDK imports: `@/plugin-sdk` touches HTMLElement when it is evaluated.
import { servePluginUi } from "@/plugin-sdk/worker-ui";
// Then the sandbox's Web Crypto gap, before any SDK module can reach it: the
// MCP transport calls `crypto.randomUUID`, which the opaque-origin Worker lacks.
import { installRandomUuid } from "./crypto-shim";
import { PLUGIN_READY_MESSAGE, createPluginClient } from "@/plugin-sdk";
import { startMcp } from "./plugin";

installRandomUuid();

/** The Worker global surface this plugin uses, without the DOM's Window types. */
interface McpWorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown): void;
}

const worker = self as unknown as McpWorkerScope;

worker.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (port === undefined) return;
  startMcp(createPluginClient(port), servePluginUi);
  worker.postMessage({ kind: PLUGIN_READY_MESSAGE.kind });
});
