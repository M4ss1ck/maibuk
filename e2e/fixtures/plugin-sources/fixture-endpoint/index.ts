// The E2E fixture for the Plugin Endpoint (#586, ADR 0031). The web build has
// no socket, so the @wf spec reaches this Plugin through the E2E lane's
// test-only seam (`src/features/plugins/endpoint-seam.ts`), which calls the real
// `dispatchEndpointRequest` with the app's live lifecycle and approvals; the
// Worker, the broker, and the grant check are the app's own.
//
// It declares `serve` as optional, so one device can grant it (the Plugin
// answers) and another can leave it off (the host answers 404) while the same
// Plugin runs. `/hello` answers a whole body, `/stream` streams three pieces,
// `/address` answers this Plugin's own Endpoint address as JSON, and
// `/received` reports the paths the Plugin was handed, so the spec can prove
// another Plugin's request never reached this handler. Built from this
// source into e2e/.output/plugins/fixture-endpoint by the E2E global setup; the
// bundle is never committed and never shipped.
//
// The Worker entry installs the Remote DOM polyfill, so `servePluginUi` stays
// first among the SDK imports, exactly as the fixture-healthy and
// fixture-everything fixtures do.

import { servePluginUi } from "@/plugin-sdk/worker-ui";
import { createPluginClient, type PluginClient } from "@/plugin-sdk";

/** The pieces `/stream` yields, in order: the spec asserts exactly these. */
const STREAM_CHUNKS = ["one ", "two ", "three "];

/** This Plugin's own prefix, so the paths it answers read plainly below. */
const PREFIX = "/plugin/fixture-endpoint";

/** Every path this Plugin was handed, in order, filled before each answer. */
const received: string[] = [];

/** The headers of every text answer here, so the spec can read the content type. */
const TEXT = { "content-type": "text/plain; charset=utf-8" };

/** The streamed body: an async iterable, which the SDK sends as chunk after chunk. */
async function* streamed(): AsyncGenerator<string> {
  for (const chunk of STREAM_CHUNKS) yield chunk;
}

/**
 * Answers one request on this Plugin's path. The snapshot `/received` reports is
 * taken before its own path is recorded, so the spec reads exactly what arrived
 * earlier: this Plugin's requests, and never another Plugin's.
 */
async function answer(client: PluginClient, request: { method: string; path: string }) {
  const pathname = new URL(request.path, "http://127.0.0.1").pathname;
  const seen = [...received];
  received.push(pathname);
  const path = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : pathname;
  if (path === "/hello") return { status: 200, headers: TEXT, body: "hello" };
  if (path === "/stream") return { status: 200, headers: TEXT, body: streamed() };
  if (path === "/address" && request.method === "GET") {
    const { url } = await client.endpoint.address();
    const headers = { "content-type": "application/json" };
    return { status: 200, headers, body: JSON.stringify({ url }) };
  }
  if (path === "/received") {
    const headers = { "content-type": "application/json" };
    return { status: 200, headers, body: JSON.stringify(seen) };
  }
  return { status: 404, headers: TEXT, body: "not found" };
}

if (
  typeof self !== "undefined" &&
  typeof WorkerGlobalScope !== "undefined" &&
  self instanceof WorkerGlobalScope
) {
  self.onmessage = (event) => {
    const port = event.ports && event.ports[0];
    if (!port) return;
    const client = createPluginClient(port);
    let reported = false;
    servePluginUi(client, {
      // No pages: this Plugin is only ever reached through its Endpoint.
      pages: {},
      onHostRequest: (method) => {
        if (method !== "health.check") throw new Error(`No handler for ${method}`);
        // One report per Worker: the spec waits for it before it dispatches, so
        // a later 404 is a route answer and not a Plugin that had not started.
        if (!reported) {
          reported = true;
          void client.notifications.show({ variant: "info", message: "endpoint fixture running" });
        }
        return "pong";
      },
    });
    client.onEndpointRequest((request) => answer(client, request));
    self.postMessage({ kind: "maibuk:plugin-ready" });
  };
}
