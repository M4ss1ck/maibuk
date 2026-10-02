// @vitest-environment node
// Each source parser against a captured real-world fixture
// (src/test/fixtures/frames/), plus malformed and empty input.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FrameReportRefused } from "@/test/support/frames/frame-report";
import type { ProbeDump } from "@/test/support/frames/probe";
import {
  parseGfxinfoFramestats,
  parseSurfaceFlingerLatency,
} from "@/test/support/frames/sources/android-gfxinfo";
import { parseChromiumTrace, type TraceEvent } from "@/test/support/frames/sources/chromium-trace";
import {
  parseProbeDump,
  refreshIntervalFromCadence,
} from "@/test/support/frames/sources/raf-probe";

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../fixtures/frames/${name}`, import.meta.url)),
    "utf8"
  );
}

describe("Chromium trace", () => {
  // Headless Chromium 1243 tracing a page whose rAF loop blocks the main
  // thread for 60 ms every 40 frames: vsync slots 1..89 of the renderer.
  const events = JSON.parse(fixture("chromium-trace-blocking-page.json")) as TraceEvent[];

  it("reads the refresh interval from the compositor's BeginFrame spacing", () => {
    expect(parseChromiumTrace(events).refreshIntervalMs).toBeCloseTo(16.667, 2);
  });

  it("reads the renderer's frames, not the browser UI's", () => {
    const { rendererPid, states } = parseChromiumTrace(events);
    expect(rendererPid).toBe(3455241);
    expect(states).toEqual({
      STATE_PRESENTED_ALL: 85,
      STATE_PRESENTED_PARTIAL: 45,
      STATE_DROPPED: 5,
    });
  });

  it("turns each 60 ms block into one long frame and accounts for every vsync slot", () => {
    const { frames, refreshIntervalMs } = parseChromiumTrace(events);
    const slots = frames.map((frame) => Math.round(frame.durationMs / refreshIntervalMs));
    // Slots 41-42 and 83-84 were dropped outright; the blocks land in the
    // frames presented at slots 43 (4 slots since 39) and 85 (3 since 82).
    expect(slots.filter((n) => n > 1)).toEqual([4, 3]);
    expect(slots.reduce((sum, n) => sum + n, 0)).toBe(89);
    expect(frames).toHaveLength(84);
  });

  it("keeps a late main frame that still lands every vsync at one slot per frame", () => {
    // After the first block Chromium presents each main frame one vsync late
    // (a PARTIAL and an ALL per slot) without missing a vsync.
    const { frames, refreshIntervalMs } = parseChromiumTrace(events);
    const between = frames.slice(45, 75).map((f) => Math.round(f.durationMs / refreshIntervalMs));
    expect(new Set(between)).toEqual(new Set([1]));
  });

  it("starts the first frame after an idle gap from the slot it was asked for", () => {
    const base = 1_000_000;
    const slot = (seq: number, state: string, beginUs: number, endUs: number): TraceEvent[] => [
      {
        name: "PipelineReporter",
        ph: "b",
        pid: 7,
        ts: beginUs,
        id2: { local: `0x${seq}${state}` },
        args: { frame_reporter: { frame_sequence: seq, state } },
      },
      { name: "PipelineReporter", ph: "e", pid: 7, ts: endUs, id2: { local: `0x${seq}${state}` } },
    ];
    const at = (seq: number) => base + seq * 16_667;
    const trace: TraceEvent[] = [
      { name: "process_name", ph: "M", pid: 7, ts: 0, args: { name: "Renderer" } },
      // Twelve steady slots, an idle gap (no reporters for 13-49), then a
      // keystroke whose frame drops slot 50 and presents at 51.
      ...Array.from({ length: 12 }, (_, i) =>
        slot(i + 1, "STATE_PRESENTED_ALL", at(i + 1), at(i + 1) + 2000)
      ).flat(),
      ...slot(50, "STATE_DROPPED", at(50), at(51)),
      ...slot(51, "STATE_PRESENTED_ALL", at(51), at(51) + 2000),
    ];
    const { frames } = parseChromiumTrace(trace);
    expect(frames.map((f) => Math.round(f.durationMs / 16.667))).toEqual([...Array(12).fill(1), 2]);
  });

  it("counts slots dropped before an idle gap as a dropped frame, never as nothing", () => {
    const base = 1_000_000;
    const at = (seq: number) => base + seq * 16_667;
    const slot = (seq: number, state: string, n = 0): TraceEvent[] => [
      {
        name: "PipelineReporter",
        ph: "b",
        pid: 7,
        ts: at(seq),
        id2: { local: `0x${seq}-${n}` },
        args: { frame_reporter: { frame_sequence: seq, state } },
      },
      {
        name: "PipelineReporter",
        ph: "e",
        pid: 7,
        ts: at(seq) + 6000,
        id2: { local: `0x${seq}-${n}` },
      },
    ];
    const trace: TraceEvent[] = [
      { name: "process_name", ph: "M", pid: 7, ts: 0, args: { name: "Renderer" } },
      ...Array.from({ length: 12 }, (_, i) => slot(i + 1, "STATE_PRESENTED_ALL")).flat(),
      // A keystroke at slot 30 whose frames are dropped twice, then nothing
      // more is wanted: its update never reached the screen on its own.
      ...slot(30, "STATE_DROPPED"),
      ...slot(30, "STATE_DROPPED", 1),
      ...slot(31, "STATE_DROPPED"),
      ...slot(32, "STATE_NO_UPDATE_DESIRED"),
      ...slot(40, "STATE_PRESENTED_ALL"),
    ];
    const { frames } = parseChromiumTrace(trace);
    expect(frames.map((f) => Math.round(f.durationMs / 16.667))).toEqual([
      ...Array(12).fill(1),
      3,
      1,
    ]);
    expect(frames[12].startMs).toBeCloseTo(at(30) / 1000, 3);
  });

  it("refuses a trace without the frame category or with too few slots", () => {
    expect(() => parseChromiumTrace([])).toThrow(/PipelineReporter/);
    expect(() => parseChromiumTrace(events.filter((e) => e.name !== "process_name"))).toThrow(
      FrameReportRefused
    );
    const few = events.filter(
      (e) =>
        e.name !== "PipelineReporter" ||
        (e.args?.frame_reporter?.frame_sequence ?? 99) < 5 ||
        e.ph === "e"
    );
    expect(() => parseChromiumTrace(few)).toThrow(/refresh interval/);
    expect(() => parseChromiumTrace("nope" as unknown as TraceEvent[])).toThrow(FrameReportRefused);
  });
});

describe("Chromium trace of the app, typing on a 180 Hz display", () => {
  // Headed Chromium 151, the typing scenario on the perfLongChapter seed,
  // vsync slots 1760-1829. Each keystroke's frame misses its own slot
  // (DROPPED) and lands with the next one; at 1827 the frame is dropped twice
  // and nothing presents before the page goes idle.
  const events = JSON.parse(fixture("chromium-trace-typing-180hz.json")) as TraceEvent[];

  it("reads 180 Hz from the BeginFrame spacing, not 60", () => {
    expect(parseChromiumTrace(events).refreshIntervalMs).toBeCloseTo(1000 / 180, 2);
  });

  it("gives each keystroke one frame spanning the slots it took", () => {
    const { frames, refreshIntervalMs } = parseChromiumTrace(events);
    expect(frames.map((f) => Math.round(f.durationMs / refreshIntervalMs))).toEqual([
      2, 3, 2, 2, 3, 3,
    ]);
  });
});

describe("Android gfxinfo framestats", () => {
  // `dumpsys gfxinfo com.massick.maibuk framestats` on an Android 14 x86_64
  // emulator (software GPU) after six swipes through the app's WebView.
  const dump = fixture("gfxinfo-framestats-android14.txt");

  it("reads every completed row from IntendedVsync to FrameCompleted", () => {
    const { frames, flaggedRows } = parseGfxinfoFramestats([dump]);
    // Figures from awk over the same file: 96 rows, one still in flight.
    expect(frames).toHaveLength(95);
    expect(flaggedRows).toBe(0);
    const sorted = frames.map((f) => f.durationMs).sort((a, b) => a - b);
    expect(sorted[0]).toBeCloseTo(17.5866, 3);
    expect(sorted.at(-1)).toBeCloseTo(615.553, 2);
    expect(frames[0].startMs).toBeCloseTo(13511216.291316, 5);
    expect(frames.filter((f) => f.durationMs > 25)).toHaveLength(8);
  });

  it("merges overlapping reads of the ring buffer without counting a frame twice", () => {
    const once = parseGfxinfoFramestats([dump]).frames;
    expect(parseGfxinfoFramestats([dump, dump]).frames).toEqual(once);
  });

  it("drops rows with non-zero Flags", () => {
    const flagged = dump.replace(/\n0,38307,/, "\n1,38307,");
    const { frames, flaggedRows } = parseGfxinfoFramestats([flagged, flagged]);
    expect(frames).toHaveLength(94);
    // Read twice, still one row.
    expect(flaggedRows).toBe(1);
  });

  it("drops rows from before the reset, which belong to the warm-up", () => {
    // Stats since moves to the 11th row's IntendedVsync: the 10 rows before it
    // are older than the reset and are not part of the measured window.
    const eleventh = dump.split("---PROFILEDATA---")[1].trim().split("\n")[11].split(",")[2];
    const later = dump.replace(/Stats since: \d+ns/g, `Stats since: ${eleventh}ns`);
    const { frames, staleRows } = parseGfxinfoFramestats([later]);
    expect(frames).toHaveLength(85);
    expect(staleRows).toBe(10);
    expect(frames[0].startMs).toBeCloseTo(Number(eleventh) / 1e6, 5);
  });

  it("drops a row that completes after the dump was taken, as a torn read", () => {
    const torn = dump.replace(
      /\n(0,38321,13511232957982,(?:[^,]*,){13})(\d+)/,
      "\n$19999999999999999"
    );
    expect(torn).not.toBe(dump);
    const { frames, staleRows } = parseGfxinfoFramestats([torn]);
    expect(frames).toHaveLength(94);
    expect(staleRows).toBe(1);
    expect(Math.max(...frames.map((f) => f.durationMs))).toBeLessThan(1000);
  });

  it("refuses a dump with no PROFILEDATA section or an unknown header", () => {
    expect(() => parseGfxinfoFramestats([""])).toThrow(/PROFILEDATA/);
    expect(() => parseGfxinfoFramestats(["No process found for: com.massick.maibuk"])).toThrow(
      FrameReportRefused
    );
    expect(() => parseGfxinfoFramestats([dump.replace("IntendedVsync", "Something")])).toThrow(
      /header/
    );
  });

  it("reads the refresh period from SurfaceFlinger", () => {
    expect(parseSurfaceFlingerLatency(fixture("surfaceflinger-latency-android14.txt"))).toBeCloseTo(
      16.666666,
      5
    );
    expect(() => parseSurfaceFlingerLatency("")).toThrow(FrameReportRefused);
    expect(() => parseSurfaceFlingerLatency("Unknown option")).toThrow(FrameReportRefused);
  });
});

describe("rAF probe", () => {
  const dump = JSON.parse(fixture("probe-dump-webkit.json")) as ProbeDump & {
    calibration: number[];
  };

  it("reads a steady refresh interval from a quiet page, finer than WebKit's 1 ms clock", () => {
    // Headless WebKit ticks rAF on a timer near 16 ms; its clock reads whole
    // milliseconds, so the deltas are 16s and 17s and the interval falls between.
    expect(new Set(dump.calibration)).toEqual(new Set([16, 17]));
    const interval = refreshIntervalFromCadence(dump.calibration);
    expect(interval).toBeGreaterThan(16);
    expect(interval).toBeLessThan(17);
  });

  it("refuses an unsteady or too short calibration", () => {
    expect(() => refreshIntervalFromCadence(dump.calibration.slice(0, 10))).toThrow(/calibration/);
    const unsteady = Array.from({ length: 60 }, (_, i) => (i % 2 ? 16.7 : 33.3));
    expect(() => refreshIntervalFromCadence(unsteady)).toThrow(/unsteady/);
  });

  it("makes one frame per rAF delta and stands in long frames where WebKit has no LoAF", () => {
    const samples = parseProbeDump(dump, 16.667);
    expect(dump.loafSupported).toBe(false);
    expect(samples.frames).toHaveLength(dump.rafTimestamps.length - 1);
    expect(samples.frames[0]).toEqual({
      startMs: dump.rafTimestamps[0],
      durationMs: dump.rafTimestamps[1] - dump.rafTimestamps[0],
    });
    const long = samples.frames.filter((f) => f.durationMs > 50);
    expect(long.length).toBeGreaterThan(0);
    expect(samples.longAnimationFrames).toEqual(long.map((f) => ({ ...f, scripts: [] })));
    expect(samples.inputs).toHaveLength(dump.inputs.length);
  });

  it("keeps the engine's own long animation frames, with attribution, where it has them", () => {
    const withLoaf: ProbeDump = {
      ...dump,
      loafSupported: true,
      longAnimationFrames: [
        {
          startTime: 10,
          duration: 70,
          blockingDuration: 20,
          scripts: [
            {
              invoker: "click",
              sourceURL: "app.js",
              sourceFunctionName: "go",
              sourceCharPosition: 1200,
              duration: 65,
            },
            // The engine says -1 when it does not know where the script starts.
            {
              invoker: "rAF",
              sourceURL: "app.js",
              sourceFunctionName: "",
              sourceCharPosition: -1,
              duration: 3,
            },
          ],
        },
      ],
    };
    expect(parseProbeDump(withLoaf, 16.667).longAnimationFrames).toEqual([
      {
        startMs: 10,
        durationMs: 70,
        blockingDurationMs: 20,
        scripts: [
          {
            invoker: "click",
            sourceURL: "app.js",
            sourceFunctionName: "go",
            sourceCharPosition: 1200,
            durationMs: 65,
          },
          { invoker: "rAF", sourceURL: "app.js", sourceFunctionName: "", durationMs: 3 },
        ],
      },
    ]);
  });

  it("refuses a malformed dump", () => {
    expect(() => parseProbeDump({} as ProbeDump, 16.667)).toThrow(FrameReportRefused);
    expect(() => parseProbeDump(null as unknown as ProbeDump, 16.667)).toThrow(FrameReportRefused);
  });
});
