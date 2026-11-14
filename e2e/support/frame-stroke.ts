// Pointer gestures for the Maps editor's drawing Frame (#745, #746, #747,
// #766, #750, #751, #777, #795): a straight Pencil stroke, an Area tool
// outline, an Eraser drag across the Frame's svg, a Shape tool's drag, a Select
// drag that moves an Element, a Map Label's bend handle, a transform handle's
// resize or turn, a wheel zoom, and a Space+drag pan. Moving has a keyboard
// path (the arrow Commands), so does the Area tool's outline (its arrows and
// Enter), a label's bend (the panel's Bend field), and a handle's resize or
// turn (the scale and turn Commands); the drag here is the pointer form of each.
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
//
// `scatterPaint` reads the other way round: what the Frame actually paints
// for a Fill's scatter (#750), measured by the browser in the Frame's own
// pixels, so a spec can prove the Stamps stay inside the area without reading
// attributes. `fontLoaded` reads a bundled face's status in `document.fonts`
// (#751), so a spec proves the bytes arrived instead of only the CSS name, and
// `labelInk` reads where a Map Label's glyphs landed, so a spec proves the text
// is drawn along its baseline rather than only that the SVG holds a textPath.

import type { Locator, Page } from "@playwright/test";

/** A page point, in millimetres, the same space as a Map Line's points. */
type PagePoint = readonly [number, number];

/** A place on the drawing surface, as fractions of the svg's box. */
export type BoxFraction = readonly [number, number];

/** Where the stroke starts and ends, as fractions of the svg's box. */
const FROM: readonly [number, number] = [0.3, 0.35];
const TO: readonly [number, number] = [0.6, 0.55];
/** Where a Shape drag starts and ends, as fractions of the svg's box. */
const SHAPE_FROM: readonly [number, number] = [0.3, 0.3];
const SHAPE_TO: readonly [number, number] = [0.55, 0.45];
/** Where an Area tool outline turns, as fractions of the svg's box. */
const AREA_CORNERS: readonly (readonly [number, number])[] = [
  [0.34, 0.36],
  [0.62, 0.42],
  [0.44, 0.62],
];
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
 * Traces one closed outline in a Frame's drawing surface with the mouse: the
 * Area tool's pointer form (#750). The Frame smooths the traced stroke into an
 * Area Fill exactly as the Pencil's stroke becomes a Map Line, so the outline
 * has to enclose something: this one turns at three corners and comes back to
 * the first. (A straight drag is no use here: smoothing reduces it to the two
 * points a Fill refuses.) The Area tool must already be selected; the caller
 * waits for the scene with `svg[data-tool="area"]` before calling this.
 */
export async function drawArea(page: Page, surface: Locator): Promise<void> {
  const box = await surface.boundingBox();
  if (box === null) throw new Error("the Frame's drawing surface has no box to draw on");
  const at = (fraction: readonly [number, number]) => ({
    x: box.x + box.width * fraction[0],
    y: box.y + box.height * fraction[1],
  });
  // The closing leg returns to the first corner, so the outline is one loop.
  const corners = [...AREA_CORNERS, AREA_CORNERS[0]].map(at);
  await page.mouse.move(corners[0].x, corners[0].y);
  await page.mouse.down();
  for (let index = 1; index < corners.length; index += 1) {
    const from = corners[index - 1];
    const to = corners[index];
    for (let step = 1; step <= STEPS; step += 1) {
      await page.mouse.move(
        from.x + ((to.x - from.x) * step) / STEPS,
        from.y + ((to.y - from.y) * step) / STEPS
      );
    }
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

/**
 * Drags a Map Label's bend handle (#751) to the page point the pointer asks
 * for, both in millimetres: the Select tool must be picked and the label
 * selected, which is when the Frame draws the handle. The caller hands the
 * handle itself, and its apex is read off the circle's own `cx`/`cy`, so the
 * drag starts where the Frame draws it rather than where the label's fields
 * say. The panel's Bend field is the keyboard path to the same curve; this is
 * its pointer form, the same exemption as the other drags here.
 */
export async function dragBendHandle(
  page: Page,
  surface: Locator,
  handle: Locator,
  to: PagePoint
): Promise<void> {
  const box = await surface.boundingBox();
  if (box === null) throw new Error("the Frame's drawing surface has no box to draw on");
  const viewBox = await surface.getAttribute("viewBox");
  if (viewBox === null) throw new Error("the Frame's drawing surface has no viewBox");
  const cx = await handle.getAttribute("cx");
  const cy = await handle.getAttribute("cy");
  if (cx === null || cy === null) throw new Error("the bend handle has no apex to drag from");
  const toScreen = fitToBox(box, viewBox.split(" ").map(Number));
  const start = toScreen([Number(cx), Number(cy)]);
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
 * Drags one of a selected Stamp's or Map Image's transform handles (#795) to a
 * page point in millimetres: a corner grip, which resizes the box uniformly, or
 * the turn grip above the box, which turns it about its centre. The Select tool
 * must be picked and the Element selected, which is when the Frame draws the
 * handles. The caller hands the grip's own hit target, so the drag starts where
 * the Frame draws it rather than where the panel's numbers say, and the target
 * point is mapped through the surface's viewBox the way the Frame's own
 * `getScreenCTM` reads it. The scale and turn Commands are the keyboard path to
 * the same edit; this is their pointer form, the same exemption as the drags
 * above.
 */
export async function dragTransformHandle(
  page: Page,
  surface: Locator,
  handle: Locator,
  to: PagePoint
): Promise<void> {
  const grip = await handle.boundingBox();
  if (grip === null) throw new Error("the transform handle has no box to grab");
  const box = await surface.boundingBox();
  if (box === null) throw new Error("the Frame's drawing surface has no box to draw on");
  const viewBox = await surface.getAttribute("viewBox");
  if (viewBox === null) throw new Error("the Frame's drawing surface has no viewBox");
  const toScreen = fitToBox(box, viewBox.split(" ").map(Number));
  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
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
 * A Frame svg's box, and the mapping between its pixels and page millimetres.
 * `preserveAspectRatio="xMidYMid meet"` fits the whole viewBox inside the box
 * and centres it, so one scale serves both axes.
 */
interface SurfaceMapping {
  box: { x: number; y: number; width: number; height: number };
  /** Frame pixels per page millimetre. */
  scale: number;
  /** Where the viewBox's own top-left corner sits, in Frame pixels. */
  left: number;
  top: number;
  view: { x: number; y: number; width: number; height: number };
}

/** Reads a Frame surface's box and viewBox, and the mapping between them. */
async function surfaceMapping(surface: Locator): Promise<SurfaceMapping> {
  const box = await surface.boundingBox();
  if (box === null) throw new Error("the Frame's drawing surface has no box to draw on");
  const viewBox = await surface.getAttribute("viewBox");
  if (viewBox === null) throw new Error("the Frame's drawing surface has no viewBox");
  const [x, y, width, height] = viewBox.split(" ").map(Number);
  if (width <= 0 || height <= 0) throw new Error(`unexpected viewBox: ${viewBox}`);
  const scale = Math.min(box.width / width, box.height / height);
  return {
    box,
    scale,
    left: box.x + (box.width - width * scale) / 2,
    top: box.y + (box.height - height * scale) / 2,
    view: { x, y, width, height },
  };
}

/**
 * The page point in millimetres under one fraction of a Frame's box (#777):
 * what the pointer is over, read the way the Frame's own `getScreenCTM` reads
 * it. A zoom keeps this point under the pointer, so a spec names it once and
 * asks where it sits afterwards.
 */
export async function pagePointAt(surface: Locator, fraction: BoxFraction): Promise<PagePoint> {
  const { box, scale, left, top, view } = await surfaceMapping(surface);
  return [
    view.x + (box.x + box.width * fraction[0] - left) / scale,
    view.y + (box.y + box.height * fraction[1] - top) / scale,
  ];
}

/** Where one page point in millimetres sits, as fractions of a Frame's box (#777). */
export async function fractionOfPagePoint(
  surface: Locator,
  point: PagePoint
): Promise<BoxFraction> {
  const { box, scale, left, top, view } = await surfaceMapping(surface);
  return [
    (left + (point[0] - view.x) * scale - box.x) / box.width,
    (top + (point[1] - view.y) * scale - box.y) / box.height,
  ];
}

/**
 * How many page millimetres one pixel of a Frame's surface is worth right now
 * (#777): the unit a pointer gesture is accurate to. An engine delivers a
 * pointer's place on a whole pixel — Chromium keeps the fraction a caller asks
 * for, Firefox and WebKit land on the pixel — so a pan that follows the gesture
 * can differ from the requested travel by one pixel, and no more.
 */
export async function millimetresPerPixel(surface: Locator): Promise<number> {
  return 1 / (await surfaceMapping(surface)).scale;
}

/**
 * Sends one or more wheel clicks over a point of a Frame's drawing surface
 * (#777), each a 100-pixel step the way a mouse wheel reports one. With `ctrl`
 * — the default — it is the Ctrl+wheel a trackpad reports a pinch as, which the
 * Frame zooms around the pointer with; without it, the plain wheel the Frame
 * leaves alone. Keys reach the Frame only while it holds focus, so the caller
 * Tabs into it first.
 */
export async function wheelAt(
  page: Page,
  surface: Locator,
  fraction: BoxFraction,
  { ctrl = true, notches = 1 }: { ctrl?: boolean; notches?: number } = {}
): Promise<void> {
  const box = await surface.boundingBox();
  if (box === null) throw new Error("the Frame's drawing surface has no box to draw on");
  const at = { x: box.x + box.width * fraction[0], y: box.y + box.height * fraction[1] };
  await page.mouse.move(at.x, at.y);
  if (!ctrl) {
    for (let notch = 0; notch < notches; notch += 1) await page.mouse.wheel(0, -100);
    return;
  }
  // The wheel carries the modifiers the keyboard holds, so Ctrl down around it
  // is the same event a pinch sends.
  await page.keyboard.down("Control");
  try {
    for (let notch = 0; notch < notches; notch += 1) await page.mouse.wheel(0, -100);
  } finally {
    await page.keyboard.up("Control");
  }
}

/**
 * Pans a Frame's view by dragging between two points of its drawing surface
 * (#777), the pointer form of the pan Commands. With `space` (the default) the
 * drag holds Space, which pans whatever tool is active and draws nothing, so
 * the caller Tabs into the Frame first: Space only reaches it while it holds
 * focus. Without it the drag is a plain primary-button drag, which pans only
 * with the Hand picked.
 */
export async function dragPan(
  page: Page,
  surface: Locator,
  from: BoxFraction,
  to: BoxFraction,
  { space = true }: { space?: boolean } = {}
): Promise<void> {
  const box = await surface.boundingBox();
  if (box === null) throw new Error("the Frame's drawing surface has no box to draw on");
  const at = (fraction: BoxFraction) => ({
    x: box.x + box.width * fraction[0],
    y: box.y + box.height * fraction[1],
  });
  const start = at(from);
  const end = at(to);
  await page.mouse.move(start.x, start.y);
  if (space) await page.keyboard.down(" ");
  try {
    await page.mouse.down();
    for (let step = 1; step <= STEPS; step += 1) {
      await page.mouse.move(
        start.x + ((end.x - start.x) * step) / STEPS,
        start.y + ((end.y - start.y) * step) / STEPS
      );
    }
    await page.mouse.up();
  } finally {
    if (space) await page.keyboard.up(" ");
  }
}

/**
 * Whether a Frame has actually loaded the named font family (#751): asks the
 * Frame's own `document.fonts` to load it, then reads the matched face's
 * status. A stylesheet that merely names the family would pass a CSS
 * assertion; this proves the bundled bytes arrived and the face is usable.
 */
export async function fontLoaded(surface: Locator, family: string): Promise<boolean> {
  return surface.evaluate(async (_element, wanted) => {
    await document.fonts.load(`12px "${wanted}"`);
    let loaded = false;
    document.fonts.forEach((face) => {
      if (face.family.replace(/["']/g, "") === wanted && face.status === "loaded") loaded = true;
    });
    return loaded;
  }, family);
}

/** A box in a Frame's own pixels, from its screen matrix. */
export interface FrameBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What a Frame lays out for a Map Label's text (#751), in its own pixels. */
export interface LabelInk {
  /** The length of each drawn copy's text, in the Frame's own user units. */
  lengths: number[];
  /** The ink copy's glyph box: the text the author reads. */
  ink: FrameBox;
  /** The baseline path's box, whose middle the text is centred on. */
  baseline: FrameBox;
}

/**
 * What a Frame actually lays a Map Label's text out as (#751), measured by the
 * browser rather than read off the markup. A `<text>` whose `<textPath>` the
 * engine refused to apply reports a text length all the same, so the glyph
 * box's place against the baseline is what proves the run is drawn along it.
 * The label draws its halo first, so the ink copy is the last `text.map-line`.
 */
export async function labelInk(surface: Locator): Promise<LabelInk> {
  return surface.evaluate((element) => {
    if (!(element instanceof SVGSVGElement)) throw new Error("the Frame's surface is no svg");
    const svg = element;
    const texts = Array.from(
      svg.querySelectorAll<SVGTextElement>("g[data-element-id] text.map-line")
    );
    const ink = texts[texts.length - 1];
    if (ink === undefined) throw new Error("the Frame drew no Map Label text");
    // The baseline the text follows is the label's hit path, the only path its
    // group draws. It is in the scene, unlike the `<defs>` copy the textPath
    // names, so every engine lays it out and reports its box.
    const baseline = ink.closest("g[data-element-id]")?.querySelector("path.map-hit");
    if (!(baseline instanceof SVGGraphicsElement)) {
      throw new Error("the Frame drew no Map Label baseline");
    }
    const box = (rect: DOMRect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    });
    return {
      lengths: texts.map((text) => text.getComputedTextLength()),
      ink: box(ink.getBoundingClientRect()),
      baseline: box(baseline.getBoundingClientRect()),
    };
  });
}

/** What a Frame paints for a Fill's scatter, and where its Stamps answer a hit. */
export interface ScatterPaint {
  /** The box the Fill's own area outline covers. */
  outline: FrameBox;
  /**
   * One point per side a scattered Stamp's art reaches past the outline, with
   * how far outside it sits and whether a Stamp answers a hit there.
   */
  outside: { x: number; y: number; outsideBy: number; painted: boolean }[];
  /** Whether a Stamp answers a hit inside the area, so the Stamps did paint. */
  inside: boolean;
}

/**
 * What a Frame paints for its Fill's scatter (#750), measured by the browser in
 * the Frame's own pixels. A Stamp answers a hit only where the browser paints
 * it, and a Clip Path cuts both: so a Stamp whose art reaches past the Fill's
 * outline must not answer a hit outside it, while the ones inside the area must.
 *
 * The Clip Path belongs on the group, never on a Stamp's own path: SVG applies
 * a clip in the user space of the element that references it, so the Stamp's
 * transform would carry the clip away with the art it should cut.
 */
export async function scatterPaint(surface: Locator): Promise<ScatterPaint> {
  return surface.evaluate((element) => {
    if (!(element instanceof SVGSVGElement)) throw new Error("the Frame's surface is no svg");
    const svg = element;
    const matrix = svg.getScreenCTM();
    if (matrix === null) throw new Error("the Frame has no screen matrix");
    const screenBox = (x: number, y: number, width: number, height: number): FrameBox => {
      const start = new DOMPoint(x, y).matrixTransform(matrix);
      const end = new DOMPoint(x + width, y + height).matrixTransform(matrix);
      return {
        left: Math.min(start.x, end.x),
        top: Math.min(start.y, end.y),
        right: Math.max(start.x, end.x),
        bottom: Math.max(start.y, end.y),
      };
    };

    const area = svg.querySelector("g[data-element-id] path.map-line");
    if (!(area instanceof SVGGraphicsElement)) throw new Error("the Fill painted no area");
    const { x, y, width, height } = area.getBBox();
    const outline = screenBox(x, y, width, height);
    const vertically = (value: number) =>
      Math.min(Math.max(value, outline.top + 2), outline.bottom - 2);

    const clipGroup = Array.from(svg.querySelectorAll("g[clip-path]")).find(
      (group) => group.querySelector("path.map-line") !== null
    );
    if (clipGroup === undefined) throw new Error("the Stamps drew in no clip group");
    const stamps = Array.from(clipGroup.querySelectorAll("path.map-line"));
    if (stamps.length === 0) throw new Error("the Fill scattered no Stamp");

    const painted = (point: { x: number; y: number }) =>
      document
        .elementsFromPoint(point.x, point.y)
        .some((hit) => hit.matches("path.map-line, path.map-hit"));

    const outside: ScatterPaint["outside"] = [];
    for (const stamp of stamps) {
      const box = stamp.getBoundingClientRect();
      const samples = [
        { x: box.left + 2, y: vertically(box.top + box.height / 2) },
        { x: box.right - 2, y: vertically(box.top + box.height / 2) },
        {
          x: Math.min(Math.max(box.left + box.width / 2, outline.left + 2), outline.right - 2),
          y: box.top + 2,
        },
        {
          x: Math.min(Math.max(box.left + box.width / 2, outline.left + 2), outline.right - 2),
          y: box.bottom - 2,
        },
      ];
      for (const sample of samples) {
        const outsideBy = Math.max(
          outline.left - sample.x,
          outline.top - sample.y,
          sample.x - outline.right,
          sample.y - outline.bottom
        );
        if (outsideBy <= 0) continue;
        outside.push({ ...sample, outsideBy, painted: painted(sample) });
      }
    }

    const centre = {
      x: (outline.left + outline.right) / 2,
      y: (outline.top + outline.bottom) / 2,
    };
    return { outline, outside, inside: painted(centre) };
  });
}
