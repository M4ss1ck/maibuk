// The in-page frame probe (issue #372), installed before the app boots with
// Playwright's addInitScript. It records, while a measured window is open:
//   - every requestAnimationFrame timestamp, when the run asks for the rAF
//     source (engines with no tracing protocol: WebKit, WebKitGTK);
//   - each keystroke and the moment the first frame after it starts, which is
//     when the keystroke's DOM change begins to render;
//   - long animation frames with their script attribution, where the engine
//     has the Long Animation Frames API (Chromium, Android WebView).
// It also measures the rAF cadence of a quiet page, from which the probe
// source reads the refresh interval.
//
// `installFrameProbe` is serialized into the page, so it must not reference
// anything outside its own body.

export interface ProbeLongAnimationFrame {
  startTime: number;
  duration: number;
  blockingDuration?: number;
  scripts: {
    invoker: string;
    sourceURL: string;
    sourceFunctionName: string;
    sourceCharPosition?: number;
    duration: number;
  }[];
}

export interface ProbeDump {
  userAgent: string;
  /** Whether the engine reports long animation frames. */
  loafSupported: boolean;
  /** rAF timestamps of the measured window; empty unless `raf` was asked for. */
  rafTimestamps: number[];
  inputs: { atMs: number; nextFrameMs: number }[];
  longAnimationFrames: ProbeLongAnimationFrame[];
}

export interface FrameProbe {
  /** rAF frame-to-frame deltas of a page that is doing nothing else. */
  calibrate(durationMs: number): Promise<number[]>;
  start(options: { raf: boolean }): void;
  stop(): Promise<ProbeDump>;
}

declare global {
  interface Window {
    __maibukFrameProbe?: FrameProbe;
  }
}

export function installFrameProbe(): void {
  type Loaf = ProbeLongAnimationFrame;
  let recording = false;
  let rafLoop = false;
  let rafTimestamps: number[] = [];
  let inputs: { atMs: number; nextFrameMs: number }[] = [];
  let longAnimationFrames: Loaf[] = [];
  let pendingInputs = 0;

  const loafSupported =
    typeof PerformanceObserver !== "undefined" &&
    (PerformanceObserver.supportedEntryTypes ?? []).includes("long-animation-frame");
  if (loafSupported) {
    new PerformanceObserver((list) => {
      if (!recording) return;
      for (const entry of list.getEntries() as unknown as (Loaf & {
        scripts: (Loaf["scripts"][number] & Record<string, unknown>)[];
      })[]) {
        longAnimationFrames.push({
          startTime: entry.startTime,
          duration: entry.duration,
          blockingDuration: entry.blockingDuration,
          scripts: entry.scripts.map((script) => ({
            invoker: String(script.invoker ?? ""),
            sourceURL: String(script.sourceURL ?? ""),
            sourceFunctionName: String(script.sourceFunctionName ?? ""),
            sourceCharPosition: Number(script.sourceCharPosition ?? -1),
            duration: Number(script.duration ?? 0),
          })),
        });
      }
    }).observe({ type: "long-animation-frame", buffered: false });
  }

  window.addEventListener(
    "keydown",
    (event) => {
      if (!recording) return;
      const atMs = event.timeStamp;
      pendingInputs++;
      requestAnimationFrame(() => {
        pendingInputs--;
        if (recording) inputs.push({ atMs, nextFrameMs: performance.now() });
      });
    },
    { capture: true }
  );

  const tick = (timestamp: number) => {
    if (!rafLoop) return;
    rafTimestamps.push(timestamp);
    requestAnimationFrame(tick);
  };

  const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

  window.__maibukFrameProbe = {
    async calibrate(durationMs) {
      const stamps: number[] = [];
      const end = performance.now() + durationMs;
      while (performance.now() < end) stamps.push(await nextFrame());
      return stamps.slice(1).map((stamp, i) => stamp - stamps[i]);
    },
    start({ raf }) {
      rafTimestamps = [];
      inputs = [];
      longAnimationFrames = [];
      recording = true;
      rafLoop = raf;
      if (raf) requestAnimationFrame(tick);
    },
    async stop() {
      rafLoop = false;
      // Let the last keystroke's frame and any queued LoAF entry land.
      for (let i = 0; i < 5 && pendingInputs > 0; i++) await nextFrame();
      await nextFrame();
      await new Promise((resolve) => setTimeout(resolve, 100));
      recording = false;
      return {
        userAgent: navigator.userAgent,
        loafSupported,
        rafTimestamps,
        inputs,
        longAnimationFrames,
      };
    },
  };
}

/**
 * The probe as an init script. esbuild's keepNames (tsx, Vite SSR) wraps
 * named functions in a `__name` helper that does not exist in the page, so
 * the serialized function gets a no-op one.
 */
export function frameProbeScript(): string {
  return `var __name = (fn) => fn;\n(${installFrameProbe.toString()})();`;
}
