// The SDK's Frame handoff (#454, D1, decision: the broker MessagePort). The
// host posts one reserved envelope carrying the Frame's port; the SDK settles
// it before RPC dispatch and exposes it through `client.onFrame`. These tests
// prove the delivery, the unsubscribe, and that no RPC handler ever sees it.

import { describe, expect, it, vi } from "vitest";
import {
  PLUGIN_FRAME_MESSAGE,
  createPluginClient,
  type PluginFrame,
} from "@/plugin-sdk";

/** One macrotask, so a MessagePort delivery lands. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function frameEnvelope(frameId: string, src: string): { message: unknown; transfer: MessagePort[] } {
  return {
    message: { kind: PLUGIN_FRAME_MESSAGE.kind, frameId, src },
    transfer: [new MessageChannel().port1],
  };
}

describe("client.onFrame (#454)", () => {
  it("delivers {id, src, port} from the reserved envelope", async () => {
    const channel = new MessageChannel();
    const client = createPluginClient(channel.port2);
    const frames: PluginFrame[] = [];
    client.onFrame((frame) => frames.push(frame));

    const frameChannel = new MessageChannel();
    channel.port1.postMessage(
      { kind: PLUGIN_FRAME_MESSAGE.kind, frameId: "frame:1", src: "ui/report.html" },
      [frameChannel.port1]
    );
    await tick();

    expect(frames).toHaveLength(1);
    expect(frames[0].id).toBe("frame:1");
    expect(frames[0].src).toBe("ui/report.html");
    // The delivered port is the Frame's own port: a message posted on it
    // reaches the end the host kept.
    const received: unknown[] = [];
    frameChannel.port2.onmessage = (event) => received.push(event.data);
    frames[0].port.postMessage("ping");
    await tick();
    expect(received).toEqual(["ping"]);
  });

  it("unsubscribes so a later Frame does not reach the handler", async () => {
    const channel = new MessageChannel();
    const client = createPluginClient(channel.port2);
    const handler = vi.fn();
    const off = client.onFrame(handler);
    off();

    const { message, transfer } = frameEnvelope("frame:2", "ui/x.html");
    channel.port1.postMessage(message, transfer);
    await tick();

    expect(handler).not.toHaveBeenCalled();
  });

  it("never surfaces the envelope to an RPC handler", async () => {
    const channel = new MessageChannel();
    const client = createPluginClient(channel.port2);
    const hostRequest = vi.fn(() => null);
    client.onHostRequest(hostRequest);
    const frameHandler = vi.fn();
    client.onFrame(frameHandler);

    const { message, transfer } = frameEnvelope("frame:3", "ui/y.html");
    channel.port1.postMessage(message, transfer);
    await tick();

    expect(hostRequest).not.toHaveBeenCalled();
    expect(frameHandler).toHaveBeenCalledTimes(1);
  });
});
