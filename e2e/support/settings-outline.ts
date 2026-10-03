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
 * ten frames after each of `presses` presses (six by default), so an overflow
 * that only exists mid-motion is caught on the frames the browser actually
 * painted. The caller keeps the keyboard: `press` is its own
 * `page.keyboard.press`. Passing `presses` covers a whole traversal, down to
 * the end of the sections and back, rather than only its first steps.
 */
export async function recordOutlineOverflow(
  page: Page,
  press: () => Promise<void>,
  presses: number = PRESSES
): Promise<OutlineFrame[]> {
  const samples: OutlineFrame[] = [];
  const beforePress = await page.evaluate(READ_NEXT_FRAME);
  if (beforePress) samples.push(beforePress);
  for (let pressIndex = 0; pressIndex < presses; pressIndex++) {
    await press();
    for (let frame = 0; frame < SAMPLES_PER_PRESS; frame++) {
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

/** Frames sampled after the last press, long enough for both phases to end. */
const TAIL_FRAMES = 30;

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
