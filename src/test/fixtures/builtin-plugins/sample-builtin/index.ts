// A Built-in Plugin fixture (issue #444): proves the build pipeline bundles the
// SDK from `@/plugin-sdk` into the entry. Never shipped; only the build test
// reads it, and the test never runs it.
import { createPluginClient } from "@/plugin-sdk";

addEventListener("message", (event) => {
  const port = (event as MessageEvent).ports[0];
  if (port) createPluginClient(port as unknown as Parameters<typeof createPluginClient>[0]);
});
