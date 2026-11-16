import { describe, expect, it } from "vitest";
import {
  CANVAS_DROP_CASCADE,
  droppedImageNodes,
  imageMimeFromPath,
} from "@/features/canvas/canvasDrop";
import type { EncodedCanvasImage } from "@/features/canvas/encodeCanvasImage";

function droppedFile(name: string, type = "image/png"): File {
  return new File(["x"], name, { type });
}

function fakeEncode(size: { width: number; height: number } = { width: 100, height: 100 }) {
  return async (source: string | Blob): Promise<EncodedCanvasImage> => ({
    src: `data:image/png;base64,${(source as File).name}`,
    ...size,
  });
}

describe("droppedImageNodes", () => {
  it("cascades each placed image by the drop offset", async () => {
    const result = await droppedImageNodes(
      [droppedFile("a.png"), droppedFile("b.png"), droppedFile("c.png")],
      { x: 10, y: 20 },
      fakeEncode()
    );

    expect(CANVAS_DROP_CASCADE).toBe(24);
    expect(result.skipped).toBe(0);
    expect(result.nodes.map((node) => node.position)).toEqual([
      { x: 10, y: 20 },
      { x: 34, y: 44 },
      { x: 58, y: 68 },
    ]);
    expect(result.nodes.map((node) => node.id)).toHaveLength(3);
    expect(new Set(result.nodes.map((node) => node.id)).size).toBe(3);
  });

  it("skips a file the encoder refuses without advancing the cascade", async () => {
    const encode = async (source: string | Blob): Promise<EncodedCanvasImage> => {
      if ((source as File).type !== "image/png") throw new Error("unsupported");
      return { src: "data:image/png;base64,x", width: 100, height: 100 };
    };

    const result = await droppedImageNodes(
      [droppedFile("a.png"), droppedFile("notes.txt", "text/plain"), droppedFile("b.png")],
      { x: 0, y: 0 },
      encode
    );

    expect(result.skipped).toBe(1);
    expect(result.nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 0 },
      { x: 24, y: 24 },
    ]);
  });

  it("fits the encoded image into the placement box", async () => {
    const result = await droppedImageNodes(
      [droppedFile("wide.png")],
      { x: 0, y: 0 },
      fakeEncode({ width: 640, height: 320 })
    );

    expect(result.nodes[0]).toMatchObject({ kind: "image", width: 320, height: 160 });
  });

  it("carries the file name, and leaves it unset when the file has none", async () => {
    const result = await droppedImageNodes(
      [droppedFile("cat.png"), droppedFile("")],
      { x: 0, y: 0 },
      fakeEncode()
    );

    expect(result.nodes[0]).toMatchObject({ fileName: "cat.png" });
    expect(result.nodes[1]).toMatchObject({ fileName: undefined });
  });
});

describe("imageMimeFromPath", () => {
  it("maps an image extension to its MIME type, whatever its case", () => {
    expect(imageMimeFromPath("cat.png")).toBe("image/png");
    expect(imageMimeFromPath("CAT.PNG")).toBe("image/png");
    expect(imageMimeFromPath("photo.jpg")).toBe("image/jpeg");
    expect(imageMimeFromPath("photo.jpeg")).toBe("image/jpeg");
    expect(imageMimeFromPath("anim.gif")).toBe("image/gif");
    expect(imageMimeFromPath("shot.webp")).toBe("image/webp");
    expect(imageMimeFromPath("logo.svg")).toBe("image/svg+xml");
    expect(imageMimeFromPath("old.bmp")).toBe("image/bmp");
    expect(imageMimeFromPath("next.avif")).toBe("image/avif");
  });

  it("falls back to the generic binary type", () => {
    expect(imageMimeFromPath("notes.txt")).toBe("application/octet-stream");
    expect(imageMimeFromPath("no-extension")).toBe("application/octet-stream");
  });
});
