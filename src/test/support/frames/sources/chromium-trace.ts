// Chromium source (issue #372): CDP trace events to the normalized sample set.
//
// The compositor writes one `PipelineReporter` async event per vsync slot it
// worked on (category `disabled-by-default-devtools.timeline.frame`, the one
// DevTools' Frames track reads). Its `frame_sequence` is the BeginFrame's
// sequence number, which advances once per vsync whether or not the page
// asked for a frame, and its `state` says whether the slot reached the screen.
//
// Frames are measured in vsync slots, not presentation timestamps: Chromium
// may present a main frame one vsync late for a while (a PARTIAL frame plus
// an ALL frame per slot) without missing a single vsync, and timestamps would
// read that latency as jank. A presented frame lasts as many slots as passed
// since the previous presentation while the page kept asking for frames; the
// first frame after an idle gap lasts the slots since that request started.
// Slots dropped right before an idle gap, which no presentation follows,
// still count: as one frame a slot longer than the dropped run.
// The refresh interval is the compositor's own BeginFrame spacing.

import { FrameReportRefused, type FrameSample, percentile } from "@/test/support/frames/frame-report";

export interface TraceEvent {
  name: string;
  ph: string;
  pid: number;
  tid?: number;
  ts: number;
  id?: string | number;
  id2?: { local?: string; global?: string };
  args?: Record<string, any>;
}

export interface ChromiumFrames {
  refreshIntervalMs: number;
  frames: FrameSample[];
  /** The renderer process whose frames were read. */
  rendererPid: number;
  /** Slots per state, for the report's environment. */
  states: Record<string, number>;
}

const PRESENTED = new Set(["STATE_PRESENTED_ALL", "STATE_PRESENTED_PARTIAL"]);
/** A slot the page did not ask to update is idle, not wanted. */
const IDLE = "STATE_NO_UPDATE_DESIRED";
/** Fewer BeginFrame spacings than this cannot establish the refresh interval. */
const MIN_INTERVAL_SAMPLES = 10;

interface Reporter {
  seq: number;
  state: string;
  beginMs: number;
  endMs: number;
}

function asyncId(event: TraceEvent): string {
  return String(event.id2?.local ?? event.id2?.global ?? event.id ?? "");
}

function rendererPids(events: TraceEvent[]): Set<number> {
  const pids = new Set<number>();
  for (const event of events) {
    if (event.ph === "M" && event.name === "process_name" && event.args?.name === "Renderer") {
      pids.add(event.pid);
    }
  }
  return pids;
}

function reportersByPid(events: TraceEvent[]): Map<number, Reporter[]> {
  const renderers = rendererPids(events);
  const open = new Map<string, TraceEvent>();
  const out = new Map<number, Reporter[]>();
  const sorted = events
    .filter((e) => e.name === "PipelineReporter" && renderers.has(e.pid))
    .sort((a, b) => a.ts - b.ts);
  for (const event of sorted) {
    const key = `${event.pid}:${asyncId(event)}`;
    if (event.ph === "b") {
      open.set(key, event);
      continue;
    }
    if (event.ph !== "e") continue;
    const begin = open.get(key);
    open.delete(key);
    const reporter = begin?.args?.frame_reporter ?? begin?.args?.chrome_frame_reporter;
    if (!begin || typeof reporter?.frame_sequence !== "number") continue;
    const list = out.get(event.pid) ?? [];
    list.push({
      seq: reporter.frame_sequence,
      state: String(reporter.state),
      beginMs: begin.ts / 1000,
      endMs: event.ts / 1000,
    });
    out.set(event.pid, list);
  }
  return out;
}

function refreshInterval(reporters: Reporter[]): number {
  const slotStart = new Map<number, number>();
  for (const r of reporters) {
    const known = slotStart.get(r.seq);
    if (known === undefined || r.beginMs < known) slotStart.set(r.seq, r.beginMs);
  }
  const slots = [...slotStart.entries()].sort((a, b) => a[0] - b[0]);
  const spacings: number[] = [];
  for (let i = 1; i < slots.length; i++) {
    const [seq, at] = slots[i];
    const [prevSeq, prevAt] = slots[i - 1];
    if (seq > prevSeq) spacings.push((at - prevAt) / (seq - prevSeq));
  }
  if (spacings.length < MIN_INTERVAL_SAMPLES) {
    throw new FrameReportRefused(
      `trace has ${spacings.length} BeginFrame spacings; the refresh interval needs ${MIN_INTERVAL_SAMPLES}`
    );
  }
  return percentile(spacings, 50);
}

export function parseChromiumTrace(events: TraceEvent[]): ChromiumFrames {
  if (!Array.isArray(events)) throw new FrameReportRefused("trace is not an event array");
  const byPid = reportersByPid(events);
  let rendererPid = -1;
  let reporters: Reporter[] = [];
  for (const [pid, list] of byPid) {
    const presented = list.filter((r) => PRESENTED.has(r.state)).length;
    if (presented > reporters.filter((r) => PRESENTED.has(r.state)).length) {
      rendererPid = pid;
      reporters = list;
    }
  }
  if (reporters.length === 0) {
    throw new FrameReportRefused(
      "trace has no renderer PipelineReporter events: was disabled-by-default-devtools.timeline.frame traced?"
    );
  }

  const interval = refreshInterval(reporters);
  const states: Record<string, number> = {};
  const wanted = new Set<number>();
  const slotStart = new Map<number, number>();
  // One presentation per distinct presentation time: a PARTIAL frame of one
  // slot and the ALL frame of the slot before it reach the screen together.
  const presentations = new Map<number, number>();
  for (const r of reporters) {
    states[r.state] = (states[r.state] ?? 0) + 1;
    if (r.state !== IDLE) wanted.add(r.seq);
    const known = slotStart.get(r.seq);
    if (known === undefined || r.beginMs < known) slotStart.set(r.seq, r.beginMs);
    if (!PRESENTED.has(r.state)) continue;
    const at = Math.round(r.endMs * 1000) / 1000;
    presentations.set(at, Math.max(presentations.get(at) ?? r.seq, r.seq));
  }

  const frames: FrameSample[] = [];
  const covered = new Set<number>();
  let previousSeq: number | null = null;
  for (const [, seq] of [...presentations.entries()].sort((a, b) => a[0] - b[0])) {
    if (previousSeq !== null && seq <= previousSeq) continue;
    // Walk back over the slots the page kept asking for, down to the previous
    // presentation or the start of this run of requests.
    let first = seq;
    while (first - 1 > (previousSeq ?? Number.NEGATIVE_INFINITY) && wanted.has(first - 1)) first--;
    for (let s = first; s <= seq; s++) covered.add(s);
    frames.push({ startMs: slotStart.get(first) ?? 0, durationMs: (seq - first + 1) * interval });
    previousSeq = seq;
  }
  // Slots dropped right before an idle gap (or the window's end) belong to no
  // presentation. Their update never reached the screen in its own frame; each
  // run counts as a frame one slot longer than the run, so a drop is never lost.
  const orphans = [...wanted].filter((seq) => !covered.has(seq)).sort((a, b) => a - b);
  for (let i = 0; i < orphans.length; ) {
    let end = i;
    while (end + 1 < orphans.length && orphans[end + 1] === orphans[end] + 1) end++;
    const slots = end - i + 1;
    frames.push({ startMs: slotStart.get(orphans[i]) ?? 0, durationMs: (slots + 1) * interval });
    i = end + 1;
  }
  frames.sort((a, b) => a.startMs - b.startMs);

  return { refreshIntervalMs: interval, frames, rendererPid, states };
}
