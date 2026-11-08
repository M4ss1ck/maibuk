// The Blob transport proof (issue #735; ADR 0040): a Plugin hands the host a
// file as `{ kind: "blob", id, blob }` over its MessagePort, by structured
// clone rather than as a JSON string. This spec proves the transport only: a
// 3 MiB Blob built on the Plugin side — in a Worker, and in the sandboxed
// frame's Worker — arrives in the host realm as a real Blob with the same
// size, type, and bytes. The broker now consumes this message for
// `files.save`; this spec still exercises the transport alone.
//
// Both sides derive the payload from the same fixed seed, so the host can
// compare what it received against the bytes it derives itself, byte for byte.
//
// Tagged @sandbox so the lane runs it on Chromium, WebKit, and Firefox, and
// @wf:plugins-sandbox because it extends that row's sandbox wire contract.

import {
  PLUGIN_BLOB_BYTES,
  PLUGIN_BLOB_TYPE,
  type BlobTransportRun,
  runBlobTransport,
} from "../support/plugins-sandbox";
import { expect, test } from "../support/test";

/** Asserts the Blob crossed intact: a real Blob, the same bytes, and never detached. */
function expectIntactBlob(run: BlobTransportRun): void {
  expect(run.isBlob, "the blob message must carry a real Blob, not a plain object").toBe(true);
  expect(run.id).toBe(1);
  expect(run.size).toBe(PLUGIN_BLOB_BYTES);
  expect(run.type).toBe(PLUGIN_BLOB_TYPE);
  // The Plugin's post left its own Blob readable, so nothing was transferred.
  expect(run.afterPostSize).toBe(PLUGIN_BLOB_BYTES);
  // The host's derived payload and the received one are identical.
  expect(run.firstMismatch).toBe(-1);
}

test.describe("Plugin sandbox Blob transport @wf:plugins-sandbox @sandbox", () => {
  test("a Blob from a Plugin Worker arrives byte-for-byte", async ({ page }) => {
    await page.goto("/");
    expectIntactBlob(await runBlobTransport(page, "worker"));
  });

  test("a Blob from a Plugin Frame's Worker arrives byte-for-byte", async ({ page }) => {
    await page.goto("/");
    expectIntactBlob(await runBlobTransport(page, "frame"));
  });
});
