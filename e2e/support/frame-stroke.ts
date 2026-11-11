// Pointer gestures for the Maps editor's drawing Frame (#745, #746, #747,
// #766): a straight Pencil stroke, an Eraser drag across the Frame's svg, a
// Shape tool's drag, and a Select drag that moves an Element. Moving has a
// keyboard path (the arrow Commands); the drag is the pointer form of it.
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
// A stroke's coordinates are fractions of the Frame's svg box, well inside the
// page area `preserveAspectRatio="xMidYMid meet"` letterboxes: the Frame maps
// them to page millimetres through its own `getScreenCTM`, so the helper never
// guesses at the page's geometry. An Eraser drag names page millimetres instead,
// because the caller reads them off the Map Line it means to cut, and this
// helper maps them through the svg's viewBox.

import type { Locator, Page } from "@playwright/test";

/** A page point, in millimetres, the same space as a Map Line's points. */
type PagePoint = readonly [number, number];

/** Where the stroke starts and ends, as fractions of the svg's box. */
const FROM: readonly [number, number] = [0.3, 0.35];
const TO: readonly [number, number] = [0.6, 0.55];
/** Where a Shape drag starts and ends, as fractions of the svg's box. */
const SHAPE_FROM: readonly [number, number] = [0.3, 0.3];
const SHAPE_TO: readonly [number, number] = [0.55, 0.45];
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

/**
 * Drags one of the Shape tools across a Frame's drawing surface with the mouse,
 * the pointer path the Ellipse, Rectangle, and Polygon tools take (#747). The
 * Frame's Shape tool must already be selected; the caller waits for the scene
 * with `svg[data-tool="ellipse"]` (or its own kind) before calling this.
 * `constrain` holds Shift for the drag, which squares the box on its longer
 * side, so an Ellipse becomes a circle. `during` runs with the button still
 * down, on the drag's last point, which is where the live preview is worth a
 * screenshot.
 */
export async function dragShape(
  page: Page,
  surface: Locator,
  { constrain = false, during }: { constrain?: boolean; during?: () => Promise<void> } = {}
): Promise<void> {
  const box = await surface.boundingBox();
  if (box === null) throw new Error("the Frame's drawing surface has no box to draw on");
  const at = (fraction: readonly [number, number]) => ({
    x: box.x + box.width * fraction[0],
    y: box.y + box.height * fraction[1],
  });
  const from = at(SHAPE_FROM);
  const to = at(SHAPE_TO);
  if (constrain) await page.keyboard.down("Shift");
  try {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= STEPS; step += 1) {
      await page.mouse.move(
        from.x + ((to.x - from.x) * step) / STEPS,
        from.y + ((to.y - from.y) * step) / STEPS
      );
    }
    if (during !== undefined) await during();
    await page.mouse.up();
  } finally {
    if (constrain) await page.keyboard.up("Shift");
  }
}

/**
 * The svg's box and viewBox, as the two mappings a page millimetre needs.
 * `preserveAspectRatio="xMidYMid meet"` fits the whole viewBox inside the box
 * and centres it, so one scale serves both axes.
 */
function fitToBox(
  box: { x: number; y: number; width: number; height: number },
  viewBox: readonly number[]
): (point: PagePoint) => { x: number; y: number } {
  const [viewX, viewY, viewWidth, viewHeight] = viewBox;
  if (viewWidth <= 0 || viewHeight <= 0)
    throw new Error(`unexpected viewBox: ${viewBox.join(" ")}`);
  const scale = Math.min(box.width / viewWidth, box.height / viewHeight);
  const left = box.x + (box.width - viewWidth * scale) / 2;
  const top = box.y + (box.height - viewHeight * scale) / 2;
  return ([x, y]) => ({ x: left + (x - viewX) * scale, y: top + (y - viewY) * scale });
}

/**
 * Clicks a Frame's drawing surface at one page point in millimetres: the
 * Bucket's pointer pour (#748). The Frame's Bucket tool must already be
 * selected; the caller waits for the scene with `svg[data-tool="bucket"]`
 * before calling this, and reads the point off the shape it means to fill.
 */
export async function clickPagePoint(
  page: Page,
  surface: Locator,
  point: PagePoint
): Promise<void> {
  const box = await surface.boundingBox();
  if (box === null) throw new Error("the Frame's drawing surface has no box to draw on");
  const viewBox = await surface.getAttribute("viewBox");
  if (viewBox === null) throw new Error("the Frame's drawing surface has no viewBox");
  const at = fitToBox(box, viewBox.split(" ").map(Number))(point);
  await page.mouse.click(at.x, at.y);
}

/**
 * Drags the Eraser across a Frame's drawing surface, between two page points in
 * millimetres. The Frame's Eraser tool must already be selected; the caller
 * waits for the scene with `svg[data-tool="eraser"]` before calling this, and
 * reads the two points off the Map Line it means to cut.
 */
export async function eraseAcross(
  page: Page,
  surface: Locator,
  from: PagePoint,
  to: PagePoint
): Promise<void> {
  const box = await surface.boundingBox();
  if (box === null) throw new Error("the Frame's drawing surface has no box to draw on");
  const viewBox = await surface.getAttribute("viewBox");
  if (viewBox === null) throw new Error("the Frame's drawing surface has no viewBox");
  const toScreen = fitToBox(box, viewBox.split(" ").map(Number));
  const start = toScreen(from);
  const end = toScreen(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= STEPS; step += 1) {
    await page.mouse.move(
      start.x + ((end.x - start.x) * step) / STEPS,
      start.y + ((end.y - start.y) * step) / STEPS
    );
  }
  await page.mouse.up();
}

/**
 * Drags with the Select tool from one page point to another, in millimetres:
 * the pointer form of the arrow move Commands (#766). The caller waits for the
 * scene with `svg[data-tool="select"]` and reads `from` off the Element it
 * means to move, a point on its ink. `constrain` holds Shift for the whole
 * drag. `during` runs with the button still down on the drag's last point,
 * where the live preview is worth a screenshot, or where Escape cancels it.
 */
export async function dragPagePoint(
  page: Page,
  surface: Locator,
  from: PagePoint,
  to: PagePoint,
  { constrain = false, during }: { constrain?: boolean; during?: () => Promise<void> } = {}
): Promise<void> {
  const box = await surface.boundingBox();
  if (box === null) throw new Error("the Frame's drawing surface has no box to draw on");
  const viewBox = await surface.getAttribute("viewBox");
  if (viewBox === null) throw new Error("the Frame's drawing surface has no viewBox");
  const toScreen = fitToBox(box, viewBox.split(" ").map(Number));
  const start = toScreen(from);
  const end = toScreen(to);
  if (constrain) await page.keyboard.down("Shift");
  try {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= STEPS; step += 1) {
      await page.mouse.move(
        start.x + ((end.x - start.x) * step) / STEPS,
        start.y + ((end.y - start.y) * step) / STEPS
      );
    }
    if (during !== undefined) await during();
    await page.mouse.up();
  } finally {
    if (constrain) await page.keyboard.up("Shift");
  }
}
