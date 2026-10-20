/**
 * The MCP Server Worker entry (Built-in Plugin). The sandbox hands this
 * module the init message with the Plugin's MessagePort; the module creates
 * the SDK client, starts the MCP server on the Plugin Endpoint, and signals
 * ready. No UI is served: an Agent reaches this Plugin only through HTTP.
 */

import { PLUGIN_READY_MESSAGE, createPluginClient } from "@/plugin-sdk";
import { startMcp } from "./plugin";

/** The Worker global surface this plugin uses, without the DOM's Window types. */
interface McpWorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown): void;
}

const worker = self as unknown as McpWorkerScope;

worker.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (port === undefined) return;
  startMcp(createPluginClient(port));
  worker.postMessage({ kind: PLUGIN_READY_MESSAGE.kind });
});
