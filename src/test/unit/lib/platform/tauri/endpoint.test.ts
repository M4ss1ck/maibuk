import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EndpointRequestMessage } from "@/lib/platform/types";

type Handler = (args: Record<string, unknown>) => unknown;
const handlers: Record<string, Handler> = {};
class FakeChannel<T> {
  onmessage: (m: T) => void = () => {};
}
vi.mock("@tauri-apps/api/core", () => ({
  Channel: FakeChannel,
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    const h = handlers[cmd];
    if (!h) throw new Error(`no handler ${cmd}`);
    return h(args);
  }),
}));
const { tauriPluginEndpoint } = await import("@/lib/platform/tauri/endpoint");
const { invoke } = await import("@tauri-apps/api/core");

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  vi.mocked(invoke).mockClear();
});

const MESSAGE: EndpointRequestMessage = {
  requestId: "7",
  pluginId: "acme",
  request: { method: "GET", path: "/plugin/acme/mcp", headers: [], body: "" },
};

describe("tauriPluginEndpoint", () => {
  it("syncs the serving ids with one Channel and delivers each request", async () => {
    let channel: FakeChannel<EndpointRequestMessage> | null = null;
    handlers.plugin_endpoint_sync = ({ ids, onRequest }) => {
      channel = onRequest as FakeChannel<EndpointRequestMessage>;
      return { state: "listening", port: 29217, ids };
    };
    const onRequest = vi.fn();

    const state = await tauriPluginEndpoint.sync(["acme"], onRequest);

    expect(state).toEqual({ state: "listening", port: 29217, ids: ["acme"] });
    expect(invoke).toHaveBeenCalledWith("plugin_endpoint_sync", {
      ids: ["acme"],
      onRequest: expect.any(FakeChannel),
    });
    channel!.onmessage(MESSAGE);
    expect(onRequest).toHaveBeenCalledWith(MESSAGE);
  });

  it("answers with the whole body, sending null for none", async () => {
    handlers.plugin_endpoint_respond = () => undefined;

    await tauriPluginEndpoint.respond("7", 200, [["content-type", "text/plain"]], undefined, false);

    expect(invoke).toHaveBeenCalledWith("plugin_endpoint_respond", {
      requestId: "7",
      status: 200,
      headers: [["content-type", "text/plain"]],
      body: null,
      streaming: false,
    });
  });

  it("passes a streamed head and its chunks through", async () => {
    handlers.plugin_endpoint_respond = () => undefined;
    handlers.plugin_endpoint_chunk = () => true;

    await tauriPluginEndpoint.respond("7", 200, [], undefined, true);
    const open = await tauriPluginEndpoint.chunk("7", "aGk=");

    expect(invoke).toHaveBeenCalledWith("plugin_endpoint_respond", {
      requestId: "7",
      status: 200,
      headers: [],
      body: null,
      streaming: true,
    });
    expect(open).toBe(true);
    expect(invoke).toHaveBeenCalledWith("plugin_endpoint_chunk", { requestId: "7", chunk: "aGk=" });
  });

  it("reports a hang-up from chunk and ends the answer", async () => {
    handlers.plugin_endpoint_chunk = () => false;
    handlers.plugin_endpoint_end = () => undefined;

    expect(await tauriPluginEndpoint.chunk("7", "aGk=")).toBe(false);
    await tauriPluginEndpoint.end("7");

    expect(invoke).toHaveBeenCalledWith("plugin_endpoint_end", { requestId: "7" });
  });
});
