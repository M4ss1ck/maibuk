import { describe, expect, it } from "vitest";
import { RUNTIMES } from "../../../../scripts/fetch-dictation-runtime.mjs";

describe("fetch-dictation-runtime pins", () => {
  it("pins both Moonshine v0.1.5 tarballs by SHA-256", () => {
    expect(RUNTIMES).toEqual([
      {
        name: "wasm",
        url: "https://github.com/moonshine-ai/moonshine/releases/download/v0.1.5/moonshine-voice-wasm.tar.gz",
        sha256:
          "c515bf7691e12048f70a92cc82b3b0894c16c3773ffcacb7d48944fb150e4837",
        stripComponents: 0,
      },
      {
        name: "linux-x86_64",
        url: "https://github.com/moonshine-ai/moonshine/releases/download/v0.1.5/moonshine-voice-linux-x86_64.tar.gz",
        sha256:
          "9c3a87fea93ff2ad957938868f95a0a366dce9ff8ad86bde6cdcf5a4cadb51df",
        stripComponents: 1,
      },
    ]);
  });
});
