// The SDK's Frame handoff (#454, D1, decision: the broker MessagePort). The
// host posts one reserved envelope carrying the Frame's port; the SDK settles
// it before RPC dispatch and exposes it through `client.onFrame`. These tests
// prove the delivery, the unsubscribe, and that no RPC handler ever sees it.
//
// A MessagePort delivers on its own schedule, not after one timer turn: on a
// loaded runner a message can land several macrotasks later. Each test waits
// for a delivery it can observe, and a "never called" check waits for a later
// message on the same port first (a port delivers in order).

import { describe, expect, it, vi } from "vitest";
import { PLUGIN_FRAME_MESSAGE, createPluginClient, type PluginFrame } from "@/plugin-sdk";

function frameEnvelope(
  frameId: string,
  src: string
): { message: unknown; transfer: MessagePort[] } {
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
    await vi.waitFor(() => expect(frames).toHaveLength(1));

    expect(frames[0].id).toBe("frame:1");
    expect(frames[0].src).toBe("ui/report.html");
    // The delivered port is the Frame's own port: a message posted on it
    // reaches the end the host kept.
    const received: unknown[] = [];
    frameChannel.port2.onmessage = (event) => received.push(event.data);
    frames[0].port.postMessage("ping");
    await vi.waitFor(() => expect(received).toEqual(["ping"]));
  });

  it("unsubscribes so a later Frame does not reach the handler", async () => {
    const channel = new MessageChannel();
    const client = createPluginClient(channel.port2);
    const handler = vi.fn();
    const off = client.onFrame(handler);
    off();
    // Still subscribed: once it sees the Frame, the removed handler had its chance.
    const witness = vi.fn();
    client.onFrame(witness);

    const { message, transfer } = frameEnvelope("frame:2", "ui/x.html");
    channel.port1.postMessage(message, transfer);
    await vi.waitFor(() => expect(witness).toHaveBeenCalledTimes(1));

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
    await vi.waitFor(() => expect(frameHandler).toHaveBeenCalledTimes(1));

    expect(hostRequest).not.toHaveBeenCalled();
  });
});
