import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("web headers", () => {
  const headers = readFileSync("public/_headers", "utf8");
  it("cross-origin isolates the web build for threaded dictation", () => {
    expect(headers).toMatch(/^\/\*\n(?:\s+.+\n)*\s+Cross-Origin-Opener-Policy: same-origin/m);
    expect(headers).toMatch(/Cross-Origin-Embedder-Policy: credentialless/);
  });
  it("keeps the /embed framing rule", () => {
    expect(headers).toMatch(
      /\/embed\n\s+Content-Security-Policy: frame-ancestors 'self' https:\/\/www\.massick\.dev/
    );
  });
});
