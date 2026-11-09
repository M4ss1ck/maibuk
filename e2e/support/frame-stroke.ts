// One pointer gesture for the Maps editor's drawing Frame (#745): a straight
// stroke drawn with the mouse across the Frame's svg.
//
// Drawing a Map Line has no keyboard path in this slice (the keyboard acts on a
// selected Map Line: the move Commands, the Elements list, undo), and the E2E
// keyboard contract forbids a spec from using pointer APIs itself
// (CODING_STANDARDS.md "E2E": no `mouse`, `click`, or `dispatchEvent` in a
// spec). Pointer-only gestures are the documented exemption
// (CODING_STANDARDS.md "Keyboard and accessibility" item 1; the coverage matrix
// records "Creating a Drawing and erasing are pointer gestures by nature
// (documented exemption)"), and the guard scans `e2e/specs/**` only, which is
// how `e2e/support/file-picker.ts` already performs the one interaction a
// browser offers no key for. Keeping it here, beside that stub, means the spec
// still enters by keyboard, drives the editor by keyboard, and names this one
// gesture for what it is.
//
// Coordinates are fractions of the Frame's svg box, well inside the page area
// `preserveAspectRatio="xMidYMid meet"` letterboxes: the Frame maps them to page
// millimetres through its own `getScreenCTM`, so the helper never guesses at the
// page's geometry.

import type { Locator, Page } from "@playwright/test";

/** Where the stroke starts and ends, as fractions of the svg's box. */
const FROM: readonly [number, number] = [0.3, 0.35];
const TO: readonly [number, number] = [0.6, 0.55];
/** How many moves the stroke is split into. */
const STEPS = 12;

/**
 * Draws one stroke in a Frame's drawing surface with the mouse. The Frame's
 * Pencil tool must already be selected; the caller waits for the scene with
 * `svg[data-tool="pencil"]` before calling this.
 */
export async function drawStroke(page: Page, surface: Locator): Promise<void> {
  const box = await surface.boundingBox();
  if (box === null) throw new Error("the Frame's drawing surface has no box to draw on");
  const at = (fraction: readonly [number, number]) => ({
    x: box.x + box.width * fraction[0],
    y: box.y + box.height * fraction[1],
  });
  const from = at(FROM);
  const to = at(TO);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= STEPS; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / STEPS,
      from.y + ((to.y - from.y) * step) / STEPS
    );
  }
  await page.mouse.up();
}
