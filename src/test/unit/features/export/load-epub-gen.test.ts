import { describe, expect, it } from "vitest";
import { loadEpubGen } from "@/features/export/load-epub-gen";

describe("loadEpubGen()", () => {
  it("returns the epub-gen-memory function and restores SharedArrayBuffer as a writable data property", async () => {
    const real = globalThis.SharedArrayBuffer;

    const epub = await loadEpubGen();

    expect(typeof epub).toBe("function");
    expect(globalThis.SharedArrayBuffer).toBe(real);
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "SharedArrayBuffer");
    expect(descriptor?.writable).toBe(true);
  });
});
