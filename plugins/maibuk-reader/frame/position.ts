/**
 * The Reader Frame's Reading Position engine (#941): the message that says
 * where the author is in the Document, and the debounce that sends it once the
 * author settles. `entry.ts` supplies the view state the message reads (the
 * Flowing layout and its CFI, the current page, the zoom, each view's page
 * count) and the protocol's `post`, so the engine knows nothing about how the
 * views are drawn.
 *
 * The message is shaped by the view: a Flowing Document reports its CFI and
 * whole-Document fraction when foliate can name one, and its section index and
 * page fraction otherwise; a PDF, a comic, or a fixed-layout Document reports
 * its page, zoom, and page count.
 *
 * The fractions are the ones the Frame has always reported: a section's
 * fraction is `pageIndex / pages`, so its last page never reaches 1, and a
 * Document's fraction adds the section index to that page fraction over the
 * section count, clamped to 0..1.
 *
 * Like the rest of `frame/`, this is inlined into one classic script; it may
 * import only Frame-local modules.
 */

import type { FrameZoom, ReadingPosition } from "./types";

/** The Flowing layout fields a Reading Position reads. */
export interface FlowPositionGeometry {
  /** The section on screen. */
  index: number;
  /** The page (column) on screen in that section. */
  pageIndex: number;
  /** How many pages the section's text flows into. */
  pages: number;
}

/** One Reading Position report, in either view's shape. */
export interface FramePositionMessage {
  kind: "position";
  position: ReadingPosition;
  progress: { fraction: number } | { page: number; pageCount: number };
}

/** The view state and protocol `entry.ts` gives the engine. */
export interface FramePositionDeps {
  /** Sends one message to the Worker. */
  post(message: unknown): void;
  /** How long the author must settle before a report goes out. */
  debounceMs: number;
  /** Whether any Document is open. */
  hasDocument(): boolean;
  /** Whether the Document is drawn in the Flowing view. */
  flowing(): boolean;
  /** The Flowing view's current section and layout, or null. */
  flow(): FlowPositionGeometry | null;
  /** The CFI of the first character on the current Flowing page, or null. */
  flowCfi(): string | null;
  /** The open foliate Document's section count, or null. */
  sections(): number | null;
  /** The page on screen, zero-based. */
  pageIndex(): number;
  /** The current zoom setting. */
  zoom(): FrameZoom;
  /** The open pdf.js Document's page count, or null. */
  pdfPageCount(): number | null;
}

/** The engine: builds the Reading Position and reports it after the debounce. */
export interface FramePosition {
  /** Reports the Reading Position once the author settles, if a Document is open. */
  schedule(): void;
  /** Reports a pending Reading Position now, if a Document is open. */
  flush(): void;
  /** Builds the Reading Position message for the view now shown. */
  message(): FramePositionMessage;
  /** Drops the pending report without sending it. */
  stop(): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** How far into the current Flowing section the author is, from 0 to 1. */
export function flowPageFraction(flow: FlowPositionGeometry | null | undefined): number {
  if (!flow || flow.pages <= 1) return 0;
  return flow.pageIndex / flow.pages;
}

/**
 * How far through the whole Flowing Document the author is, from 0 to 1.
 * `sections` is the open Document's section count, or null when none is open.
 */
export function flowFraction(
  flow: FlowPositionGeometry | null | undefined,
  sections: number | null | undefined
): number {
  if (!flow || sections == null) return 0;
  const total = Math.max(1, sections);
  return clamp((flow.index + flowPageFraction(flow)) / total, 0, 1);
}

/**
 * The Reading Position engine over the view `deps` supplies: the message each
 * view reports, and one debounced send shared by every navigation.
 */
export function createPosition(deps: FramePositionDeps): FramePosition {
  let timer = 0;
  let dirty = false;

  function message(): FramePositionMessage {
    const flow = deps.flow();
    if (deps.flowing() && flow) {
      const cfi = deps.flowCfi();
      return {
        kind: "position",
        position: cfi
          ? { kind: "cfi", cfi }
          : { kind: "section", index: flow.index, fraction: flowPageFraction(flow) },
        progress: { fraction: flowFraction(flow, deps.sections()) },
      };
    }
    const page = deps.pageIndex();
    const zoom = deps.zoom();
    const sections = deps.sections();
    return {
      kind: "position",
      position: {
        kind: "page",
        page,
        zoom: typeof zoom === "number" ? Math.round(zoom * 1000) / 1000 : zoom,
      },
      progress: {
        page: page + 1,
        pageCount: sections != null ? sections : (deps.pdfPageCount() ?? 0),
      },
    };
  }

  function schedule(): void {
    if (!deps.hasDocument()) return;
    dirty = true;
    clearTimeout(timer);
    timer = window.setTimeout(flush, deps.debounceMs);
  }

  function flush(): void {
    if (!dirty || !deps.hasDocument()) return;
    dirty = false;
    clearTimeout(timer);
    deps.post(message());
  }

  function stop(): void {
    clearTimeout(timer);
  }

  return { schedule, flush, message, stop };
}
