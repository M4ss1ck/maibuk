import { describe, expect, it } from "vitest";
import { DOWNLOAD_PAGE } from "@/constants";

describe("constants", () => {
  it("DOWNLOAD_PAGE points to GitHub releases", () => {
    expect(DOWNLOAD_PAGE).toBe("https://github.com/M4ss1ck/maibuk/releases");
  });

  it("DOWNLOAD_PAGE is a valid URL", () => {
    expect(() => new URL(DOWNLOAD_PAGE)).not.toThrow();
  });
});
