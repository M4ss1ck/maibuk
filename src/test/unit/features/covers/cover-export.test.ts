import { describe, expect, it } from "vitest";
import { exportMultiplier, dataUrlToBytes } from "../../../../features/covers/export";

describe("exportMultiplier", () => {
  it("is 1 when target equals design dpi", () => {
    expect(exportMultiplier(300, 300)).toBe(1);
  });
  it("scales up for higher target dpi", () => {
    expect(exportMultiplier(300, 600)).toBe(2);
  });
  it("falls back to 1 for invalid input", () => {
    expect(exportMultiplier(0, 300)).toBe(1);
    expect(exportMultiplier(300, 0)).toBe(1);
  });
});

describe("dataUrlToBytes", () => {
  it("decodes a base64 data url to bytes", () => {
    // "Hi" -> base64 "SGk="
    const bytes = dataUrlToBytes("data:text/plain;base64,SGk=");
    expect(Array.from(bytes)).toEqual([72, 105]);
  });
});
