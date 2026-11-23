// @vitest-environment jsdom
/**
 * `files.save` on a Plugin engine with no `Blob` (#516): the SDK folds the
 * accepted `bytes` shapes into one `Uint8Array` and sends it where the `Blob`
 * goes, so a save still reaches the host.
 *
 * These tests drive the real client over a recording port and assert the bytes
 * themselves, so the message can only pass by carrying its data.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginClient, PluginApiError, type PluginMessagePort } from "@/plugin-sdk";

/** The first PNG signature bytes, the content a Maps export starts with. */
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** The Plugin end of the port: it records what the SDK posts and answers replies. */
class RecordingPort implements PluginMessagePort {
  readonly messages: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  /** Answers the call whose id the SDK assigned, so its promise settles. */
  reply(id: number, result: unknown): void {
    this.onmessage?.({ data: { kind: "result", id, ok: true, result } } as MessageEvent);
  }
}

function start(): { port: RecordingPort; client: ReturnType<typeof createPluginClient> } {
  const port = new RecordingPort();
  return { port, client: createPluginClient(port) };
}

/** The one `blob` message the SDK posts after a call head. */
function blobMessage(port: RecordingPort): { kind: string; id: number; blob: unknown } {
  const message = port.messages[1] as { kind: string; id: number; blob: unknown };
  expect(port.messages[0]).toEqual(expect.stringContaining('"method":"files.save"'));
  return message;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("files.save on an engine with no Blob", () => {
  it("sends a Uint8Array's bytes as one Uint8Array in the blob slot", async () => {
    vi.stubGlobal("Blob", undefined);
    const { port, client } = start();

    const saved = client.files.save({ name: "map.png", mimeType: "image/png", bytes: PNG });
    await vi.waitFor(() => expect(port.messages).toHaveLength(2));

    const message = blobMessage(port);
    expect(message.kind).toBe("blob");
    expect(message.id).toBe(1);
    expect(message.blob).toBeInstanceOf(Uint8Array);
    expect([...(message.blob as Uint8Array)]).toEqual([...PNG]);
    // The head carries only the wire shape: the bytes never travel as JSON.
    expect(JSON.parse(port.messages[0] as string).params).toEqual({
      name: "map.png",
      mimeType: "image/png",
    });

    port.reply(1, { status: "saved" });
    await expect(saved).resolves.toEqual({ status: "saved" });
  });

  it("concatenates a two-chunk AsyncIterable into one Uint8Array", async () => {
    vi.stubGlobal("Blob", undefined);
    const { port, client } = start();
    const bytes = (async function* () {
      yield PNG.subarray(0, 2);
      yield PNG.subarray(2);
    })();

    const saved = client.files.save({ name: "map.png", mimeType: "image/png", bytes });
    await vi.waitFor(() => expect(port.messages).toHaveLength(2));

    const message = blobMessage(port);
    expect(message.blob).toBeInstanceOf(Uint8Array);
    expect([...(message.blob as Uint8Array)]).toEqual([...PNG]);

    port.reply(1, { status: "saved" });
    await expect(saved).resolves.toEqual({ status: "saved" });
  });

  it("still refuses a stream piece that is not a Uint8Array", async () => {
    vi.stubGlobal("Blob", undefined);
    const { port, client } = start();
    const bytes = (async function* () {
      yield "not bytes";
    })() as unknown as AsyncIterable<Uint8Array>;

    const error = await client.files
      .save({ name: "a.txt", mimeType: "text/plain", bytes })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(PluginApiError);
    expect(error).toMatchObject({ code: "invalid-params", method: "files.save" });
    // The call is refused before its head is posted, so nothing reached the host.
    expect(port.messages).toHaveLength(0);
  });
});
