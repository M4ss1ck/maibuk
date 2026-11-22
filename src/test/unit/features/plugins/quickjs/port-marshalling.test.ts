/**
 * Bytes crossing out of the QuickJS VM (#516): `toVmValue` brings host bytes in,
 * and the runner's port and scope `postMessage` take VM values out. QuickJS has
 * no structured clone, so the way out is a JSON pass; a JSON pass has no binary
 * form, and an `ArrayBuffer` dumps as `{}` and a `Uint8Array` as an object of
 * indices. That is how every archive image reached the Reader Frame as a
 * zero-length buffer on Android while text entries (strings) arrived fine.
 *
 * These tests drive the real runner with a real `MessagePort` and assert the
 * bytes themselves, so a message can only pass by carrying its data.
 */

import { describe, expect, it } from "vitest";
import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten-core";
import { runQuickJsPlugin, type QuickJsPluginEndpoint } from "@/features/plugins/quickjs";
import { fromVmValue } from "@/features/plugins/quickjs/bridge";

class EndpointDouble implements QuickJsPluginEndpoint {
  readonly messages: unknown[] = [];

  postMessage(data: unknown): void {
    this.messages.push(data);
  }

  addEventListener(): void {}
}

/** The first PNG signature bytes, the content the Reader's images start with. */
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

/** A Plugin whose port and scope each post one message the test inspects. */
function sources(posted: string): Record<string, string> {
  return {
    "index.js": `self.onmessage = function (event) {
      const port = event.ports[0];
      ${posted}
    };`,
  };
}

/** Resolves with the first message the host end of `port` receives. */
function nextMessage(port: MessagePort): Promise<unknown> {
  return new Promise((resolve) => {
    port.onmessage = (event: MessageEvent) => resolve(event.data);
  });
}

/**
 * Runs one snippet against a real MessagePort handed to the Plugin, and returns
 * the first message its host end received.
 */
async function overPort(posted: string): Promise<unknown> {
  const channel = new MessageChannel();
  const run = runQuickJsPlugin({
    sources: sources(posted),
    entry: "index.js",
    endpoint: new EndpointDouble(),
    initEvent: {
      data: { kind: "maibuk:plugin-init" },
      ports: [channel.port2],
    },
  });
  try {
    await expect(run.outcome).resolves.toEqual({ kind: "ready" });
    return await nextMessage(channel.port1);
  } finally {
    run.dispose();
    channel.port1.close();
    channel.port2.close();
  }
}

describe("bytes crossing out of the QuickJS VM", () => {
  it("carries an ArrayBuffer out of a port message with every byte", async () => {
    const data = (await overPort(
      `port.postMessage({ kind: "zip-data", id: 7, buffer: new Uint8Array([${PNG}]).buffer });`
    )) as { kind: string; id: number; buffer: unknown };
    expect(data.kind).toBe("zip-data");
    expect(data.id).toBe(7);
    expect(data.buffer).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(data.buffer as ArrayBuffer))).toEqual(PNG);
  });

  it("carries a typed array view as a view of its own bytes, not the whole buffer", async () => {
    const data = (await overPort(
      `const padded = new Uint8Array([0, 0, 9, 8, 7, 0]);
       port.postMessage({ view: padded.subarray(2, 5) });`
    )) as { view: unknown };
    expect(data.view).toBeInstanceOf(Uint8Array);
    expect(Array.from(data.view as Uint8Array)).toEqual([9, 8, 7]);
  });

  it("carries bytes the Worker scope posts, not just a port's", async () => {
    const endpoint = new EndpointDouble();
    const run = runQuickJsPlugin({
      sources: sources(
        `self.postMessage({ kind: "zip-data", id: 2, buffer: new Uint8Array([${PNG}]).buffer });`
      ),
      entry: "index.js",
      endpoint,
      initEvent: { data: { kind: "maibuk:plugin-init" }, ports: [] },
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      const data = endpoint.messages[0] as { buffer: unknown };
      expect(data.buffer).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(data.buffer as ArrayBuffer))).toEqual(PNG);
    } finally {
      run.dispose();
    }
  });

  it("carries bytes after the VM's Wasm memory has grown", async () => {
    // A live 48 MiB allocation pushes the Wasm linear memory past its 16 MiB
    // initial size. Growing it detaches every typed array cached over the old
    // heap, including the context's `uint32Out` that `context.getLength` reads,
    // which is how every byte payload became a marker on a real device.
    const grown = [11, 22, 33, 44, 55, 66, 77, 88];
    const channel = new MessageChannel();
    const run = runQuickJsPlugin({
      sources: {
        "index.js": `globalThis.__ballast = new Uint8Array(48 * 1024 * 1024);
          self.onmessage = function (event) {
            event.ports[0].postMessage({
              kind: "zip-data",
              buffer: new Uint8Array([${grown}]).buffer,
            });
          };`,
      },
      entry: "index.js",
      endpoint: new EndpointDouble(),
      initEvent: {
        data: { kind: "maibuk:plugin-init" },
        ports: [channel.port2],
      },
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      const data = (await nextMessage(channel.port1)) as { kind: string; buffer: unknown };
      expect(data.kind).toBe("zip-data");
      expect(data.buffer).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(data.buffer as ArrayBuffer))).toEqual(grown);
    } finally {
      run.dispose();
      channel.port1.close();
      channel.port2.close();
    }
  });

  it("leaves the rest of the message exactly as posted", async () => {
    const data = await overPort(
      `port.postMessage({
         kind: "call",
         id: 3,
         method: "files.read",
         params: { grant: "g1", offset: 64, nested: [1, "two", null, true] },
       });`
    );
    expect(data).toEqual({
      kind: "call",
      id: 3,
      method: "files.read",
      params: { grant: "g1", offset: 64, nested: [1, "two", null, true] },
    });
  });
});

describe("a buffers list that the encoder did not write", () => {
  /**
   * The host bridge is on the VM's global, so a Plugin can hand it a `json` and
   * a `buffers` of its own. This body posts one and reports what the host said.
   */
  function hostileBody(buffers: string): string {
    return `try {
        globalThis.__maibukBridgeHost.portPostMessage(0, { json: '"x"', buffers: ${buffers} });
        port.postMessage({ refused: false, message: "" });
      } catch (error) {
        port.postMessage({ refused: true, message: String((error && error.message) || error) });
      }`;
  }

  it("refuses a length no real message could carry without walking it", async () => {
    // A real message carries one buffer per marker in its JSON, so a claimed
    // length far above that is a forgery. The Proxy answers a fresh buffer for
    // every index, so the count has to be refused before the host walks it:
    // this one claims 100,000 entries, and the same forgery can claim a billion.
    const data = (await overPort(
      hostileBody(`new Proxy({}, {
        get: function (target, key) {
          return key === "length" ? 100000 : new ArrayBuffer(1);
        },
      })`)
    )) as { refused: boolean; message: string };
    expect(data.refused).toBe(true);
    expect(data.message).toContain("at most 4096 buffers");
  });

  it("refuses an entry that is not an ArrayBuffer", async () => {
    const data = (await overPort(hostileBody("[5]"))) as { refused: boolean; message: string };
    expect(data.refused).toBe(true);
    expect(data.message).toContain("must be ArrayBuffers");
  });

  it("refuses a plain object standing in for bytes", async () => {
    const data = (await overPort(hostileBody("[{}]"))) as { refused: boolean; message: string };
    expect(data.refused).toBe(true);
    expect(data.message).toContain("must be ArrayBuffers");
  });

  it("disposes the handle of an entry it cannot read", () => {
    // `getArrayBuffer` throws for a value that is not an ArrayBuffer, and the
    // entry's handle is released anyway: leaked, it would hold the refused
    // value for the rest of the run.
    const disposed: string[] = [];
    const handle = (name: string) => ({ dispose: () => void disposed.push(name) });
    const encoded = handle("encoded");
    const json = handle("json");
    const buffers = handle("buffers");
    const length = handle("length");
    const item = handle("item");
    const context = {
      getProp: (target: unknown, key: string | number) => {
        if (target === encoded && key === "json") return json;
        if (target === encoded && key === "buffers") return buffers;
        if (target === buffers && key === "length") return length;
        if (target === buffers && key === 0) return item;
        throw new Error(`unexpected read ${String(key)}`);
      },
      typeof: (target: unknown) => (target === json ? "string" : "object"),
      getString: () => '"x"',
      getNumber: () => 1,
      getArrayBuffer: () => {
        throw new Error("Couldn't allocate memory to get ArrayBuffer");
      },
    } as unknown as QuickJSContext;

    expect(() => fromVmValue(context, encoded as unknown as QuickJSHandle)).toThrow(
      "must be ArrayBuffers"
    );
    expect(disposed).toEqual(["length", "item", "json", "buffers"]);
  });
});
