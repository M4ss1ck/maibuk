// The frame budget (issue #372), frozen before the lane was built. One place,
// with its rationale, so nobody quietly loosens it to make a run pass: a
// scenario may differ from the default only in FRAME_BUDGETS, and every
// difference carries a written reason (frame-bench-check.test.ts enforces both).
//
// Defaults, per scenario:
//   - p95 frame time at or under one refresh interval (16.7 ms at 60 Hz,
//     8.3 ms at 120 Hz: a 120 Hz screen is never credited for half rate);
//   - dropped frames (over 1.5 refresh intervals) under 1% of frames;
//   - no long animation frame over 50 ms, the Long Animation Frames API's own
//     threshold and the RAIL budget for responding to input;
//   - at least 60 frames, about one second at 60 Hz, or the scenario is
//     `not-measured`, which fails: a broken scenario never looks smooth.
//
// jitterMs is measurement resolution, not slack: WebKit's clock reads whole
// milliseconds (a 60 Hz frame reads 16 or 17 ms) and vsync timestamps jitter
// by tens of microseconds. One millisecond covers both and never lets a
// frame that missed a vsync through.

import type { FrameBudget } from "@/test/support/frames/frame-report";

export const DEFAULT_FRAME_BUDGET: Readonly<FrameBudget> = {
  p95FrameIntervals: 1,
  maxDroppedPct: 1,
  maxLongAnimationFrameMs: 50,
  minFrames: 60,
  jitterMs: 1,
};

export interface ScenarioBudget {
  /** Lines that differ from DEFAULT_FRAME_BUDGET. */
  overrides: Partial<FrameBudget>;
  /** Why each override exists. */
  reasons: Partial<Record<keyof FrameBudget, string>>;
}

export const FRAME_BUDGETS: Readonly<Record<string, ScenarioBudget>> = {
  typing: {
    overrides: { inputP95Intervals: 1, minInputs: 60 },
    reasons: {
      inputP95Intervals:
        "issue #372: each keystroke appears on the next frame, so the frame that renders it starts within one refresh interval",
      minInputs:
        "half the measured burst of 120 characters, so a lost keystroke listener is not-measured",
    },
  },
  scroll: { overrides: {}, reasons: {} },
  canvas: { overrides: {}, reasons: {} },
  "settings-outline": { overrides: {}, reasons: {} },
  "sidebar-resize": { overrides: {}, reasons: {} },
  "chapter-list-resize": { overrides: {}, reasons: {} },
  "chapter-reorder": { overrides: {}, reasons: {} },
  palette: {
    overrides: { inputP95Intervals: 1, minInputs: 8 },
    reasons: {
      inputP95Intervals:
        "issue #372 story 17: palette results update without dropped frames, judged like typing",
      minInputs:
        "the query is typed letter by letter; fewer than 8 means the palette never had focus",
    },
  },
  "arrow-leave-notes": {
    overrides: { handlerP95Ms: 2, minHandlerSamples: 10 },
    reasons: {
      handlerP95Ms:
        "keyboard arrow navigation plan, criterion 11: an arrow that leaves a widget finds its target in under 2 ms at p95, with 500 Notes in the list",
      minHandlerSamples:
        "half the twenty leaves of one run, so a driver that stopped leaving the list is not-measured",
    },
  },
  "arrow-leave-chapters": {
    overrides: { handlerP95Ms: 2, minHandlerSamples: 10 },
    reasons: {
      handlerP95Ms:
        "keyboard arrow navigation plan, criterion 11: an arrow that leaves a widget finds its target in under 2 ms at p95, with 100 Chapters in the list",
      minHandlerSamples:
        "half the twenty leaves of one run, so a driver that stopped leaving the list is not-measured",
    },
  },
  "pane-slide": { overrides: {}, reasons: {} },
};

export function budgetFor(scenarioId: string): FrameBudget {
  const entry = FRAME_BUDGETS[scenarioId];
  if (!entry) throw new Error(`no frame budget for scenario "${scenarioId}"`);
  return { ...DEFAULT_FRAME_BUDGET, ...entry.overrides };
}
