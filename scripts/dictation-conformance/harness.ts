// Web half of the dictation conformance lane: drives the PRODUCTION web host
// in a real browser and leaves a trace on window.__conformance.result. It owns
// no engine code; all timing is measured here, against the audio timeline.
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import type { DictationEvent } from "@/features/dictation/types";
import { cacheModelFiles } from "@/lib/platform/web/dictation/cache-model-files";
import { createWebRecognizerHost } from "@/lib/platform/web/dictation/host";

const TYPING_EVENTS = new Set(["keydown", "keyup", "keypress", "input", "beforeinput"]);

interface RawEvent {
  ts: number;
  type: "partial" | "final" | "stopped";
  text?: string;
  latencyMs?: number;
}

interface TraceEntry {
  firstTextAudio: number | null;
  completedAudio: number;
  finalLatencyMs: number | null;
  text: string;
}

interface ConformanceResult {
  backend: "web";
  model: string;
  language: string;
  audio: string;
  summary: {
    loadMs: number;
    cpuPctOfOneCore: null;
    longTasksOver50: number;
    typingEventMaxMs: number;
    contractViolations: string[];
  };
  events: { t: number; type: string; text?: string }[];
  trace: TraceEntry[];
}

const status = document.getElementById("status");

async function buildResult(modelId: string, audioSeconds: number): Promise<ConformanceResult> {
  const entry = MODEL_CATALOG.find((m) => m.id === modelId);
  if (!entry) throw new Error(`unknown model: ${modelId}`);
  // Same-origin copies served by the preview (web.mjs links them in). A
  // Playwright route.fulfill of the 82 MB Small decoder crashes the page.
  const spec = {
    ...entry,
    files: entry.files.map((file) => ({
      ...file,
      url: `/models/${entry.id}/${file.name}`,
    })),
  };

  if (status) status.textContent = `installing ${modelId}`;
  const controller = new AbortController();
  await cacheModelFiles.install(spec, () => {}, controller.signal);

  const host = createWebRecognizerHost();
  const support = await host.isSupported();
  if (!support.supported) throw new Error(`unsupported: ${JSON.stringify(support)}`);

  // The window opens at load, so loading the model counts against the bar.
  // buffered replays entries from before (the one-time model install), which
  // the window filters out: the bar is about dictating, not downloading.
  const runStart = performance.now();
  const loadStart = runStart;
  await host.load(spec);
  const loadMs = performance.now() - loadStart;

  const longTasks: PerformanceEntry[] = [];
  const longTaskObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.startTime >= runStart) longTasks.push(entry);
  });
  longTaskObserver.observe({ type: "longtask", buffered: true });
  const typingEvents: PerformanceEventTiming[] = [];
  const eventObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as PerformanceEventTiming[])
      if (TYPING_EVENTS.has(entry.name) && entry.startTime >= runStart) typingEvents.push(entry);
  });
  eventObserver.observe({
    type: "event",
    durationThreshold: 16,
    buffered: true,
  } as PerformanceObserverInit);

  const raw: RawEvent[] = [];
  const violations: string[] = [];
  // Audio t0 is the moment the first 100 ms chunk starts playing: the first
  // "level" event is emitted when that chunk arrives, 0.1 s after it began.
  let audioT0: number | null = null;
  let stopped = false;
  let lastFinalText: string | null = null;

  const listener = (event: DictationEvent) => {
    const ts = performance.now();
    if (stopped) {
      violations.push(`event after stopped: ${event.type}`);
      return;
    }
    if (event.type === "level") {
      if (audioT0 === null) audioT0 = ts - 100;
      return; // level events are raw and not part of the trace
    }
    if (event.type === "error") {
      violations.push(`error event: ${event.code}`);
      return;
    }
    if (event.type === "final") {
      if (lastFinalText !== null && event.text !== "" && event.text === lastFinalText)
        violations.push(`repeated final: ${event.text}`);
      lastFinalText = event.text;
      raw.push({ ts, type: "final", text: event.text, latencyMs: event.latencyMs });
      return;
    }
    raw.push({ ts, type: "partial", text: event.text });
  };

  await host.start(listener);
  await new Promise((resolve) => setTimeout(resolve, (audioSeconds + 1.5) * 1000));
  await host.stop();
  // stop() resolving means the stream ended: the stopped event is at this time.
  const stoppedAt = performance.now();
  stopped = true;
  raw.push({ ts: stoppedAt, type: "stopped" });
  await host.dispose();
  longTaskObserver.disconnect();
  eventObserver.disconnect();

  const origin = audioT0 ?? 0;
  const t = (ts: number) => Number(((ts - origin) / 1000).toFixed(3));

  const events = raw.map((event) =>
    event.type === "stopped"
      ? { t: t(event.ts), type: "stopped" }
      : { t: t(event.ts), type: event.type, text: event.text }
  );

  const trace: TraceEntry[] = [];
  let pendingFirstText: number | null = null;
  for (const event of raw) {
    if (event.type === "partial") {
      if (pendingFirstText === null) pendingFirstText = t(event.ts);
    } else if (event.type === "final") {
      trace.push({
        firstTextAudio: pendingFirstText,
        completedAudio: t(event.ts),
        finalLatencyMs: event.latencyMs ?? null,
        text: event.text ?? "",
      });
      pendingFirstText = null;
    }
  }

  const longTasksOver50 = longTasks.filter((entry) => entry.duration > 50).length;
  const typingEventMaxMs = typingEvents.length
    ? Number(Math.max(...typingEvents.map((entry) => entry.duration)).toFixed(2))
    : 0;

  return {
    backend: "web",
    model: spec.id,
    language: spec.languages[0],
    audio: spec.languages[0] === "es" ? "quijote_es_16k.wav" : "two_cities_16k.wav",
    summary: {
      loadMs: Math.round(loadMs),
      cpuPctOfOneCore: null,
      longTasksOver50,
      typingEventMaxMs,
      contractViolations: violations,
    },
    events,
    trace,
  };
}

const conformance = {
  result: null as ConformanceResult | null,
  async run(modelId: string, audioSeconds = 0): Promise<void> {
    conformance.result = await buildResult(modelId, audioSeconds);
  },
};

declare global {
  interface Window {
    __conformance: typeof conformance;
  }
}

window.__conformance = conformance;
