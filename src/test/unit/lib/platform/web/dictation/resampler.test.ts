import { describe, expect, it } from "vitest";
import cases from "@/test/fixtures/dictation/resampler.json";
import { createResampler } from "@/lib/platform/web/dictation/resampler";

describe("createResampler()", () => {
  it.each(cases)(
    "matches the shared reference at $inRate Hz, fed in chunks",
    ({ inRate, input, chunks, output }) => {
      const r = createResampler(inRate);
      const a = r.push(Float32Array.from(input.slice(0, chunks[0])));
      const b = r.push(Float32Array.from(input.slice(chunks[0])));
      const got = [...a, ...b];
      expect(got.length).toBe(output.length);
      got.forEach((v, i) => {
        expect(v).toBeCloseTo(output[i], 5);
      });
    },
  );

  it("keeps a constant signal constant when downsampling 48 kHz", () => {
    const out = createResampler(48000).push(new Float32Array(4800).fill(0.25));
    expect(out.length).toBe(1600);
    expect(out.every((v) => Math.abs(v - 0.25) < 1e-6)).toBe(true);
  });
});
