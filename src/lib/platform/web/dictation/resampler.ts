// To 16 kHz mono for every engine. Downsampling averages each output
// sample's input span (a box filter); upsampling interpolates linearly. The
// Rust backend implements the same algorithm (shared fixture:
// src/test/fixtures/dictation/resampler.json).
export interface Resampler {
  push(input: Float32Array): Float32Array;
}

export function createResampler(inRate: number, outRate = 16000): Resampler {
  if (inRate === outRate) return { push: (input) => input };
  const step = inRate / outRate;
  let pos = 0;
  let carry = new Float32Array(0);
  return {
    push(input) {
      const buf = new Float32Array(carry.length + input.length);
      buf.set(carry);
      buf.set(input, carry.length);
      const out: number[] = [];
      if (step > 1) {
        while (pos + step <= buf.length) {
          const a = Math.floor(pos);
          const b = Math.floor(pos + step);
          let sum = 0;
          for (let i = a; i < b; i++) sum += buf[i];
          out.push(sum / (b - a));
          pos += step;
        }
      } else {
        while (pos + 1 < buf.length) {
          const i = Math.floor(pos);
          const f = pos - i;
          out.push(buf[i] * (1 - f) + buf[i + 1] * f);
          pos += step;
        }
      }
      const drop = Math.floor(pos);
      carry = buf.slice(drop);
      pos -= drop;
      return Float32Array.from(out);
    },
  };
}
