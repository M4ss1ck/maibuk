import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  EndpointAdapter,
  EndpointListenerState,
  EndpointRequestMessage,
} from "@/lib/platform/types";

/**
 * The Plugin Endpoint on desktop: the Rust listener binds `127.0.0.1` and
 * pushes every inbound request over one `Channel`, keyed by the request id Rust
 * minted. Answers go back through the matching commands, so no request bytes
 * are parsed here.
 */
export const tauriPluginEndpoint: EndpointAdapter = {
  async sync(ids, onRequest) {
    const channel = new Channel<EndpointRequestMessage>();
    channel.onmessage = (message) => onRequest(message);
    return invoke<EndpointListenerState>("plugin_endpoint_sync", { ids, onRequest: channel });
  },
  async respond(requestId, status, headers, body, streaming) {
    await invoke("plugin_endpoint_respond", {
      requestId,
      status,
      headers,
      body: body ?? null,
      streaming,
    });
  },
  async chunk(requestId, chunk) {
    return invoke<boolean>("plugin_endpoint_chunk", { requestId, chunk });
  },
  async end(requestId) {
    await invoke("plugin_endpoint_end", { requestId });
  },
};
