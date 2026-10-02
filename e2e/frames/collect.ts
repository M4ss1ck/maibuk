// Frame collectors (issue #372): one per source, each turning a measured
// window into the normalized sample set the Frame Report judges.
//
//   chromium  CDP trace of the compositor's frames, plus the probe's
//             keystroke and long-animation-frame records;
//   probe     the probe's own rAF recorder (WebKit and other engines with no
//             tracing protocol), refresh interval from a quiet-page cadence;
//   android   the system's `dumpsys gfxinfo framestats`, refresh period from
//             SurfaceFlinger, plus the probe's records from the WebView.

import type { CDPSession, Page } from "@playwright/test";
import type { FrameSampleSet } from "@/test/support/frames/frame-report";
import type { ProbeDump } from "@/test/support/frames/probe";
import {
  parseGfxinfoFramestats,
  parseSurfaceFlingerLatency,
} from "@/test/support/frames/sources/android-gfxinfo";
import { parseChromiumTrace, type TraceEvent } from "@/test/support/frames/sources/chromium-trace";
import {
  parseProbeDump,
  probeInputsAndLongFrames,
  refreshIntervalFromCadence,
} from "@/test/support/frames/sources/raf-probe";
import type { AndroidDevice } from "./android";

/** The source's own output for one run, saved by `--raw`. */
export type RawCapture =
  | { kind: "trace"; events: TraceEvent[] }
  | { kind: "framestats"; dumps: string[] }
  | { kind: "probe"; dump: ProbeDump; calibration?: number[] };

export interface FrameCollector {
  /** Once per scenario, after the warm-up. */
  prepare(page: Page): Promise<void>;
  begin(page: Page): Promise<void>;
  end(page: Page): Promise<FrameSampleSet>;
  /** Where the refresh interval came from, for the report's environment. */
  refreshSource: string;
  /** The last run's raw capture. */
  raw(): RawCapture | null;
}

async function startProbe(page: Page, raf: boolean): Promise<void> {
  await page.evaluate((raf) => {
    if (!window.__maibukFrameProbe) throw new Error("frame probe not installed");
    window.__maibukFrameProbe.start({ raf });
  }, raf);
}

async function stopProbe(page: Page): Promise<ProbeDump> {
  return page.evaluate(() => window.__maibukFrameProbe!.stop());
}

/** The trace category DevTools' Frames track reads; PipelineReporter lives here. */
const FRAME_CATEGORIES = ["disabled-by-default-devtools.timeline.frame"];

export function chromiumCollector(cpuThrottling: number): FrameCollector {
  let cdp: CDPSession | null = null;
  let events: TraceEvent[] = [];
  return {
    refreshSource: "trace",
    raw: () => ({ kind: "trace", events }),
    async prepare(page) {
      cdp = await page.context().newCDPSession(page);
      cdp.on("Tracing.dataCollected", (data) => {
        // Playwright types the events as string maps; they are trace events.
        events.push(...(data.value as unknown as TraceEvent[]));
      });
      if (cpuThrottling > 1) {
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottling });
      }
    },
    async begin(page) {
      events = [];
      await startProbe(page, false);
      await cdp!.send("Tracing.start", {
        traceConfig: { includedCategories: FRAME_CATEGORIES },
        transferMode: "ReportEvents",
      });
    },
    async end(page) {
      const dump = await stopProbe(page);
      const done = new Promise((resolve) => cdp!.once("Tracing.tracingComplete", resolve));
      await cdp!.send("Tracing.end");
      await done;
      const trace = parseChromiumTrace(events);
      return {
        refreshIntervalMs: trace.refreshIntervalMs,
        frames: trace.frames,
        ...probeInputsAndLongFrames(dump),
      };
    },
  };
}

/** How long a quiet page draws to establish its refresh interval. */
const CALIBRATION_MS = 1500;

export function probeCollector(): FrameCollector {
  let refreshIntervalMs = 0;
  let calibration: number[] = [];
  let last: ProbeDump | null = null;
  return {
    refreshSource: "raf-cadence",
    raw: () => (last ? { kind: "probe", dump: last, calibration } : null),
    async prepare(page) {
      calibration = await page.evaluate(
        (ms) => window.__maibukFrameProbe!.calibrate(ms),
        CALIBRATION_MS
      );
      refreshIntervalMs = refreshIntervalFromCadence(calibration);
    },
    async begin(page) {
      await startProbe(page, true);
    },
    async end(page) {
      last = await stopProbe(page);
      return parseProbeDump(last, refreshIntervalMs);
    },
  };
}

/** framestats keeps the last 120 frames; read it well before that fills at 120 Hz. */
const GFXINFO_POLL_MS = 500;

export function androidCollector(device: AndroidDevice): FrameCollector {
  let refreshIntervalMs = 0;
  let dumps: string[] = [];
  let polling: Promise<void> | null = null;
  let stop = false;
  return {
    refreshSource: "surfaceflinger",
    raw: () => ({ kind: "framestats", dumps }),
    async prepare() {
      refreshIntervalMs = parseSurfaceFlingerLatency(
        await device.shell(["dumpsys", "SurfaceFlinger", "--latency"])
      );
    },
    async begin(page) {
      dumps = [];
      stop = false;
      await device.shell(["dumpsys", "gfxinfo", device.packageName, "reset"]);
      await startProbe(page, false);
      polling = (async () => {
        while (!stop) {
          dumps.push(await device.shell(["dumpsys", "gfxinfo", device.packageName, "framestats"]));
          await new Promise((resolve) => setTimeout(resolve, GFXINFO_POLL_MS));
        }
      })();
    },
    async end(page) {
      const dump = await stopProbe(page);
      stop = true;
      await polling;
      dumps.push(await device.shell(["dumpsys", "gfxinfo", device.packageName, "framestats"]));
      return {
        refreshIntervalMs,
        frames: parseGfxinfoFramestats(dumps).frames,
        ...probeInputsAndLongFrames(dump),
      };
    },
  };
}
