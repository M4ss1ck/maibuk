/**
 * A Plugin in the QuickJS engine saving a file (#516): the engine has no
 * `Blob`, so `files.save` must still carry the bytes to the host. The fixture
 * is a real Plugin built from the real SDK, run in the real engine and driven
 * against the real broker, so the assertion is on the bytes the host received.
 */

import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  runQuickJsPlugin,
  type QuickJsPluginEndpoint,
  type QuickJsPluginRun,
} from "@/features/plugins/quickjs";
import { createTestHost } from "@/features/plugins/test-kit";
import type { PluginManifest, TestHost } from "@/features/plugins/types";
import { PLUGIN_INIT_MESSAGE, PLUGIN_READY_MESSAGE } from "@/plugin-sdk/protocol";
import { bundlePluginFixture } from "@/test/support/bundle-plugin-fixture";
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";

const FIXTURE_ENTRY = resolve(process.cwd(), "src/test/fixtures/quickjs/files-save.ts");

/** A manifest that may save a file, so the call passes the permission check. */
const SAVE_MANIFEST: PluginManifest = {
  ...PLUGIN_MANIFEST,
  permissions: { required: ["files:save"], optional: [] },
};

/** The first PNG signature bytes. */
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

/** The Worker global scope the runner posts to and receives messages from. */
class EndpointDouble implements QuickJsPluginEndpoint {
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

  /** Deliver one scope `message` event, exactly as the Worker scope would. */
  emit(data: unknown): void {
    for (const listener of this.listeners) listener({ data, ports: [] });
  }
}

interface Session {
  run: QuickJsPluginRun;
  endpoint: EndpointDouble;
  host: TestHost;
}

/** Start the fixture against a real host broker over the runner. */
async function start(): Promise<Session> {
  const host = createTestHost({ manifest: SAVE_MANIFEST });
  const endpoint = new EndpointDouble();
  const source = await bundlePluginFixture(FIXTURE_ENTRY);
  const run = runQuickJsPlugin({
    sources: { "index.js": source },
    entry: "index.js",
    endpoint,
    initEvent: {
      data: { kind: PLUGIN_INIT_MESSAGE.kind, startReason: "enable" },
      ports: [host.port],
    },
  });
  return { run, endpoint, host };
}

describe("files.save from the QuickJS engine", () => {
  it("delivers the bytes a Plugin builds in the VM to the host", async () => {
    const { run, endpoint, host } = await start();
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      expect(endpoint.messages).toContainEqual({ kind: PLUGIN_READY_MESSAGE.kind });

      endpoint.emit({
        kind: "maibuk:harness-save",
        id: 1,
        name: "map.png",
        mimeType: "image/png",
        bytes: PNG,
      });

      await vi.waitFor(() => expect(host.files.saves).toHaveLength(1));
      const [saved] = host.files.saves;
      expect(saved.name).toBe("map.png");
      expect(saved.mimeType).toBe("image/png");
      expect([...saved.bytes]).toEqual(PNG);
      expect(endpoint.messages).toContainEqual({
        kind: "maibuk:harness-save-result",
        id: 1,
        result: { status: "saved" },
        hasBlob: false,
      });
    } finally {
      run.dispose();
    }
  });
});
