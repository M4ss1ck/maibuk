// The conformance lane's healthy neighbour Plugin (#516). The seam starts it
// beside `fixture-hostile` so T8 can prove that a hostile Plugin's memory death
// leaves the renderer AND a well-behaved Plugin beside it healthy: after T8 the
// seam asks this Plugin's `health.check` once more and (unless it answers) T8
// fails. It also answers the three Canvas Reference requests through its one
// `items` source (#836), so the lane proves the host requests reach a real
// Plugin. It is deliberately tiny — no pages, no Commands, no Permissions — so
// nothing it does can be confused with the hostile Plugin's escapes. It is built
// from this source like every fixture and never reaches a product bundle.
//
// The Worker entry installs the Remote DOM polyfill, so it stays first among the
// SDK imports, exactly as the other fixture Plugins do.

import { servePluginUi } from "@/plugin-sdk/worker-ui";
import {
  type CanvasReferenceSourceResolution,
  type CanvasReferenceSourceRequests,
  canvasReferenceRequests,
  createPluginClient,
} from "@/plugin-sdk";

/** The one row the `items` source lists, and the only id its `resolve` answers present. */
const ITEM_ROW = { id: "one", title: "One" };

/** The Plugin's Canvas Reference source (#836), declared as `items` in its manifest. */
function itemsSource(): CanvasReferenceSourceRequests {
  return {
    list: () => [ITEM_ROW],

    resolve(ids) {
      const answers: Record<string, CanvasReferenceSourceResolution> = {};
      for (const id of ids) {
        answers[id] =
          id === ITEM_ROW.id ? { status: "present", title: ITEM_ROW.title } : { status: "missing" };
      }
      return answers;
    },

    open: () => "opened",
  };
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
    servePluginUi(client, {
      // No pages: this Plugin is never mounted, only asked its health check and
      // its Canvas Reference requests.
      pages: {},
      onHostRequest: canvasReferenceRequests({ items: itemsSource() }, (method) => {
        if (method === "health.check") return "pong";
        throw new Error(`No handler for ${method}`);
      }),
    });
    self.postMessage({ kind: "maibuk:plugin-ready" });
  };
}
