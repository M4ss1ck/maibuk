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
  /** The Settings scroller's own offset, so a series that really scrolled shows. */
  mainScrollTop: number | null;
}

const PRESSES = 6;
const SAMPLES_PER_PRESS = 10;

const READ_NEXT_FRAME = () =>
  new Promise<OutlineFrame | null>((resolve) => {
    requestAnimationFrame(() => {
      const box = document.querySelector<HTMLElement>(
        "nav[data-settings-navigation] div.overflow-auto"
      );
      const main = document.querySelector<HTMLElement>("main > div.overflow-auto");
      if (!box) {
        resolve(null);
        return;
      }
      resolve({
        vOverflow: box.scrollHeight - box.clientHeight,
        hOverflow: box.scrollWidth - box.clientWidth,
        scrollHeight: box.scrollHeight,
        clientHeight: box.clientHeight,
        scrollWidth: box.scrollWidth,
        clientWidth: box.clientWidth,
        mainScrollTop: main?.scrollTop ?? null,
      });
    });
  });

/**
 * Samples the outline on the next animation frame before the first `press` and
 * ten frames after each of six presses, so an overflow that only exists
 * mid-motion is caught on the frames the browser actually painted. The caller
 * keeps the keyboard: `press` is its own `page.keyboard.press`.
 */
export async function recordOutlineOverflow(
  page: Page,
  press: () => Promise<void>
): Promise<OutlineFrame[]> {
  const samples: OutlineFrame[] = [];
  const beforePress = await page.evaluate(READ_NEXT_FRAME);
  if (beforePress) samples.push(beforePress);
  for (let pressIndex = 0; pressIndex < PRESSES; pressIndex++) {
    await press();
    for (let frame = 0; frame < SAMPLES_PER_PRESS; frame++) {
      const sample = await page.evaluate(READ_NEXT_FRAME);
      if (sample) samples.push(sample);
    }
  }
  return samples;
}
