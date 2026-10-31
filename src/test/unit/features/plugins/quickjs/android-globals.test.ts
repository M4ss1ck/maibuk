// @vitest-environment node
/**
 * The exported Android global list (`QUICKJS_ANDROID_GLOBALS`, #517) names
 * only globals the QuickJS engine really installs. The Android step's message
 * reads this same list, so a drift here would make the check lie. This runs a
 * Plugin in the real runner and asks, inside the context after the globals
 * install, whether each listed name is defined.
 */

import { describe, expect, it, vi } from "vitest";
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

  // A vendored library (maibuk-echoes' Snowball stemmer) calls console.assert;
  // without it every stem threw on Android and Echoes found nothing (#517).
  it("gives console the methods a Worker has, and console.assert forwards a failed assertion at error level", async () => {
    const endpoint = new EndpointDouble();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = runQuickJsPlugin({
      sources: {
        "index.js": `(() => {
          const names = ${JSON.stringify(WORKER_CONSOLE_METHODS)};
          const missing = names.filter((name) => typeof console[name] !== "function");
          console.assert(true, "silent");
          console.assert(1 > 2, "math", 3);
          self.postMessage({ missing });
        })();`,
      },
      entry: "index.js",
      endpoint,
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      expect(endpoint.messages[0]).toEqual({ missing: [] });
      expect(error.mock.calls).toEqual([["Assertion failed:", "math", 3]]);
    } finally {
      error.mockRestore();
      run.dispose();
    }
  });
});

const WORKER_CONSOLE_METHODS = [
  "assert",
  "clear",
  "count",
  "countReset",
  "debug",
  "dir",
  "dirxml",
  "error",
  "group",
  "groupCollapsed",
  "groupEnd",
  "info",
  "log",
  "table",
  "time",
  "timeEnd",
  "timeLog",
  "trace",
  "warn",
];
