/**
 * The start-worker message is the only path the QuickJS engine's bytes take
 * from the host into the sandbox frame. The frame is an opaque-origin
 * `sandbox="allow-scripts"` iframe, a different agent cluster: a
 * `WebAssembly.Module` posted into it is silently dropped (#516, the Android
 * conformance run never started the Plugin). This suite pins that the message
 * carries only data a cross-origin postMessage can clone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPluginFrame } from "@/features/plugins/sandbox";
import type { PluginSandboxFrame } from "@/features/plugins/types";

let frame: PluginSandboxFrame | null = null;

afterEach(() => {
  frame?.stop();
  frame = null;
  vi.restoreAllMocks();
});

/** True for values a cross-origin postMessage clones: data, never a host object. */
function isCrossOriginCloneable(value: unknown): boolean {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean" || kind === "undefined") {
    return true;
  }
  if (value instanceof ArrayBuffer) return true;
  if (Array.isArray(value)) return value.every(isCrossOriginCloneable);
  if (kind === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value as Record<string, unknown>).every(isCrossOriginCloneable);
  }
  return false;
}

describe("the QuickJS start-worker message", () => {
  it("carries the Wasm as an ArrayBuffer and no WebAssembly.Module", async () => {
    frame = createPluginFrame(document);
    const posted: Array<{ message: unknown; transfer: unknown }> = [];
    const target = frame.element.contentWindow;
    if (!target) throw new Error("the sandbox frame has no window in this environment");
    vi.spyOn(target, "postMessage").mockImplementation((...args: unknown[]) => {
      posted.push({ message: args[0], transfer: args[2] });
    });

    const channel = new MessageChannel();
    const wasmBinary = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer;
    await frame.startWorker("blob:entry", channel.port1, {
      runner: "blob:runner",
      sources: { "index.js": "export default 1;" },
      wasmBinary,
    });
    channel.port1.close();
    channel.port2.close();

    expect(posted).toHaveLength(1);
    const message = posted[0]?.message as Record<string, unknown>;
    expect(message.kind).toBe("start-worker");
    expect(message.engine).toBe("quickjs");
    expect(message.wasmBinary).toBeInstanceOf(ArrayBuffer);
    expect(message).not.toHaveProperty("wasmModule");
    expect(isCrossOriginCloneable(message)).toBe(true);
    // The Module-free message must also survive the structured clone the
    // browser performs, so a regression to a Module fails here, not on-device.
    expect(() => structuredClone(message)).not.toThrow();
    // The port is the only transferred object.
    expect(posted[0]?.transfer).toEqual([channel.port1]);
  });

  it("rejects a WebAssembly.Module in the cloneability check", async () => {
    const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    const compiled = await WebAssembly.compile(bytes);
    expect(isCrossOriginCloneable({ wasmModule: compiled })).toBe(false);
  });
});
