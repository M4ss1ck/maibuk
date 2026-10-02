// Android source (issue #372): `dumpsys gfxinfo <package> framestats` to the
// normalized sample set, read the way Android's own jank accounting reads it.
//
// Each PROFILEDATA row is one frame the app's render thread drew, with
// nanosecond timestamps. A frame starts at its IntendedVsync and lasts until
// FrameCompleted. Rows with non-zero Flags are atypical frames (the first
// draw of a window, a frame skipped for being too late...) that the platform
// documentation says to ignore. Columns are read by header name: their set
// grows with each Android release.
//
// The FrameInterval column is not read: on Android 14 its header name and
// FrameStartTime's are swapped relative to the values (FrameInterval's cell
// holds a timestamp). The refresh period comes from SurfaceFlinger instead.
//
// Each dump's header bounds its rows: a row whose vsync predates "Stats since"
// is older than the runner's `reset` (the warm-up's frames), and a row that
// completes after the dump's "Uptime" is a torn read of a slot being
// rewritten (seen on an Android 15 emulator as completions 5e18 ns out).
//
// The buffer holds only the most recent frames (120 on current releases), so
// the runner reads it more than once per window; rows are merged by vsync.

import { FrameReportRefused, type FrameSample } from "@/test/support/frames/frame-report";

const SECTION = "---PROFILEDATA---";
const NS_PER_MS = 1_000_000;

export interface GfxinfoFrames {
  frames: FrameSample[];
  /** Rows dropped for a non-zero Flags column. */
  flaggedRows: number;
  /** Rows dropped for falling outside their dump's reset and uptime. */
  staleRows: number;
}

interface Row {
  intendedVsync: number;
  frameCompleted: number;
}

interface Bounds {
  /** "Stats since", ns: when the stats were last reset. */
  sinceNs: number;
  /** "Uptime", in ns: when the dump was taken. */
  untilNs: number;
}

function bounds(text: string): Bounds {
  const since = /Stats since: (\d+)ns/.exec(text);
  const uptime = /Uptime: (\d+)/.exec(text);
  return {
    sinceNs: since ? Number(since[1]) : 0,
    untilNs: uptime ? Number(uptime[1]) * NS_PER_MS : Number.POSITIVE_INFINITY,
  };
}

function parseSections(text: string, flagged: Set<string>, stale: Set<string>): Row[] {
  const rows: Row[] = [];
  const { sinceNs, untilNs } = bounds(text);
  const parts = text.split(SECTION);
  // Sections sit between pairs of markers: parts 1, 3, 5...
  for (let i = 1; i < parts.length; i += 2) {
    const lines = parts[i]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    const header = lines[0].split(",").map((name) => name.trim());
    const col = (name: string) => header.indexOf(name);
    const flags = col("Flags");
    const intended = col("IntendedVsync");
    const completed = col("FrameCompleted");
    if (flags < 0 || intended < 0 || completed < 0) {
      throw new FrameReportRefused(
        "framestats header lacks Flags, IntendedVsync, or FrameCompleted"
      );
    }
    for (const line of lines.slice(1)) {
      const cells = line.split(",");
      if (cells.length < header.length - 1) continue;
      if (Number(cells[flags]) !== 0) {
        flagged.add(`${cells[intended]}:${cells[completed]}`);
        continue;
      }
      const intendedVsync = Number(cells[intended]);
      const frameCompleted = Number(cells[completed]);
      // Still in flight: the slot holds this frame's vsync and an older completion.
      if (!(intendedVsync > 0) || !(frameCompleted >= intendedVsync)) continue;
      if (intendedVsync < sinceNs || frameCompleted > untilNs) {
        stale.add(`${intendedVsync}:${frameCompleted}`);
        continue;
      }
      rows.push({ intendedVsync, frameCompleted });
    }
  }
  return rows;
}

/** Merges one or more framestats dumps into frames in presentation order. */
export function parseGfxinfoFramestats(dumps: string[]): GfxinfoFrames {
  // Sets, because polls read the same ring-buffer rows more than once.
  const flagged = new Set<string>();
  const stale = new Set<string>();
  // The same frame read twice has the same vsync and completion; two windows
  // drawing on one vsync complete at different times.
  const byVsync = new Map<string, Row>();
  let sections = 0;
  for (const dump of dumps) {
    if (typeof dump !== "string") throw new FrameReportRefused("framestats dump is not text");
    sections += Math.floor(dump.split(SECTION).length / 2);
    for (const row of parseSections(dump, flagged, stale))
      byVsync.set(`${row.intendedVsync}:${row.frameCompleted}`, row);
  }
  if (sections === 0) {
    throw new FrameReportRefused(
      "no PROFILEDATA section: is the app running, and was framestats asked for?"
    );
  }
  const rows = [...byVsync.values()].sort((a, b) => a.intendedVsync - b.intendedVsync);
  return {
    frames: rows.map((row) => ({
      startMs: row.intendedVsync / NS_PER_MS,
      durationMs: (row.frameCompleted - row.intendedVsync) / NS_PER_MS,
    })),
    flaggedRows: flagged.size,
    staleRows: stale.size,
  };
}

/**
 * The display's refresh period from `dumpsys SurfaceFlinger --latency`, whose
 * first line is the vsync period in nanoseconds.
 */
export function parseSurfaceFlingerLatency(text: string): number {
  const first = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const period = /^\d+$/.test(first) ? Number(first) : Number.NaN;
  if (!(period > 0)) {
    throw new FrameReportRefused(`SurfaceFlinger reported no refresh period ("${first}")`);
  }
  return period / NS_PER_MS;
}
