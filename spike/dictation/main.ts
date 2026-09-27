// PROTOTYPE. Voice-dictation spike page. Throwaway; lives on the
// spike-voice-dictation branch and never merges.
//
// Capture: an AudioWorklet batches ~100 ms of mono PCM and posts it over a
// MessageChannel straight to dictation-worker.ts, which owns Moonshine. The
// page only receives line events (text).
import type { TranscriptLine } from "moonshine";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const UPDATE_INTERVAL = Number(params.get("interval") ?? "0.5");
const CHUNK_MS = 100;
// Transcriber options, e.g. ?opt.vad_window_duration=0.25
const OPTIONS = Object.fromEntries([...params].filter(([k]) => k.startsWith("opt.")).map(([k, v]) => [k.slice(4), v]));
const MODEL_FILES = [
  "adapter.ort",
  "cross_kv.ort",
  "decoder_kv.ort",
  "encoder.ort",
  "frontend.model.ort",
  "frontend.weights.ort",
  "streaming_config.json",
  "tokenizer.bin",
];

const now = () => performance.timeOrigin + performance.now();
const log: string[] = [];
function note(msg: string) {
  log.push(`${(performance.now() / 1000).toFixed(2)} ${msg}`);
  console.log(msg);
}

$("env").innerHTML = [
  `crossOriginIsolated=<b>${crossOriginIsolated}</b>`,
  `SharedArrayBuffer=<b>${typeof SharedArrayBuffer !== "undefined"}</b>`,
  `hardwareConcurrency=${navigator.hardwareConcurrency}`,
].join(" · ");
if (!crossOriginIsolated) $("env").classList.add("warn");

// ---------- measurements ----------
const longTasks: { start: number; duration: number }[] = [];
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) longTasks.push({ start: e.startTime, duration: e.duration });
}).observe({ type: "longtask", buffered: true });

// Event Timing reports only events of 16 ms or more (the API minimum), so an
// empty list means every key event finished in under 16 ms.
const keyEvents: { start: number; duration: number; inputDelay: number }[] = [];
new PerformanceObserver((list) => {
  for (const e of list.getEntries() as PerformanceEventTiming[]) {
    if (!["keydown", "keypress", "keyup", "input", "beforeinput"].includes(e.name)) continue;
    keyEvents.push({ start: e.startTime, duration: e.duration, inputDelay: e.processingStart - e.startTime });
  }
}).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
let keyCount = 0;
$("typing").addEventListener("keydown", () => keyCount++);

const memory: number[] = [];
async function sampleMemory() {
  const perf = performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> };
  if (!crossOriginIsolated || !perf.measureUserAgentSpecificMemory) return;
  try {
    memory.push((await perf.measureUserAgentSpecificMemory()).bytes);
  } catch (e) {
    note(`memory sample failed: ${e}`);
  }
}

const lines: TranscriptLine[] = [];
// Per line, in stream seconds: where the engine put it, and how much audio the
// worker had received when its first text and its completion arrived.
const lineTrace = new Map<string, { start: number; duration: number; firstTextAudio?: number; completedAudio?: number; text?: string }>();
const firstPartial: number[] = [];
const final: number[] = [];
const engineFinal: number[] = [];
const bridgeMs: number[] = [];
const passMs: number[] = [];
let audioSec = 0;
let loadMs = 0;
let windowStart = 0;
let windowEnd = 0;

function pct(xs: number[], q: number) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1);
}

function summarize() {
  const inWindow = (t: number) => t >= windowStart && (windowEnd === 0 || t <= windowEnd);
  const lt = longTasks.filter((t) => inWindow(t.start));
  const keys = keyEvents.filter((k) => inWindow(k.start));
  const wallSec = ((windowEnd || performance.now()) - windowStart) / 1000;
  return {
    crossOriginIsolated,
    loadMs: Math.round(loadMs),
    audioSec: +audioSec.toFixed(1),
    lines: lines.length,
    firstPartialMs: { p50: pct(firstPartial, 0.5), p95: pct(firstPartial, 0.95), n: firstPartial.length },
    finalMs: { p50: pct(final, 0.5), p95: pct(final, 0.95), n: final.length },
    engineFinalMs: { p50: pct(engineFinal, 0.5), p95: pct(engineFinal, 0.95) },
    workerToPageMs: { p50: pct(bridgeMs, 0.5), max: pct(bridgeMs, 1) },
    workerPassMs: { p50: pct(passMs, 0.5), p95: pct(passMs, 0.95), max: pct(passMs, 1), n: passMs.length },
    workerComputePct: wallSec > 0 ? +((passMs.reduce((a, b) => a + b, 0) / 1000 / wallSec) * 100).toFixed(1) : null,
    longTasks: { count: lt.length, over50: lt.filter((t) => t.duration > 50).length, max: pct(lt.map((t) => t.duration), 1) },
    typing: {
      keys: keyCount,
      eventsOver16ms: keys.length,
      durationMax: pct(keys.map((k) => k.duration), 1),
      inputDelayMax: pct(keys.map((k) => k.inputDelay), 1),
    },
    memoryMB: memory.length
      ? { first: Math.round(memory[0] / 1e6), peak: Math.round(Math.max(...memory) / 1e6) }
      : null,
  };
}
const render = () => ($("stats").textContent = JSON.stringify(summarize(), null, 2));

// ---------- worker ----------
const worker = new Worker(new URL("./dictation-worker.ts", import.meta.url), { type: "module" });
const waiters = new Map<string, (v: unknown) => void>();
const waitFor = (type: string) => new Promise((r) => waiters.set(type, r));

worker.onmessage = (e: MessageEvent) => {
  const m = e.data;
  waiters.get(m.type)?.(m);
  waiters.delete(m.type);
  switch (m.type) {
    case "loaded":
      loadMs = m.ms;
      note(`loaded in ${Math.round(m.ms)} ms`);
      break;
    case "pass":
      passMs.push(m.ms);
      break;
    case "stopped":
      audioSec = m.audioSec;
      break;
    case "error":
      note(`worker error: ${m.message}`);
      window.__spike.errors.push(m.message);
      break;
    case "event": {
      bridgeMs.push(now() - m.at);
      const line = m.line as TranscriptLine;
      if (m.firstPartialMs !== undefined) firstPartial.push(m.firstPartialMs);
      const tr = lineTrace.get(line.id) ?? { start: line.startTime, duration: line.duration };
      if (m.firstPartialMs !== undefined) tr.firstTextAudio = m.audioAt;
      if (m.name === "onLineCompleted") Object.assign(tr, { completedAudio: m.audioAt, start: line.startTime, duration: line.duration, text: line.text });
      lineTrace.set(line.id, tr);
      if (m.name === "onLineTextChanged") $("live").textContent = line.text;
      if (m.name === "onLineCompleted") {
        final.push(m.finalMs);
        engineFinal.push(line.lastTranscriptionLatencyMs);
        lines.push(line);
        const p = document.createElement("p");
        p.textContent = line.text;
        $("transcript").append(p);
        $("live").textContent = "";
      }
      break;
    }
  }
};
worker.onerror = (e) => {
  note(`worker failed: ${e.message}`);
  window.__spike.errors.push(e.message || "worker failed");
};

async function load(model: string) {
  const files = Object.fromEntries(MODEL_FILES.map((n) => [n, new URL(`models/${model}/${n}`, location.href).href]));
  worker.postMessage({ type: "load", model, files, interval: UPDATE_INTERVAL, options: OPTIONS });
  await Promise.race([waitFor("loaded"), waitFor("error").then((m) => Promise.reject(new Error((m as { message: string }).message)))]);
  window.__spike.state = "loaded";
}

// ---------- capture ----------
const WORKLET = `
class Chunker extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    this.size = opts.processorOptions.size; this.buf = new Float32Array(this.size); this.n = 0; this.out = null;
    this.port.onmessage = (e) => { this.out = e.data.port; };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && this.out) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.size) { this.out.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(this.size); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("chunker", Chunker);`;

let ctx: AudioContext | null = null;
let memTimer = 0;

async function start(source: string) {
  ctx = new AudioContext();
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" })));
  const node = new AudioWorkletNode(ctx, "chunker", {
    processorOptions: { size: Math.round((ctx.sampleRate * CHUNK_MS) / 1000) },
    channelCount: 1,
    channelCountMode: "explicit",
  });
  const channel = new MessageChannel();
  node.port.postMessage({ port: channel.port1 }, [channel.port1]);
  worker.postMessage({ type: "audio-port", port: channel.port2, sampleRate: ctx.sampleRate }, [channel.port2]);
  worker.postMessage({ type: "start" });
  await waitFor("started");
  windowStart = performance.now();
  windowEnd = 0;
  // Keep the graph pulling without audible output.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);
  if (source === "mic") {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    ctx.createMediaStreamSource(media).connect(node);
  } else {
    const buf = await ctx.decodeAudioData(await (await fetch(source)).arrayBuffer());
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(node);
    src.onended = () => {
      note("file ended");
      window.__spike.state = "ended";
    };
    src.start();
  }
  memTimer = window.setInterval(sampleMemory, 5000);
  void sampleMemory();
  window.__spike.state = "running";
  note(`started ${source} at ${ctx.sampleRate} Hz`);
}

async function stop() {
  window.clearInterval(memTimer);
  await ctx?.close();
  ctx = null;
  worker.postMessage({ type: "stop" });
  await waitFor("stopped");
  windowEnd = performance.now();
  await sampleMemory();
  render();
  window.__spike.state = "stopped";
}

function reset() {
  lineTrace.clear();
  for (const a of [lines, firstPartial, final, engineFinal, bridgeMs, passMs, longTasks, keyEvents, memory]) a.length = 0;
  keyCount = 0;
  audioSec = 0;
  $("transcript").textContent = "";
}

declare global {
  interface Window {
    __spike: {
      state: string;
      errors: string[];
      load: typeof load;
      start: typeof start;
      stop: typeof stop;
      summary: typeof summarize;
      reset: typeof reset;
      lines: TranscriptLine[];
      trace: () => unknown[];
      log: string[];
      markWindow: (edge: "start" | "end") => void;
    };
  }
}
function markWindow(edge: "start" | "end") {
  if (edge === "start") {
    windowStart = performance.now();
    windowEnd = 0;
  } else windowEnd = performance.now();
}
window.__spike = { state: "idle", errors: [], load, start, stop, summary: summarize, reset, lines, trace: () => [...lineTrace.values()], log, markWindow };
if ("__TAURI_INTERNALS__" in window) void import("./native");

$("load").addEventListener("click", async () => {
  await load($<HTMLSelectElement>("model").value);
  $<HTMLButtonElement>("start").disabled = false;
});
$("start").addEventListener("click", async () => {
  await start($<HTMLSelectElement>("source").value);
  $<HTMLButtonElement>("stop").disabled = false;
});
$("stop").addEventListener("click", () => void stop());
setInterval(render, 1000);
