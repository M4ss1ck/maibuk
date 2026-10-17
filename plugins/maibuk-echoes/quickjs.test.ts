// @vitest-environment node
/**
 * Echoes on the Android QuickJS engine (#517): the Built-in entry, bundled the
 * way a shipped Plugin is, evaluates in the memory-capped runner with the Android
 * global set (no `Intl`, no `WebAssembly`) and signals ready. A missing global
 * or an unevaluable module settles the run as `error`, so this fails readably.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";
import { runQuickJsPlugin, type QuickJsPluginEndpoint } from "@/features/plugins/quickjs";
import { createTestHost } from "@/features/plugins/test-kit";
import { PLUGIN_INIT_MESSAGE, PLUGIN_READY_MESSAGE } from "@/plugin-sdk/protocol";
import { bundlePluginFixture } from "@/test/support/bundle-plugin-fixture";

const ECHOES_DIR = __dirname;
const ENTRY = join(ECHOES_DIR, "index.tsx");

/** The Worker scope double the runner posts to; it records what Echoes sends. */
class ScopeDouble implements QuickJsPluginEndpoint {
  readonly messages: unknown[] = [];
  private readonly listeners = new Set<
    (event: { data: unknown; ports: readonly MessagePort[] }) => void
  >();
  postMessage(data: unknown): void {
    this.messages.push(data);
  }
  addEventListener(
    _type: "message",
    listener: (event: { data: unknown; ports: readonly MessagePort[] }) => void
  ): void {
    this.listeners.add(listener);
  }
}

function echoesManifest() {
  const text = readFileSync(join(ECHOES_DIR, "manifest.json"), "utf8");
  const result = parsePluginManifest(text, { builtIn: true });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.manifest;
}

describe("Echoes on the QuickJS runner (Android, #517)", () => {
  it("declares android, the platform the Android runner is asked to load it for", () => {
    expect(echoesManifest().platforms).toContain("android");
  });

  it("evaluates the bundled entry with the Android global set and signals ready", async () => {
    const host = createTestHost({ manifest: echoesManifest() });
    const endpoint = new ScopeDouble();
    const source = await bundlePluginFixture(ENTRY);
    // The bundle must not reach for a global the Android set does not provide.
    expect(source).not.toMatch(/\bIntl\./);
    const run = runQuickJsPlugin({
      sources: { "index.js": source },
      entry: "index.js",
      endpoint,
      initEvent: {
        data: { kind: PLUGIN_INIT_MESSAGE.kind, startReason: "enable" },
        ports: [host.port],
      },
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      expect(endpoint.messages).toContainEqual(PLUGIN_READY_MESSAGE);
    } finally {
      run.dispose();
      host.stop();
    }
  });
});
