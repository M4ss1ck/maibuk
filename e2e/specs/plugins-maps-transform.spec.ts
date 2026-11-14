// The Maps editor's transform handles and keyboard scale and turn Commands
// (#795, #796): with Select picked, a selected Stamp draws a box with a grip
// on each corner and a turn grip on a stalk above it. A corner drag resizes it
// uniformly and the turn grip turns it, and the properties panel's Size (mm)
// and Rotation (degrees) follow; each committed drag is one undo step, so one
// Mod+Z puts the number back. A selected Shape draws eight grips plus the turn
// grip: a side drag stretches the one axis the panel's Width (mm) and Height
// (mm) report. A selected Map Label draws corners, its left and right sides,
// and the turn grip: a corner drag scales its cap Size (mm) and Width (mm)
// together. The scale and turn Commands do the same from the keyboard: ] and [
// scale 10% (Shift: 1%), . and , turn 15° (Shift: 1°).
//
// The drags are `support/frame-stroke.ts`, which explains why the pointer
// gestures sit outside the spec: the Commands are their keyboard form.
// Tagged @sandbox because Maps runs in the Plugin sandbox: the lane runs it on
// Chromium, WebKit, and Firefox.

import type { FrameLocator, Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { dragTransformHandle } from "../support/frame-stroke";
import { leaveFrame, tabTo, tabToEither } from "../support/keyboard";
import { createMap, openLayers, openMap, openMaps } from "../support/maps-layers";
import { expect, test } from "../support/test";

/** The Map editor's embedded Frame, its iframe, and its drawing surface. */
const mapFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-plugin-frame="embedded"] iframe');
const frameElement = (page: Page) => page.locator('[data-plugin-frame="embedded"] iframe');
const surface = (page: Page) => mapFrame(page).locator("svg");

/** The Layers card's Elements list, and one Element's row button in it. */
const elementsList = (page: Page) =>
  page.getByRole("list").filter({ has: page.getByRole("button", { name: /^More actions for / }) });
const elementRow = (page: Page, name: string) =>
  elementsList(page).getByRole("button", { name: new RegExp(`^${name}`) });

/** The properties panel's number fields for a selected Shape or Map Label. */
const widthField = (page: Page) => page.getByRole("textbox", { name: "Width (mm)", exact: true });
const heightField = (page: Page) => page.getByRole("textbox", { name: "Height (mm)", exact: true });
const sizeField = (page: Page) => page.getByRole("textbox", { name: "Size (mm)", exact: true });
const rotationField = (page: Page) =>
  page.getByRole("textbox", { name: "Rotation (degrees)", exact: true });

/**
 * One of the transform grips the Frame draws on the selection (#795), by the
 * target a press lands on rather than the square it draws.
 */
const transformHandle = (page: Page, id: string) =>
  mapFrame(page).locator(`[data-transform-handle-hit="${id}"]`);

/** Every grip the Frame draws: corners, sides, and the turn grip, unless it drops them. */
const drawnHandles = (page: Page) => mapFrame(page).locator("[data-transform-handle]");

/** One tile of the Insert tool's Stamp grid: a button holding the Stamp's own picture. */
const stampTile = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).filter({ has: page.locator("img") });

/**
 * The Map's page is the landscape preset, so its centre is 114.3 by 76.2 mm:
 * the point a Stamp placed from the Insert card lands on.
 */
const PAGE_CENTRE_MM: readonly [number, number] = [114.3, 76.2];

/** A number field's value as the author reads it, with the unit left out. */
async function fieldValue(field: Locator): Promise<number> {
  const text = await field.inputValue();
  const value = Number(text.replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(value)) throw new Error(`the field reads "${text}"`);
  return value;
}

/** Opens an empty Map in its editor, where every test below starts. */
async function openEditorWithMap(page: Page): Promise<void> {
  await page.goto("/");
  await openMaps(page);
  await createMap(page, "Coastline");
  await openMap(page, "Coastline");
  await openLayers(page);
}

/** Picks the Insert tool with its key and waits for the Frame to honour it. */
async function pickInsert(page: Page): Promise<void> {
  await page.keyboard.press("i");
  await expect(page.getByRole("button", { name: "Insert", exact: true, pressed: true }));
  // The scene round-trip is what proves the Frame is listening before a pick.
  await expect(mapFrame(page).locator('svg[data-tool="insert"]')).toBeVisible();
}

/**
 * Places one built-in Stamp at the view centre: its tile, then the Place button
 * named after the pick, which is the keyboard's way to drop one.
 */
async function placeStamp(page: Page, name: string): Promise<void> {
  await tabToEither(page, stampTile(page, name), { max: 90 });
  await page.keyboard.press("Enter");
  const place = page.getByRole("button", { name: `Place ${name}`, exact: true });
  await tabTo(page, place, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(elementRow(page, name)).toBeVisible();
}

/** Focuses Back to Maps, a plain panel control outside the Frame. */
async function focusBack(page: Page): Promise<void> {
  await leaveFrame(page, frameElement(page));
  await tabTo(page, page.getByRole("button", { name: "Back to Maps" }), {
    max: 60,
    backwards: true,
  });
}

/** Picks the Rectangle tool with its key and waits for the Frame to honour it. */
async function pickRectangle(page: Page): Promise<void> {
  await page.keyboard.press("r");
  await expect(
    page.getByRole("button", { name: "Rectangle", exact: true, pressed: true })
  ).toBeVisible();
  await expect(mapFrame(page).locator('svg[data-tool="rectangle"]')).toBeVisible();
}

/** Places a Rectangle with its Place button, the keyboard's way to draw one. */
async function placeRectangle(page: Page): Promise<void> {
  const place = page.getByRole("button", { name: "Place rectangle", exact: true });
  await tabTo(page, place, { max: 120 });
  await page.keyboard.press("Enter");
  await expect(elementRow(page, "Rectangle 1")).toBeVisible();
}

/** Picks the Text tool with its key and waits for the Frame to honour it. */
async function pickText(page: Page): Promise<void> {
  await page.keyboard.press("t");
  await expect(
    page.getByRole("button", { name: "Text", exact: true, pressed: true })
  ).toBeVisible();
  await expect(mapFrame(page).locator('svg[data-tool="text"]')).toBeVisible();
}

/** Places a Map Label with the Text tool's Place button, the keyboard's way. */
async function placeLabel(page: Page): Promise<void> {
  const place = page.getByRole("button", { name: "Place Map Label", exact: true });
  await tabTo(page, place, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(elementRow(page, "Map Label 1")).toBeVisible();
}

/** Picks the Select tool with its key, which is when the handles appear. */
async function pickSelect(page: Page): Promise<void> {
  await focusBack(page);
  await page.keyboard.press("v");
  await expect(
    page.getByRole("button", { name: "Select", exact: true, pressed: true })
  ).toBeVisible();
  // The scene round-trip is what proves the Frame is listening before a drag.
  await expect(mapFrame(page).locator('svg[data-tool="select"]')).toBeVisible();
}

/**
 * Gives the selected Stamp a size the author types into the properties panel.
 * The default 12 mm Stamp is only 58 px wide on this page, near the 48 px where
 * the Frame keeps one corner grip alone, so the Stamp drags below start from a
 * size with room for a corner to be grabbed on its own. (A Map Label needs no
 * such step: a default cap keeps only its bottom-right grip, which is the one
 * the corner drag takes.)
 */
async function setSize(page: Page, size: number): Promise<void> {
  const field = sizeField(page);
  await tabToEither(page, field, { max: 120 });
  await page.keyboard.press("Control+a");
  await page.keyboard.type(String(size));
  await page.keyboard.press("Enter");
  await expect(field).toHaveValue(String(size));
}

/** Places a Castle at the view centre, sized to `size` mm, with Select picked. */
async function placeSizedStamp(page: Page, size: number): Promise<void> {
  await openEditorWithMap(page);
  await pickInsert(page);
  await placeStamp(page, "Castle");
  await setSize(page, size);
  await pickSelect(page);
  await expect(drawnHandles(page)).toHaveCount(5);
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

test.describe("Maps transform handles and scale and turn Commands @wf:plugins-maps-transform @sc:plugin.maibuk-maps.insertTool @sc:plugin.maibuk-maps.selectTool @sc:plugin.maibuk-maps.scaleUp @sc:plugin.maibuk-maps.scaleDown @sc:plugin.maibuk-maps.scaleUpFine @sc:plugin.maibuk-maps.scaleDownFine @sc:plugin.maibuk-maps.rotateClockwise @sc:plugin.maibuk-maps.rotateCounterClockwise @sc:plugin.maibuk-maps.rotateClockwiseFine @sc:plugin.maibuk-maps.rotateCounterClockwiseFine @sc:plugin.maibuk-maps.undo @sandbox", () => {
  test("a corner drag resizes the Stamp, the panel follows, and Mod+Z puts it back", async ({
    page,
  }) => {
    await placeSizedStamp(page, 40);

    // The grip sits on the box's bottom-right corner, a page point the drag can
    // name: the box is 40 mm about the centre, so the corner is at 134.3 by 96.2.
    await expect(transformHandle(page, "se")).toBeVisible();
    await dragTransformHandle(page, surface(page), transformHandle(page, "se"), [150, 110]);

    // A drag anchored on the opposite corner grows the box on both axes, so the
    // Size the panel shows is the drag's own: 55.7 mm from that corner.
    await expect.poll(async () => fieldValue(sizeField(page))).toBeCloseTo(55.7, 0);
    await expect(rotationField(page)).toHaveValue("0");
    await capture(page, "maps-transform-resize", {
      around: [frameElement(page), sizeField(page), rotationField(page)],
    });

    // The whole drag was one undo step: one Mod+Z hands the Stamp back its size.
    await focusBack(page);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => fieldValue(sizeField(page))).toBe(40);
  });

  test("the turn handle turns the Stamp, the panel follows, and Mod+Z puts it back", async ({
    page,
  }) => {
    await placeSizedStamp(page, 40);

    // The turn grip starts straight above the centre, and the drag ends 45°
    // round from it on the same circle: 45° clockwise from the upright.
    await expect(transformHandle(page, "rotate")).toBeVisible();
    const at = (degrees: number): [number, number] => [
      PAGE_CENTRE_MM[0] + 20 * Math.cos((degrees * Math.PI) / 180),
      PAGE_CENTRE_MM[1] + 20 * Math.sin((degrees * Math.PI) / 180),
    ];
    await dragTransformHandle(page, surface(page), transformHandle(page, "rotate"), at(-45));

    await expect.poll(async () => fieldValue(rotationField(page))).toBeCloseTo(45, 0);
    await expect(sizeField(page)).toHaveValue("40");
    await capture(page, "maps-transform-rotate", {
      around: [frameElement(page), sizeField(page), rotationField(page)],
    });

    // One turn, one undo step.
    await focusBack(page);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => fieldValue(rotationField(page))).toBe(0);
  });

  test("the scale and turn Commands change the selection in steps, each press one undo step", async ({
    page,
  }) => {
    await placeSizedStamp(page, 40);

    // The Commands run from a plain panel control, the way the move Commands do.
    await focusBack(page);

    // ] and [ scale 10%; Shift makes the step 1%.
    await page.keyboard.press("]");
    await expect.poll(async () => fieldValue(sizeField(page))).toBeCloseTo(44, 1);
    await page.keyboard.press("Shift+]");
    await expect.poll(async () => fieldValue(sizeField(page))).toBeCloseTo(44.44, 1);
    await page.keyboard.press("[");
    await expect.poll(async () => fieldValue(sizeField(page))).toBeCloseTo(39.996, 1);
    await page.keyboard.press("Shift+[");
    await expect.poll(async () => fieldValue(sizeField(page))).toBeCloseTo(39.596, 1);

    // . and , turn 15°; Shift makes the step 1°.
    await page.keyboard.press(".");
    await expect.poll(async () => fieldValue(rotationField(page))).toBe(15);
    await page.keyboard.press("Shift+.");
    await expect.poll(async () => fieldValue(rotationField(page))).toBe(16);
    await page.keyboard.press(",");
    await expect.poll(async () => fieldValue(rotationField(page))).toBe(1);
    await page.keyboard.press("Shift+,");
    await expect.poll(async () => fieldValue(rotationField(page))).toBe(0);

    // Each press was its own undo step, so one Mod+Z takes back the last turn.
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => fieldValue(rotationField(page))).toBe(1);
  });

  test("a side drag stretches the Shape's width, the panel follows, and Mod+Z puts it back", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickRectangle(page);
    await placeRectangle(page);
    await pickSelect(page);

    // A Shape takes eight grips plus the turn grip, all with room at 40 mm.
    await expect(drawnHandles(page)).toHaveCount(9);

    // The east grip sits on the box's right edge, 134.3 mm about the centre of
    // the 40 mm box; dragging it to 150 widens by that travel alone.
    await expect(transformHandle(page, "e")).toBeVisible();
    await dragTransformHandle(page, surface(page), transformHandle(page, "e"), [
      150,
      PAGE_CENTRE_MM[1],
    ]);

    // A side drag moves its one axis: the Width the panel shows is the drag's
    // own, 55.7 mm, while the Height keeps the 40 the Place button gave.
    await expect.poll(async () => fieldValue(widthField(page))).toBeCloseTo(55.7, 0);
    await expect(heightField(page)).toHaveValue("40");
    await capture(page, "maps-transform-shape-side", {
      around: [frameElement(page), widthField(page), heightField(page)],
    });

    // The whole drag was one undo step: one Mod+Z hands the Shape back its width.
    await focusBack(page);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => fieldValue(widthField(page))).toBe(40);
    await expect(heightField(page)).toHaveValue("40");
  });

  test("a corner drag scales the Map Label's cap size and width, and Mod+Z puts both back", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickText(page);
    await placeLabel(page);
    await pickSelect(page);

    // Every grip draws at the default 6 mm cap: four corners, the two sides,
    // and the turn grip. The sides' hit areas overlap the corners' on a label
    // this short, and the corners stack above them, so the press takes the corner.
    await expect(drawnHandles(page)).toHaveCount(7);

    // The box stands on the baseline, so its bottom-right grip sits on the
    // baseline's right end, 27.5 mm right of the label's anchor; the drag ends
    // 10.2 right and 0.8 down from there.
    await expect(transformHandle(page, "se")).toBeVisible();
    await dragTransformHandle(page, surface(page), transformHandle(page, "se"), [152, 77]);

    // A corner drag grows the cap size and the width together: the Width the
    // panel shows is the drag's own, 65.2 mm, and the cap Size follows the same
    // scale, 7.1 mm.
    await expect.poll(async () => fieldValue(widthField(page))).toBeCloseTo(65.2, 0);
    await expect.poll(async () => fieldValue(sizeField(page))).toBeCloseTo(7.1, 0);
    await capture(page, "maps-transform-label-corner", {
      around: [frameElement(page), sizeField(page), widthField(page)],
    });

    // The whole drag was one undo step: one Mod+Z hands the label back its
    // width and cap size together.
    await focusBack(page);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => fieldValue(widthField(page))).toBe(55);
    await expect.poll(async () => fieldValue(sizeField(page))).toBe(6);
  });
});
