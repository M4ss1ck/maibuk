// @vitest-environment node
/**
 * The exported Android global list (`QUICKJS_ANDROID_GLOBALS`, #517) names
 * only globals the QuickJS engine really installs. The Android step's message
 * reads this same list, so a drift here would make the check lie. This runs a
 * Plugin in the real runner and asks, inside the context after the globals
 * install, whether each listed name is defined.
 */

import { describe, expect, it } from "vitest";
import { runQuickJsPlugin, type QuickJsPluginEndpoint } from "@/features/plugins/quickjs";
import { QUICKJS_ANDROID_GLOBALS } from "@/features/plugins/quickjs/globals";

class EndpointDouble implements QuickJsPluginEndpoint {
  readonly messages: unknown[] = [];

  postMessage(data: unknown): void {
    this.messages.push(data);
  }

  addEventListener(): void {}
}

describe("QUICKJS_ANDROID_GLOBALS", () => {
  it("lists only names the engine defines inside the context after the globals install", async () => {
    const endpoint = new EndpointDouble();
    const run = runQuickJsPlugin({
      sources: {
        "index.js": `(() => {
          const defined = {};
          for (const name of ${JSON.stringify(QUICKJS_ANDROID_GLOBALS)}) {
            defined[name] = typeof globalThis[name] !== "undefined";
          }
          self.postMessage({ defined });
        })();`,
      },
      entry: "index.js",
      endpoint,
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      const report = endpoint.messages[0] as { defined: Record<string, boolean> };
      expect(Object.keys(report.defined)).toEqual([...QUICKJS_ANDROID_GLOBALS]);
      for (const name of QUICKJS_ANDROID_GLOBALS) {
        expect(report.defined[name], name).toBe(true);
      }
    } finally {
      run.dispose();
    }
  });
});
