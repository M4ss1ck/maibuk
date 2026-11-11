// The Maps editor's Area tool and Area Fill (#750): the Area tool's key picks
// it, and a region enclosed in the Frame becomes a Fill the Elements list lists
// and the Frame paints. The author draws one by dragging in the Frame and one
// with the keyboard pen (the arrows move the crosshair, Enter adds a point, and
// Enter on the first point closes the outline); Roughen (Mod+Shift+R) redraws
// that outline and Mod+Z restores it.
//
// With the Fill selected, the properties panel's Soft Edge switch and its
// amount slider fade the drawn area, and the Texture and Scatter selects paint
// a pattern and scatter Stamps inside it.
//
// The pointer outline is `support/frame-stroke.ts`, beside the other drawing
// Frame gestures the Frame has no key for, which explains why it sits outside
// the spec. Tagged @sandbox because Maps runs in the Plugin sandbox: the lane
// runs it on Chromium, WebKit, and Firefox.

import type { FrameLocator, Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { drawArea, scatterPaint } from "../support/frame-stroke";
import { leaveFrame, pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** The Map cards, by their preview's alt text (the Map's name). */
const mapNames = (page: Page) => page.getByRole("list").getByRole("img");

/** The Map editor's embedded Frame, its iframe, and its drawing surface. */
const mapFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-plugin-frame="embedded"] iframe');
const frameElement = (page: Page) => page.locator('[data-plugin-frame="embedded"] iframe');
const surface = (page: Page) => mapFrame(page).locator("svg");

/** The Elements list and one row in it. */
const elementsList = (page: Page) => page.getByRole("listbox", { name: "Elements" });
const elementRow = (page: Page, name: string) =>
  elementsList(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** The path a Fill paints its own area with: its colour, written before any texture. */
const areaPath = (page: Page) => mapFrame(page).locator("g[data-element-id] path.map-line").first();

/** The paths a Fill paints: a Fill writes a colour where a Map Line writes none. */
const fillPaints = (page: Page) =>
  mapFrame(page).locator('g[data-element-id] path.map-line:not([fill="none"])');

/** The group the Frame wraps one Element's art in when it draws with a Soft Edge. */
const softEdgeArt = (page: Page) =>
  mapFrame(page).locator('g[data-element-id] > g[filter^="url(#soft-edge-"]');
/** The Soft Edge definitions the Frame draws, and the blur inside each one. */
const softEdgeFilters = (page: Page) => mapFrame(page).locator("defs filter");
const softEdgeBlurs = (page: Page) => mapFrame(page).locator("defs filter feGaussianBlur");
/** The texture pattern the Frame draws, and the Fill's paint that references it. */
const texturePatterns = (page: Page) => mapFrame(page).locator("defs pattern");
const texturedPaint = (page: Page, id: string) =>
  mapFrame(page).locator(`g[data-element-id] path.map-line[fill="url(#${id})"]`);
/** The Clip Path that keeps a Fill's scattered Stamps inside its area. */
const scatterClips = (page: Page) => mapFrame(page).locator("defs clipPath");
/** The scattered Stamps: art placed by a transform, where the Fill's own paint has none. */
const placedStamps = (page: Page) =>
  mapFrame(page).locator("g[data-element-id] path.map-line[transform]");
/**
 * The scattered Stamps, drawn inside the group that carries the Clip Path
 * keeping them in the Fill's area. The clip goes on the group, not on each
 * transformed path, which would carry the clip off with the art it cuts.
 */
const scatteredStamps = (page: Page) =>
  mapFrame(page).locator('g[data-element-id] g[clip-path^="url(#fill-clip-"] path.map-line');
/** The outline the Frame strokes around the selected Element. */
const selectionOutlines = (page: Page) =>
  mapFrame(page).locator("g[data-element-id] path.map-selection");

/**
 * The Map's page defaults to the landscape preset, so the keyboard crosshair
 * starts at 114.3 by 76.2 mm and Shift+Arrow steps it 10 mm.
 */
const PAGE_CENTRE_MM: readonly [number, number] = [114.3, 76.2];
/** The landscape page itself, in millimetres. */
const PAGE_MM: readonly [number, number] = [PAGE_CENTRE_MM[0] * 2, PAGE_CENTRE_MM[1] * 2];
/** The square the keyboard pen encloses: three Shift+Arrow steps each way. */
const OUTLINE_MM = 30;
const OUTLINE_SIDE_STEPS = 3;

/** How far a painted Stamp may sit outside the outline's box, in Frame pixels. */
const CLIP_TOLERANCE_PX = 0.5;

/** The page millimetres a drawn path covers, as `[left, top, right, bottom]`. */
function pathBounds(d: string): [number, number, number, number] {
  const values = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (values.length < 4 || values.length % 2 !== 0) {
    throw new Error(`unexpected Fill path: ${d}`);
  }
  const xs = values.filter((_value, index) => index % 2 === 0);
  const ys = values.filter((_value, index) => index % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The page point a placed Stamp's transform moves its art to, in millimetres. */
function placedAt(transform: string): [number, number] {
  const values = (transform.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (values.length < 2) throw new Error(`unexpected Stamp transform: ${transform}`);
  return [values[0], values[1]];
}

/** The `d` attribute a drawn Element's first path has now. */
async function pathData(path: Locator): Promise<string> {
  const d = await path.getAttribute("d");
  if (d === null) throw new Error("the drawn Element has no path");
  return d;
}

/** Opens Maps from the sidebar, waiting for the Plugin's launch scan. */
async function openMaps(page: Page): Promise<void> {
  await expect(navOption(page, "Maps")).toBeVisible({ timeout: 60_000 });
  await tabTo(page, navOption(page, "Books"), { max: 60 });
  await pressUntilFocused(page, "ArrowDown", navOption(page, "Maps"), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/maps$/);
  await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
}

/** Creates a Map from the New Map dialog by keyboard. */
async function createMap(page: Page, name: string): Promise<void> {
  const trigger = page.getByRole("button", { name: "New Map" });
  await tabTo(page, trigger, { max: 60 });
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New Map" });
  await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.type(name);
  await tabTo(page, dialog.getByRole("button", { name: "Create" }), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(mapNames(page).first()).toHaveAccessibleName(name);
}

/** Creates a Map and opens it in its editor. */
async function openEditorWithMap(page: Page): Promise<void> {
  await page.goto("/");
  await openMaps(page);
  await createMap(page, "Coastline");
  await tabTo(page, page.getByRole("button", { name: "Open Coastline" }), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/map$/);
  await expect(surface(page)).toBeVisible();
}

/** Picks the Area tool with its key and waits for the Frame to honour it. */
async function pickArea(page: Page): Promise<void> {
  await page.keyboard.press("a");
  await expect(page.getByRole("radio", { name: "Area", exact: true })).toBeChecked();
  // The scene round-trip is what proves the Frame is listening before a key.
  await expect(mapFrame(page).locator('svg[data-tool="area"]')).toBeVisible();
}

/**
 * Draws a 30 mm square with the keyboard pen while the Area tool is picked:
 * Tab into the Frame, Enter adds the first point, Shift+Arrow moves the
 * crosshair 10 mm, and the last Enter lands back on the first point, which
 * closes the outline into an Area Fill instead of adding a fifth.
 */
async function drawAreaOutline(page: Page): Promise<void> {
  await tabTo(page, frameElement(page), { max: 60 });
  await expect(frameElement(page)).toBeFocused();

  await page.keyboard.press("Enter");
  await capture(page, "area-draft");
  for (const [key, times] of [
    ["Shift+ArrowRight", OUTLINE_SIDE_STEPS],
    ["Shift+ArrowDown", OUTLINE_SIDE_STEPS],
    ["Shift+ArrowLeft", OUTLINE_SIDE_STEPS],
    ["Shift+ArrowUp", OUTLINE_SIDE_STEPS],
  ] as const) {
    for (let step = 0; step < times; step += 1) await page.keyboard.press(key);
    // The corner the crosshair stands on becomes the outline's next point.
    await page.keyboard.press("Enter");
  }

  await expect(elementRow(page, "Fill 1")).toBeVisible();
}

/** Opens a Map holding one keyboard-drawn Area Fill, its own selection. */
async function openEditorWithArea(page: Page): Promise<void> {
  await openEditorWithMap(page);
  await pickArea(page);
  await drawAreaOutline(page);
}

/** Leaves the Frame and Tabs to a control in the properties panel. */
async function focusProperties(page: Page, target: Locator): Promise<void> {
  await leaveFrame(page, frameElement(page));
  await tabTo(page, target, { max: 60 });
  await expect(target).toBeFocused();
}

/**
 * Picks one option of a panel select by keyboard: Enter opens its list, Home
 * goes to the first entry (a previous pick leaves the list where it was), and
 * the arrows walk to the named one, which Enter takes.
 */
async function pickOption(page: Page, trigger: Locator, option: string): Promise<void> {
  await focusProperties(page, trigger);
  await page.keyboard.press("Enter");
  const item = page.getByRole("option", { name: option, exact: true });
  await expect(item).toBeVisible();
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", item, { max: 40 });
  await page.keyboard.press("Enter");
  await expect(trigger).toContainText(option);
}

test.use({
  library: "bookShelf",
  plugins: ["maibuk-maps"],
  pluginApprovals: [
    {
      pluginId: "maibuk-maps",
      granted: ["library:read", "editor:write", "files:pick", "files:save"],
    },
  ],
  builtInPlugins: [{ id: "maibuk-maps" }],
});

test.describe("Maps Area tool and Area Fill @wf:plugins-maps-area @sc:plugin.maibuk-maps.areaTool @sc:plugin.maibuk-maps.roughen @sandbox", () => {
  test("a drag in the Frame with the Area tool encloses the stroke as a Fill the Elements list lists", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickArea(page);

    // A pointer-only gesture (see `support/frame-stroke.ts`): the Area tool has
    // no key that traces a region, only its point-by-point keyboard form below.
    await drawArea(page, surface(page));

    const row = elementRow(page, "Fill 1");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Fill");
    await expect(fillPaints(page)).toHaveCount(1);

    // The stroke the pointer enclosed is one closed ring with a real area.
    const [left, top, right, bottom] = pathBounds(await pathData(areaPath(page)));
    expect(right - left).toBeGreaterThan(1);
    expect(bottom - top).toBeGreaterThan(1);
    expect(left).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(0);
    expect(right).toBeLessThan(PAGE_MM[0]);
    expect(bottom).toBeLessThan(PAGE_MM[1]);
    await capture(page, "area-pointer");
  });

  test("the keyboard pen draws a closed Area Fill outline, which Enter on the first point closes", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickArea(page);

    // The Frame keeps every key of the outline, so nothing is left in progress
    // once the last Enter lands on the first point.
    await drawAreaOutline(page);
    await expect(mapFrame(page).locator("path.map-live")).toHaveCount(0);
    await expect(fillPaints(page)).toHaveCount(1);

    // The four points the author pointed out are the corners of a 30 mm square.
    const [left, top, right, bottom] = pathBounds(await pathData(areaPath(page)));
    expect(left).toBeCloseTo(PAGE_CENTRE_MM[0], 1);
    expect(top).toBeCloseTo(PAGE_CENTRE_MM[1], 1);
    expect(right).toBeCloseTo(PAGE_CENTRE_MM[0] + OUTLINE_MM, 1);
    expect(bottom).toBeCloseTo(PAGE_CENTRE_MM[1] + OUTLINE_MM, 1);
    // Four corners with straight segments, and the closing Z the last Enter gave.
    const d = await pathData(areaPath(page));
    expect(d.match(/ L /g) ?? []).toHaveLength(3);
    expect(d).toMatch(/ Z$/);
    await capture(page, "area-keyboard");
  });

  test("Roughens the Area Fill's outline by its Shortcut, and Mod+Z restores it", async ({
    page,
  }) => {
    await openEditorWithArea(page);
    await leaveFrame(page, frameElement(page));
    // The Roughen Shortcut runs from a plain panel control, which the Back
    // button is, and acts on the Fill the pen just selected.
    await tabTo(page, page.getByRole("button", { name: "Back to Maps" }), {
      max: 60,
      backwards: true,
    });

    const before = await pathData(areaPath(page));
    await page.keyboard.press("ControlOrMeta+Shift+r");
    await expect.poll(() => pathData(areaPath(page))).not.toBe(before);
    // The outline is redrawn with the ink's own wobble, not replaced by
    // something else: it keeps its extent.
    const bounds = pathBounds(await pathData(areaPath(page)));
    expect(bounds[2] - bounds[0]).toBeGreaterThan(OUTLINE_MM / 2);
    await capture(page, "area-roughen");

    // One undo step puts the exact outline back.
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => pathData(areaPath(page))).toBe(before);
  });
});

test.describe("Maps Soft Edge and Fill content @wf:plugins-maps-fill-content @sc:plugin.maibuk-maps.areaTool @sandbox", () => {
  test("Soft Edge turns on from the properties panel and the Frame draws the fade, which the amount slider deepens", async ({
    page,
  }) => {
    await openEditorWithArea(page);
    await expect(fillPaints(page)).toHaveCount(1);

    const toggle = page.getByRole("switch", { name: "Soft Edge", exact: true });
    await focusProperties(page, toggle);
    await expect(toggle).not.toBeChecked();
    await page.keyboard.press(" ");

    // The switch fades the Fill: the Frame wraps its art in the blur definition.
    await expect(toggle).toBeChecked();
    await expect(softEdgeArt(page)).toHaveCount(1);
    await expect(softEdgeFilters(page)).toHaveCount(1);
    const blur = softEdgeBlurs(page).first();
    await expect(blur).toHaveAttribute("stdDeviation", "2");
    await expect(fillPaints(page)).toHaveCount(1);

    // The amount slider is the author's own depth, one step at a time.
    const amount = page.getByRole("slider", { name: "Soft Edge amount (mm)", exact: true });
    await tabTo(page, amount, { max: 10 });
    await expect(amount).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(softEdgeBlurs(page).first()).toHaveAttribute("stdDeviation", "2.5");
    await expect(softEdgeArt(page)).toHaveCount(1);
    await capture(page, "area-soft-edge");
  });

  test("a Fill takes a texture and a scatter, and the Frame draws the Stamps inside the area", async ({
    page,
  }) => {
    await openEditorWithArea(page);
    await expect(fillPaints(page)).toHaveCount(1);
    const [left, top, right, bottom] = pathBounds(await pathData(areaPath(page)));

    // The texture paints the area with its own pattern, defined once in the Frame.
    await pickOption(page, page.getByRole("button", { name: "Texture" }), "Grass");
    await expect(texturePatterns(page)).toHaveCount(1);
    await expect(texturePatterns(page).first()).toHaveAttribute("id", "texture-grass");
    await expect(texturedPaint(page, "texture-grass")).toHaveCount(1);

    // The scatter drops the picked Stamp over the area, clipped to its outline.
    await pickOption(page, page.getByRole("button", { name: "Scatter" }), "Castle");
    await expect(scatterClips(page)).toHaveCount(1);
    const stamps = scatteredStamps(page);
    // Every Stamp the Fill scatters is clipped to its area, not only the ones
    // that happen to land inside it.
    await expect(stamps).toHaveCount(await placedStamps(page).count());
    await expect(stamps.first()).toBeVisible();
    const points = await Promise.all(
      (await stamps.all()).map(async (path) => {
        const transform = await path.getAttribute("transform");
        if (transform === null) throw new Error("a scattered Stamp has no transform");
        return placedAt(transform);
      })
    );
    const unique = new Set(points.map(([x, y]) => `${x},${y}`));
    expect(unique.size).toBeGreaterThanOrEqual(4);

    // Every Stamp lands on a point inside the outline the author drew.
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(left);
      expect(x).toBeLessThanOrEqual(right);
      expect(y).toBeGreaterThanOrEqual(top);
      expect(y).toBeLessThanOrEqual(bottom);
    }

    // Nothing scattered paints outside the area. The browser paints a Stamp
    // only where its art meets the Clip Path the Frame draws it in, and answers
    // a hit only where it paints, so every point where a Stamp's own box
    // reaches past the outline must be clear of the Fill's ink.
    const paint = await scatterPaint(surface(page));
    // A Stamp may sit a hair past the outline, so only points further out than
    // the tolerance claim that anything scattered paints outside the area.
    const spill = paint.outside.filter((sample) => sample.outsideBy > CLIP_TOLERANCE_PX);
    expect(spill.length).toBeGreaterThan(0);
    for (const sample of spill) expect(sample.painted).toBe(false);
    // The Stamps do paint inside the area, so that silence is the clip at work.
    expect(paint.inside).toBe(true);

    // The selection marks the Fill's area outline alone: one highlight, tracing
    // the area's own path, instead of one stroked around every scattered Stamp.
    const outlines = selectionOutlines(page);
    await expect(outlines).toHaveCount(1);
    expect(await pathData(outlines.first())).toBe(await pathData(areaPath(page)));

    await capture(page, "area-texture-scatter");
  });
});
