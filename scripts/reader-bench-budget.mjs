#!/usr/bin/env node
// Judges the Reader performance lane (`pnpm bench:reader`, issue #653) against
// the four performance gates in issue #653, "Performance gates". Every gate is
// relative to the same build with Reader disabled or unused, so the numbers are
// deltas and ratios, not absolute budgets that a slower machine would miss.
//
//   node scripts/reader-bench-budget.mjs <reader-bench.json>
//
// The report is written by e2e/run-reader-bench.ts; this file only reads it.
// Exit codes match the other bench budgets: 0 every gate holds, 1 a gate
// fails, 2 the report is missing a measurement (an unmeasured run is never a
// pass or a fail).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** A long task is a main-thread task over this many milliseconds (the Long Tasks API). */
export const LONG_TASK_MS = 50;
/** Reader's heap after leaving may be at most this multiple of the pre-open baseline. */
export const MEMORY_RATIO = 1.1;
/**
 * The noise threshold for start-up and heap deltas, the same rule the Plugins
 * bench uses for its launch deltas (`scripts/plugins-bench-budget.mjs`): a delta
 * counts as Reader's only when it exceeds the larger of a percentage of the
 * baseline and an absolute floor.
 */
export const NOISE = {
  timePercent: 0.05,
  timeFloorMs: 20,
  heapPercent: 0.05,
  heapFloorBytes: 1024 * 1024,
};

export function median(values) {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Nearest-rank percentile: sort, index `ceil(p*n) - 1`. */
export function nearestRank(values, p) {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

/**
 * An iframe that belongs to Reader: the Reading Frame (its title), or the
 * Plugin's hidden sandbox host, which the Plugin runtime marks inert and
 * aria-hidden and which runs only Reader's Worker while a Document is open.
 */
export function isReaderIframe(frame) {
  return frame.title === "Reading" || frame.ariaHidden === "true";
}

/**
 * Tags each long task as Reader's or not. A task is Reader's when:
 * - its attribution names an iframe container, and every iframe in the page is
 *   Reader's (`iframesAreReaders`), so an iframe-attributed task is the Reader
 *   Frame's or its sandbox host's work (pdf.js rendering, EPUB parsing, search);
 * - or it is attributed to the host window and overlaps a Reader action window:
 *   the bench does nothing else on the host during an action, so the host's
 *   main thread is busy with Reader's Plugin host code (the broker, the Shelf,
 *   the Frame's port bridging). The Worker's own work never shows here, because
 *   a Worker task is not a main-thread task.
 * Anything else is the host's own work and is reported but not gated.
 */
export function attributeLongTasks(tasks, windows, iframesAreReaders) {
  return tasks.map((task) => {
    const attribution = task.attribution ?? [];
    const iframe = attribution.some((entry) => entry.containerType === "iframe");
    const overlaps = windows.some(
      (window) => task.startMs < window.endMs && task.startMs + task.durationMs > window.startMs
    );
    if (iframe && iframesAreReaders) return { ...task, reader: true, reason: "reader frame" };
    if (!iframe && overlaps)
      return { ...task, reader: true, reason: "host during a reader action" };
    return {
      ...task,
      reader: false,
      reason: iframe ? "other iframe" : "host, outside reader actions",
    };
  });
}

function gate(id, label, value, limit, ok, detail) {
  return { id, label, value, limit, ok, detail };
}

/**
 * Judges a report. Returns the gates, the trace (recorded, not gated), and
 * `unmeasured` reasons. `ok` is true only when nothing is unmeasured and every
 * gate holds.
 */
export function checkReaderBench(report) {
  const unmeasured = [];
  const gates = [];
  const trace = [];
  const idle = report.idle ?? {};
  const disabled = idle.disabled ?? null;
  const enabled = idle.enabled ?? null;

  if (!disabled?.startupMs?.length || !enabled?.startupMs?.length) {
    unmeasured.push("idle start-up samples are missing (Reader disabled or enabled)");
  } else {
    const base = median(disabled.startupMs);
    const delta = Math.abs(median(enabled.startupMs) - base);
    const limit = Math.max(base * NOISE.timePercent, NOISE.timeFloorMs);
    gates.push(
      gate(
        "idle-startup",
        "Idle start-up: enabled vs disabled (median delta)",
        delta,
        limit,
        delta <= limit,
        `disabled ${base.toFixed(1)} ms, enabled ${median(enabled.startupMs).toFixed(1)} ms`
      )
    );
  }

  // The app's own first paint (Books), apart from Reader's launch scan: recorded,
  // not gated, so a failing start-up gate says where the time goes.
  if (disabled?.booksMs?.length && enabled?.booksMs?.length) {
    trace.push({
      label: "start-up to Books, disabled, median (ms)",
      value: median(disabled.booksMs),
    });
    trace.push({
      label: "start-up to Books, enabled, median (ms)",
      value: median(enabled.booksMs),
    });
  }

  if (!disabled?.heapBytes?.length || !enabled?.heapBytes?.length) {
    unmeasured.push("idle heap samples are missing (Reader disabled or enabled)");
  } else {
    const base = median(disabled.heapBytes);
    const delta = Math.abs(median(enabled.heapBytes) - base);
    const limit = Math.max(base * NOISE.heapPercent, NOISE.heapFloorBytes);
    gates.push(
      gate(
        "idle-heap",
        "Idle JS heap: enabled vs disabled (median delta, bytes)",
        delta,
        limit,
        delta <= limit,
        `disabled ${(base / 1048576).toFixed(2)} MiB, enabled ${(median(enabled.heapBytes) / 1048576).toFixed(2)} MiB`
      )
    );
  }

  const doc = report.document ?? null;
  if (doc === null) {
    unmeasured.push("the document run is missing");
  } else {
    const iframes = doc.iframes ?? null;
    // Iframe attribution means Reader only when every iframe in the page is
    // Reader's: the Reading Frame, and the Plugin's hidden sandbox host.
    const foreign = iframes?.filter((frame) => !isReaderIframe(frame)) ?? null;
    if (foreign === null) {
      unmeasured.push("the document run did not describe its iframes, so attribution is unknown");
    } else if (foreign.length > 0) {
      unmeasured.push(
        `the page has ${foreign.length} iframe(s) that are not Reader's; iframe attribution cannot isolate Reader`
      );
    }
    const tasks = attributeLongTasks(doc.longTasks ?? [], doc.actions ?? [], foreign?.length === 0);
    const readerTasks = tasks.filter((task) => task.reader && task.durationMs > LONG_TASK_MS);
    gates.push(
      gate(
        "no-jank",
        `Reader long tasks over ${LONG_TASK_MS} ms (open, turn, search; PDF and EPUB)`,
        readerTasks.length,
        0,
        readerTasks.length === 0,
        readerTasks.length === 0
          ? "none"
          : readerTasks
              .slice(0, 5)
              .map(
                (task) =>
                  `${task.durationMs.toFixed(1)} ms ${task.reason} at ${task.startMs.toFixed(0)} ms`
              )
              .join("; ")
      )
    );
    trace.push({
      label: "long tasks over 50 ms, all (host and Reader)",
      value: tasks.filter((task) => task.durationMs > LONG_TASK_MS).length,
    });
    trace.push({
      label: "longest task (ms), all",
      value: tasks.reduce((max, task) => Math.max(max, task.durationMs), 0),
    });

    if (!Number.isFinite(doc.baselineHeapBytes) || !Number.isFinite(doc.afterLeaveHeapBytes)) {
      unmeasured.push("the document run has no heap readings");
    } else {
      const ratio = doc.afterLeaveHeapBytes / doc.baselineHeapBytes;
      gates.push(
        gate(
          "memory-after-leave",
          "JS heap 30 s after leaving Reader, vs before opening (ratio)",
          ratio,
          MEMORY_RATIO,
          ratio <= MEMORY_RATIO,
          `before ${(doc.baselineHeapBytes / 1048576).toFixed(2)} MiB, after ${(doc.afterLeaveHeapBytes / 1048576).toFixed(2)} MiB`
        )
      );
    }

    const firstPage = doc.firstPageMs ?? {};
    for (const kind of ["pdf", "epub"]) {
      if (Number.isFinite(firstPage[kind])) {
        trace.push({ label: `first page, ${kind} (ms)`, value: firstPage[kind] });
      }
      const turns = doc.turnMs?.[kind] ?? [];
      if (turns.length > 0) {
        trace.push({ label: `page turn, ${kind}, median (ms)`, value: median(turns) });
        trace.push({ label: `page turn, ${kind}, p95 (ms)`, value: nearestRank(turns, 0.95) });
      }
    }
  }

  const typing = report.typing ?? null;
  if (!typing?.before || !typing?.after) {
    unmeasured.push("the editor typing run before or after reading is missing");
  } else {
    // "Matches its baseline" (issue #653): the after-reading p95 may exceed the
    // before-reading p95 by at most one vsync, since a p95 of frame times moves
    // in whole refresh intervals. The frames budget's own verdict is printed
    // beside it, because on a machine that misses that budget already, only the
    // comparison says whether reading moved the editor.
    const { before, after } = typing;
    const delta = after.p95Ms - before.p95Ms;
    const limit = after.refreshIntervalMs ?? before.refreshIntervalMs ?? Number.NaN;
    gates.push(
      gate(
        "editor-typing",
        "Editor typing p95 frame: after a reading session minus before (ms)",
        delta,
        limit,
        delta <= limit,
        `before p95 ${before.p95Ms.toFixed(1)} ms (frames budget ${before.ok ? "pass" : "fail"}); after p95 ${after.p95Ms.toFixed(1)} ms (frames budget ${after.ok ? "pass" : "fail"}); limit one vsync`
      )
    );
  }

  return {
    gates,
    trace,
    unmeasured,
    ok: unmeasured.length === 0 && gates.every((row) => row.ok),
  };
}

/** Prints the gate and trace tables; returns the exit code (0, 1, or 2). */
export function printReaderBench(result, heading = "") {
  console.log(`\nReader performance gates (issue #653)${heading}`);
  console.log("| gate | value | limit | result | detail |");
  console.log("| --- | ---: | ---: | --- | --- |");
  for (const row of result.gates) {
    console.log(
      `| ${row.label} | ${row.value.toFixed(2)} | <= ${row.limit.toFixed(2)} | ${row.ok ? "pass" : "FAIL"} | ${row.detail} |`
    );
  }
  if (result.trace.length > 0) {
    console.log("\nRecorded, not gated (issue #653: first page and page turn)");
    console.log("| measure | value |");
    console.log("| --- | ---: |");
    for (const row of result.trace) console.log(`| ${row.label} | ${row.value.toFixed(1)} |`);
  }
  for (const reason of result.unmeasured) console.error(`unmeasured: ${reason}`);
  if (result.unmeasured.length > 0) return 2;
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node scripts/reader-bench-budget.mjs <reader-bench.json>");
    process.exit(2);
  }
  process.exit(printReaderBench(checkReaderBench(JSON.parse(readFileSync(path, "utf8")))));
}
