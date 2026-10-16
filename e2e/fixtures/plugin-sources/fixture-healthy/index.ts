// The conformance lane's healthy neighbour Plugin (#516). The seam starts it
// beside `fixture-hostile` so T8 can prove that a hostile Plugin's memory death
// leaves the renderer AND a well-behaved Plugin beside it healthy: after T8 the
// seam asks this Plugin's `health.check` once more and (unless it answers) T8
// fails. It is deliberately tiny — no pages, no Commands, no Permissions — so
// nothing it does can be confused with the hostile Plugin's escapes. It is built
// from this source like every fixture and never reaches a product bundle.
//
// The Worker entry installs the Remote DOM polyfill, so it stays first among the
// SDK imports, exactly as the other fixture Plugins do.

import { servePluginUi } from "@/plugin-sdk/worker-ui";
import { createPluginClient } from "@/plugin-sdk";

if (
  typeof self !== "undefined" &&
  typeof WorkerGlobalScope !== "undefined" &&
  self instanceof WorkerGlobalScope
) {
  self.onmessage = (event) => {
    const port = event.ports && event.ports[0];
    if (!port) return;
    const client = createPluginClient(port);
    servePluginUi(client, {
      // No pages: this Plugin is never mounted, only asked whether it is alive.
      pages: {},
      onHostRequest: (method) => {
        if (method === "health.check") return "pong";
        throw new Error(`No handler for ${method}`);
      },
    });
    self.postMessage({ kind: "maibuk:plugin-ready" });
  };
}
