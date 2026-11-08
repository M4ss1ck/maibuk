/**
 * The web Plugin File Saver (ADR 0040): the browser's save picker writes the
 * bytes where the author chooses, and a browser without it (or one that refuses
 * the picker) hands the file to the browser's download instead.
 */
import { ReadableStream, WritableStream } from "node:stream/web";
import { describe, expect, it, vi } from "vitest";
import { createWebPluginFileSaver } from "@/lib/platform/web/file-save";

/** A `Blob` whose stream yields exactly `chunks`, which jsdom's own Blob cannot. */
function blobOf(...chunks: Uint8Array[]): Blob {
  return {
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
  } as unknown as Blob;
}

function collectingWritable(received: Uint8Array[]): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      received.push(chunk);
    },
  }) as unknown as WritableStream<Uint8Array>;
}

const encoder = new TextEncoder();

describe("createWebPluginFileSaver()", () => {
  it("writes the bytes through the save picker the author answered", async () => {
    const received: Uint8Array[] = [];
    const createWritable = vi.fn(async () => collectingWritable(received));
    const showSaveFilePicker = vi.fn(async () => ({ createWritable }));
    const download = vi.fn();
    const saver = createWebPluginFileSaver({ showSaveFilePicker, download });

    await expect(
      saver.save("map.png", "image/png", blobOf(encoder.encode("abc"), encoder.encode("def")))
    ).resolves.toBe("saved");

    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: "map.png",
      types: [{ accept: { "image/png": [".png"] } }],
    });
    expect(download).not.toHaveBeenCalled();
    expect(received.map((chunk) => new TextDecoder().decode(chunk))).toEqual(["abc", "def"]);
  });

  it("reports cancelled when the author closes the save picker", async () => {
    const showSaveFilePicker = vi.fn(async () => {
      throw new DOMException("The author cancelled", "AbortError");
    });
    const download = vi.fn();
    const saver = createWebPluginFileSaver({ showSaveFilePicker, download });

    await expect(saver.save("map.png", "image/png", blobOf())).resolves.toBe("cancelled");
    expect(download).not.toHaveBeenCalled();
  });

  it("falls back to a download when the browser refuses the picker as insecure", async () => {
    const showSaveFilePicker = vi.fn(async () => {
      throw new DOMException("Cross origin", "SecurityError");
    });
    const download = vi.fn();
    const saver = createWebPluginFileSaver({ showSaveFilePicker, download });
    const blob = blobOf(encoder.encode("abc"));

    await expect(saver.save("map.png", "image/png", blob)).resolves.toBe("saved");
    expect(download).toHaveBeenCalledWith(blob, "map.png");
  });

  it("falls back to a download when the browser needs a user activation", async () => {
    const showSaveFilePicker = vi.fn(async () => {
      throw new DOMException("Needs a gesture", "NotAllowedError");
    });
    const download = vi.fn();
    const saver = createWebPluginFileSaver({ showSaveFilePicker, download });
    const blob = blobOf();

    await expect(saver.save("map.svg", "image/svg+xml", blob)).resolves.toBe("saved");
    expect(download).toHaveBeenCalledWith(blob, "map.svg");
  });

  it("downloads when the browser has no save picker", async () => {
    const download = vi.fn();
    const saver = createWebPluginFileSaver({ download });
    const blob = blobOf();

    await expect(saver.save("map.png", "image/png", blob)).resolves.toBe("saved");
    expect(download).toHaveBeenCalledWith(blob, "map.png");
  });

  it("rejects when writing through the picker fails", async () => {
    const createWritable = vi.fn(
      async () =>
        new WritableStream<Uint8Array>({
          write() {
            throw new Error("disk full");
          },
        })
    );
    const showSaveFilePicker = vi.fn(async () => ({ createWritable }));
    const download = vi.fn();
    const saver = createWebPluginFileSaver({ showSaveFilePicker, download });

    await expect(saver.save("map.png", "image/png", blobOf(encoder.encode("abc")))).rejects.toThrow(
      "disk full"
    );
    expect(download).not.toHaveBeenCalled();
  });
});
