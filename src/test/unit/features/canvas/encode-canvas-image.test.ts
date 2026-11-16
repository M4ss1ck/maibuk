import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasImageError, encodeCanvasImage } from "@/features/canvas/encodeCanvasImage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("encodeCanvasImage", () => {
  it("rejects a non-image Blob as a fetch error without fetching anything", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const error = await encodeCanvasImage(new Blob(["plain"], { type: "text/plain" })).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(CanvasImageError);
    expect(error).toMatchObject({ reason: "fetch" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
