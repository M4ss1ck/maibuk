// @vitest-environment jsdom
/**
 * `files.save` bytes folding in the Plugin SDK: every accepted `bytes` shape is
 * folded into one `Blob` (every Plugin engine has one), and a stream whose piece
 * is not a `Uint8Array` is refused before anything reaches the host.
 *
 * These tests drive the real client over a recording port, so a message can only
 * pass by carrying its data.
 */

import { describe, expect, it } from "vitest";
import { createPluginClient, PluginApiError, type PluginMessagePort } from "@/plugin-sdk";

/** The Plugin end of the port: it records what the SDK posts and answers replies. */
class RecordingPort implements PluginMessagePort {
  readonly messages: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }
}

function start(): { port: RecordingPort; client: ReturnType<typeof createPluginClient> } {
  const port = new RecordingPort();
  return { port, client: createPluginClient(port) };
}

describe("files.save bytes folding", () => {
  it("still refuses a stream piece that is not a Uint8Array", async () => {
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
