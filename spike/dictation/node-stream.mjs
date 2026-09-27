// PROTOTYPE. Streams a 16-bit PCM WAV through the npm Moonshine WASM runtime in
// Node, chunk by chunk, and prints completed lines plus timing.
//   node spike/dictation/node-stream.mjs tiny-streaming-es audio.wav [chunkMs] [updateInterval]
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ModelArch, Transcriber } from "./vendor/moonshine-wasm/dist/index.js";

const [model, wavPath, chunkMsArg = "100", intervalArg = "0.5"] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "public/models", model);
const arch = model.startsWith("small") ? ModelArch.SmallStreaming : ModelArch.TinyStreaming;

function readWav(path) {
  const b = readFileSync(path);
  let off = 12, rate = 0, data;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === "fmt ") rate = b.readUInt32LE(off + 12);
    if (id === "data") data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size & 1);
  }
  const pcm = new Float32Array(data.length / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = data.readInt16LE(i * 2) / 32768;
  return { rate, pcm };
}

const files = {};
for (const f of readdirSync(dir)) files[f] = new Uint8Array(readFileSync(join(dir, f)));
let t0 = performance.now();
const transcriber = await Transcriber.load({ files, modelArch: arch });
const loadMs = performance.now() - t0;
const rssAfterLoad = process.memoryUsage().rss;

const { rate, pcm } = readWav(wavPath);
const stream = transcriber.createStream({ updateInterval: Number(intervalArg) });
const lines = [];
let firstText = null, audioPos = 0;
stream.addListener({
  onLineTextChanged: ({ line }) => { if (firstText === null) firstText = { audioSec: audioPos / rate, text: line.text }; },
  onLineCompleted: ({ line }) => lines.push(line),
  onError: ({ error }) => console.error("ERR", error),
});
stream.start();
const chunk = Math.round((rate * Number(chunkMsArg)) / 1000);
const passes = [];
let peakRss = rssAfterLoad;
t0 = performance.now();
for (audioPos = 0; audioPos < pcm.length; audioPos += chunk) {
  stream.addAudio(pcm.subarray(audioPos, audioPos + chunk), rate);
  const p = performance.now();
  stream.transcribe();
  passes.push(performance.now() - p);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}
stream.stop();
const wallMs = performance.now() - t0;
const audioSec = pcm.length / rate;
passes.sort((a, b) => a - b);
const pct = (q) => passes[Math.min(passes.length - 1, Math.floor(q * passes.length))].toFixed(1);
for (const l of lines) console.log(`[${l.startTime.toFixed(1)}s +${l.duration.toFixed(1)}s lat=${l.lastTranscriptionLatencyMs}ms] ${l.text}`);
console.log(JSON.stringify({
  model, audioSec: +audioSec.toFixed(1), loadMs: Math.round(loadMs), wallMs: Math.round(wallMs),
  computeLoadPct: +((100 * wallMs) / 1000 / audioSec).toFixed(1),
  passMs: { p50: pct(0.5), p95: pct(0.95), max: pct(1) },
  lineLatencyMs: lines.map((l) => l.lastTranscriptionLatencyMs),
  firstText, rssMB: { afterLoad: Math.round(rssAfterLoad / 1e6), peak: Math.round(peakRss / 1e6) },
}));
process.exit(0);
