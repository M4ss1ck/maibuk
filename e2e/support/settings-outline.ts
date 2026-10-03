// Read-only geometry of the Settings outline scroll box, sampled on the frames
// the browser paints. The keyboard contract bans page.evaluate in specs, so the
// measuring lives here; it reads dimensions and changes nothing in the page.

import type { Page } from "@playwright/test";

export interface OutlineFrame {
  /** Content taller / wider than the box: the scrollbar and overflow it costs. */
  vOverflow: number;
  hOverflow: number;
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
  /** The box's own border-box width: what a scrollbar must never change. */
  offsetWidth: number;
  /** Border plus scrollbar the box takes up, so a bar appearing would show here. */
  gutterWidth: number;
  /** The section whose rows are expanded, so an overflow can be named. */
  sectionLabel: string | null;
  /** The Settings scroller's own offset, so a series that really scrolled shows. */
  mainScrollTop: number | null;
}

const PRESSES = 6;
const SAMPLES_PER_PRESS = 10;

const READ_NEXT_FRAME = () =>
  new Promise<OutlineFrame | null>((resolve) => {
    requestAnimationFrame(() => {
      // The tree, not the search field, and matched by its role rather than a
      // utility class: the scroll box's overflow mode is what this measures, and
      // pinning it by class would break the moment the fix changes that class.
      const box = document.querySelector<HTMLElement>(
        'nav[data-settings-navigation] div:has(> [role="treegrid"])'
      );
      const main = document.querySelector<HTMLElement>("main > div.overflow-auto");
      if (!box) {
        resolve(null);
        return;
      }
      const current = document.querySelector<HTMLElement>('[role="row"][aria-label$=", current"]');
      resolve({
        vOverflow: box.scrollHeight - box.clientHeight,
        hOverflow: box.scrollWidth - box.clientWidth,
        scrollHeight: box.scrollHeight,
        clientHeight: box.clientHeight,
        scrollWidth: box.scrollWidth,
        clientWidth: box.clientWidth,
        offsetWidth: box.offsetWidth,
        gutterWidth: box.offsetWidth - box.clientWidth,
        sectionLabel: current?.getAttribute("aria-label") ?? null,
        mainScrollTop: main?.scrollTop ?? null,
      });
    });
  });

/**
 * Samples the outline on the next animation frame before the first `press` and
 * `samplesPerPress` frames after each of `presses` presses (six by default,
 * ten samples per press), so an overflow that only exists mid-motion is caught
 * on the frames the browser actually painted. The caller keeps the keyboard:
 * `press` is its own `page.keyboard.press`. Passing `presses` covers a whole
 * traversal, down to the end of the sections and back, rather than only its
 * first steps.
 */
export async function recordOutlineOverflow(
  page: Page,
  press: () => Promise<void>,
  presses: number = PRESSES,
  samplesPerPress: number = SAMPLES_PER_PRESS
): Promise<OutlineFrame[]> {
  const samples: OutlineFrame[] = [];
  const beforePress = await page.evaluate(READ_NEXT_FRAME);
  if (beforePress) samples.push(beforePress);
  for (let pressIndex = 0; pressIndex < presses; pressIndex++) {
    await press();
    for (let frame = 0; frame < samplesPerPress; frame++) {
      const sample = await page.evaluate(READ_NEXT_FRAME);
      if (sample) samples.push(sample);
    }
  }
  return samples;
}

/** What one painted frame of the outline held. */
export interface OutlineSectionFrame {
  /** Sections whose sub-rows are in the DOM, in tree order. */
  sections: string[];
  /** The section whose header carries ", current". */
  current: string | null;
  /** Sub-rows with a running animation: motion that outlived its change. */
  animating: number;
  /** Laid-out height of every sub-row together: what a collapse shrinks. */
  rowHeight: number;
}

/**
 * Frames sampled after the last press, long enough for a whole section change
 * (a 320ms fold and a 320ms grow) to end and for the outline to come to rest.
 */
const TAIL_FRAMES = 70;

// A sampler that lives in the page: one `page.evaluate` per frame would cost a
// round trip far longer than the 90ms collapse it is meant to observe.
const START_SAMPLER = () => {
  const scope = window as unknown as {
    __outlineSamples?: OutlineSectionFrame[];
    __outlineRunning?: boolean;
  };
  const read = (): void => {
    const box = document.querySelector<HTMLElement>(
      'nav[data-settings-navigation] div:has(> [role="treegrid"])'
    );
    const rows = [...(box?.querySelectorAll<HTMLElement>('[role="row"][data-key]') ?? [])];
    const sections: string[] = [];
    let current: string | null = null;
    let animating = 0;
    let rowHeight = 0;
    for (const row of rows) {
      const key = row.dataset.key ?? "";
      if (key.startsWith("row:")) {
        animating += row.getAnimations().length;
        rowHeight += row.getBoundingClientRect().height;
        const section = key.slice("row:".length).split(":")[0];
        if (!sections.includes(section)) sections.push(section);
      } else if (
        key.startsWith("section:") &&
        (row.getAttribute("aria-label") ?? "").endsWith(", current")
      ) {
        current = key.slice("section:".length);
      }
    }
    scope.__outlineSamples ??= [];
    scope.__outlineSamples.push({ sections, current, animating, rowHeight });
    if (scope.__outlineRunning) requestAnimationFrame(read);
  };
  scope.__outlineSamples = [];
  scope.__outlineRunning = true;
  requestAnimationFrame(read);
};

const STOP_SAMPLER = () => {
  const scope = window as unknown as {
    __outlineSamples?: OutlineSectionFrame[];
    __outlineRunning?: boolean;
  };
  scope.__outlineRunning = false;
  const samples = scope.__outlineSamples ?? [];
  scope.__outlineSamples = undefined;
  return samples;
};

/** One outline entry as a painted frame held it: a header or a sub-row. */
export interface OutlineMotionRow {
  /** The row's `data-key`: `section:<id>` or `row:<section>:<row>`. */
  key: string;
  /** Border-box height of the row's own box on this frame. */
  height: number;
  /**
   * Where the row's box sits inside the scroll box's content: its layout offset,
   * which a scroll of the box does not move. A height fold travels through this
   * as a series of values; a snap shows one jump and then stillness.
   */
  layoutTop: number;
  /** Where the row's box sits on screen this frame, transform included. */
  top: number;
  bottom: number;
  /** Computed opacity on this frame, animation included. */
  opacity: number;
  /**
   * The height of the label inside the row: the text's own box, which the row
   * clips rather than squeezes. It is the same on every frame the row is in.
   */
  textHeight: number;
  textWidth: number;
  /** The CSS properties a running animation on this row is moving. */
  properties: string[];
  /**
   * The height this row settles to when motion stops (its natural box, the
   * tallest it is ever seen at) and the size its label settles to, which is the
   * label's own size whether the row is open, closing or closed.
   */
  settledHeight: number;
  settledTextHeight: number;
  settledTextWidth: number;
}

/** One painted frame of the outline's section-change motion. */
export interface OutlineMotionFrame {
  /** The header carrying ", current" on this frame, as a `section:<id>` key. */
  current: string | null;
  /** Every entry in the scroll box on this frame, headers and sub-rows. */
  rows: OutlineMotionRow[];
}

/** A frame as the page samples it, before the settled heights are worked out. */
type SampledMotionRow = Omit<
  OutlineMotionRow,
  "settledHeight" | "settledTextHeight" | "settledTextWidth"
>;

// A sampler that lives in the page: one `page.evaluate` per frame would cost a
// round trip far longer than the 320ms fold it is meant to observe.
const START_MOTION_SAMPLER = () => {
  const scope = window as unknown as {
    __outlineMotionSamples?: { current: string | null; rows: SampledMotionRow[] }[];
    __outlineMotionRunning?: boolean;
  };
  const read = (): void => {
    const box = document.querySelector<HTMLElement>(
      'nav[data-settings-navigation] div:has(> [role="treegrid"])'
    );
    const rows = [...(box?.querySelectorAll<HTMLElement>('[role="row"][data-key]') ?? [])].map(
      (row) => {
        // The rect includes any transform, which is what decides whether two
        // entries are drawn over each other on this frame.
        const rect = row.getBoundingClientRect();
        // The label the row clips: `TreeItemContent` renders its cell as
        // `display: contents`, so the label is the row's first span.
        const label = row.querySelector<HTMLElement>("span") ?? row;
        const labelRect = label.getBoundingClientRect();
        return {
          key: row.dataset.key ?? "",
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          layoutTop: row.offsetTop,
          opacity: +(+getComputedStyle(row).opacity).toFixed(3),
          textHeight: labelRect.height,
          textWidth: labelRect.width,
          properties: row
            .getAnimations()
            // What the motion moves: its own keyframes, minus the bookkeeping
            // every keyframe carries, the `composite` key included. A CSS
            // transition is not it — the entries transition their colour on
            // hover and on the highlight moving.
            .filter(
              (animation) =>
                !(typeof CSSTransition !== "undefined" && animation instanceof CSSTransition)
            )
            .flatMap((animation) =>
              ((animation.effect as KeyframeEffect | null)?.getKeyframes() ?? []).flatMap(
                (keyframe) =>
                  Object.keys(keyframe).filter(
                    (property) =>
                      property !== "offset" &&
                      property !== "computedOffset" &&
                      property !== "easing" &&
                      property !== "composite"
                  )
              )
            ),
        };
      }
    );
    const current =
      box?.querySelector<HTMLElement>('[role="row"][aria-label$=", current"]')?.dataset.key ?? null;
    scope.__outlineMotionSamples ??= [];
    scope.__outlineMotionSamples.push({ current, rows });
    if (scope.__outlineMotionRunning) requestAnimationFrame(read);
  };
  scope.__outlineMotionSamples = [];
  scope.__outlineMotionRunning = true;
  requestAnimationFrame(read);
};

const STOP_MOTION_SAMPLER = (): OutlineMotionFrame[] => {
  const scope = window as unknown as {
    __outlineMotionSamples?: { current: string | null; rows: SampledMotionRow[] }[];
    __outlineMotionRunning?: boolean;
  };
  scope.__outlineMotionRunning = false;
  const samples = scope.__outlineMotionSamples ?? [];
  scope.__outlineMotionSamples = undefined;
  // A row settles to the tallest box and the largest label it is ever painted
  // at; every other frame is measured against those.
  const tallest = new Map<string, number>();
  const largest = new Map<string, { height: number; width: number }>();
  for (const frame of samples)
    for (const row of frame.rows) {
      const seen = tallest.get(row.key);
      if (seen === undefined || row.height > seen) tallest.set(row.key, row.height);
      const label = largest.get(row.key);
      if (!label || row.textHeight > label.height)
        largest.set(row.key, { height: row.textHeight, width: row.textWidth });
    }
  return samples.map((frame) => ({
    current: frame.current,
    rows: frame.rows.map((row) => {
      const label = largest.get(row.key);
      return {
        ...row,
        settledHeight: tallest.get(row.key) ?? row.height,
        settledTextHeight: label?.height ?? row.textHeight,
        settledTextWidth: label?.width ?? row.textWidth,
      };
    }),
  }));
};

/**
 * Records every painted frame of the outline while `presses` presses run, then
 * for {@link TAIL_FRAMES} frames of tail so the series includes the settled
 * state. Each frame carries every entry's key, box height, layout offset, label
 * box and running animation, plus the row the accessible tree calls current.
 * `press` is the caller's own `page.keyboard.press`, so the spec keeps the
 * keyboard.
 */
export async function recordOutlineFrames(
  page: Page,
  press: () => Promise<void>,
  presses: number
): Promise<OutlineMotionFrame[]> {
  await page.evaluate(START_MOTION_SAMPLER);
  for (let pressIndex = 0; pressIndex < presses; pressIndex++) await press();
  await page.evaluate(
    ([frames]) =>
      new Promise<void>((resolve) => {
        let left = frames;
        const tick = () => {
          if (--left <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [TAIL_FRAMES]
  );
  return page.evaluate(STOP_MOTION_SAMPLER);
}

/**
 * Records every painted frame of the section change `presses` presses cause:
 * which sections have sub-rows in the DOM, which header is current, and how
 * many sub-rows still have a running animation. Sampling continues for
 * {@link TAIL_FRAMES} frames after the last press, so a caller can see both
 * the change and the frames where the outline has settled. `press` is the
 * caller's own `page.keyboard.press`, so the spec keeps the keyboard.
 */
export async function recordOutlineSections(
  page: Page,
  press: () => Promise<void>,
  presses: number = 1
): Promise<OutlineSectionFrame[]> {
  await page.evaluate(START_SAMPLER);
  for (let pressIndex = 0; pressIndex < presses; pressIndex++) await press();
  await page.evaluate(
    ([frames]) =>
      new Promise<void>((resolve) => {
        let left = frames;
        const tick = () => {
          if (--left <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [TAIL_FRAMES]
  );
  return page.evaluate(STOP_SAMPLER);
}
