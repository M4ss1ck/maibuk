// The Maps editor's Select drag (#766): with Select, a press on a Map Line,
// Shape, or Stamp picks it, and a drag moves it live in the Frame; the release
// commits the move as one undo step, through the same path the arrow Commands
// take, so a Fill poured into a Rectangle follows the Rectangle. Shift keeps
// the drag straight across or down, Escape puts the Element back, and a press
// that never travels only selects.
//
// The keyboard form of a move is the arrow Commands, which
// `plugins-maps-editor` and `plugins-maps-stamps` already drive. The drag is a
// pointer gesture by nature, so it lives in `support/frame-stroke.ts` beside
// the other drawing-Frame gestures, which explains why it sits outside the
// spec. Tagged @sandbox because Maps runs in the Plugin sandbox: the lane runs
// it on Chromium, WebKit, and Firefox.

import type { FrameLocator, Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { clickPagePoint, dragPagePoint } from "../support/frame-stroke";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";
import { openLayers } from "../support/maps-layers";

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** The Map cards, by their preview's alt text (the Map's name). */
const mapNames = (page: Page) => page.getByRole("list").getByRole("img");

/** The Map editor's embedded Frame, its iframe, and its drawing surface. */
const mapFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-plugin-frame="embedded"] iframe');
const surface = (page: Page) => mapFrame(page).locator("svg");

/** The Layers card's Elements list, and one Element's row button in it. */
const elementsList = (page: Page) =>
  page.getByRole("list").filter({ has: page.getByRole("button", { name: /^More actions for / }) });
const elementRow = (page: Page, name: string) =>
  elementsList(page).getByRole("button", { name: new RegExp(`^${name}`) });

/** The ink of the Map Lines the Frame draws, and the Fills it draws filled. */
const linePath = (page: Page) =>
  mapFrame(page).locator('g[data-element-id] path.map-line[fill="none"]').first();
const fillPath = (page: Page) =>
  mapFrame(page).locator('g[data-element-id] path.map-line:not([fill="none"])').first();
const drawnElements = (page: Page) => mapFrame(page).locator("g[data-element-id]");

/**
 * The Map's page defaults to the landscape preset, so its centre is 114.3 by
 * 76.2 mm, where a placed Rectangle (40 mm square) and a placed Stamp land.
 */
const PAGE_CENTRE_MM: readonly [number, number] = [114.3, 76.2];
const RECTANGLE_LEFT_MM = PAGE_CENTRE_MM[0] - 20;
const RECTANGLE_TOP_MM = PAGE_CENTRE_MM[1] - 20;
/** The middle of the placed Rectangle's left side: a point on its ink. */
const RECTANGLE_EDGE_MM: readonly [number, number] = [RECTANGLE_LEFT_MM, PAGE_CENTRE_MM[1]];

/** Opens Maps from the sidebar, waiting for the Plugin's launch scan. */
async function openMaps(page: Page): Promise<void> {
  await expect(navOption(page, "Maps")).toBeVisible({ timeout: 60_000 });
  await tabTo(page, navOption(page, "Books"), { max: 60 });
  await pressUntilFocused(page, "ArrowDown", navOption(page, "Maps"), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/maps$/);
  await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
}

/** Creates a Map from the New Map dialog by keyboard and opens it in its editor. */
async function openEditorWithMap(page: Page): Promise<void> {
  await page.goto("/");
  await openMaps(page);
  await tabTo(page, page.getByRole("button", { name: "New Map" }), { max: 60 });
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New Map" });
  await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.type("Coastline");
  await tabTo(page, dialog.getByRole("button", { name: "Create" }), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(mapNames(page).first()).toHaveAccessibleName("Coastline");
  await tabTo(page, page.getByRole("button", { name: /^Coastline\b/ }), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/map$/);
  await expect(surface(page)).toBeVisible();
  await openLayers(page);
}

/** Places a Rectangle at the view centre with the Rectangle tool's Place button. */
async function placeRectangle(page: Page): Promise<void> {
  await page.keyboard.press("r");
  await expect(page.getByRole("button", { name: "Rectangle", exact: true, pressed: true }));
  await expect(mapFrame(page).locator('svg[data-tool="rectangle"]')).toBeVisible();
  const place = page.getByRole("button", { name: "Place rectangle" });
  await tabTo(page, place, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(elementRow(page, "Rectangle 1")).toBeVisible();
}

/** Picks a tool with its key and waits for the Frame to honour it. */
async function pickTool(page: Page, key: string, name: string, tool: string): Promise<void> {
  await page.keyboard.press(key);
  // The floating belt (#778) presses its tool buttons rather than checking a
  // radio, the way `plugins-maps-fills` already reports the Bucket.
  await expect(page.getByRole("button", { name, exact: true, pressed: true })).toBeVisible();
  // The scene round-trip is what proves the Frame is listening before a press.
  await expect(mapFrame(page).locator(`svg[data-tool="${tool}"]`)).toBeVisible();
}

/** The top-left corner of a drawn path's box, in page millimetres. */
async function topLeft(path: Locator): Promise<[number, number]> {
  const d = await path.getAttribute("d");
  if (d === null) throw new Error("the drawn path has no d");
  const values = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (values.length < 4 || values.length % 2 !== 0) throw new Error(`unexpected path: ${d}`);
  const xs = values.filter((_value, index) => index % 2 === 0);
  const ys = values.filter((_value, index) => index % 2 === 1);
  return [Math.min(...xs), Math.min(...ys)];
}

/** The page point a drawn Stamp sits at, from its first path's transform. */
async function stampPoint(element: Locator): Promise<[number, number]> {
  const transform = await element.locator("path.map-line").first().getAttribute("transform");
  if (transform === null) throw new Error("the drawn Stamp has no transform");
  const values = (transform.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (values.length < 2) throw new Error(`unexpected Stamp transform: ${transform}`);
  return [values[0], values[1]];
}

/**
 * How close a dragged corner must land, in mm. The mouse moves in whole screen
 * pixels, about half a millimetre each on this page, and both ends of a drag
 * round, so a drag lands within a pixel of the offset it aimed at.
 */
const DRAG_TOLERANCE_MM = 0.6;

/** Waits for a drawn path's top-left corner to settle at `expected`, to a pixel. */
async function expectTopLeft(path: Locator, expected: readonly [number, number]): Promise<void> {
  await expect
    .poll(async () => {
      const [x, y] = await topLeft(path);
      const near = (value: number, target: number) =>
        Math.abs(value - target) <= DRAG_TOLERANCE_MM ? target : value;
      return [near(x, expected[0]), near(y, expected[1])];
    })
    .toEqual([expected[0], expected[1]]);
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

test.describe("Maps Select drag @wf:plugins-maps-move @sc:plugin.maibuk-maps.selectTool @sc:plugin.maibuk-maps.rectangleTool @sc:plugin.maibuk-maps.bucketTool @sc:plugin.maibuk-maps.insertTool @sc:plugin.maibuk-maps.moveRightFar @sandbox", () => {
  test("a Select drag moves a Rectangle and the Fill poured into it, and Mod+Z puts both back in one step", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await placeRectangle(page);
    await pickTool(page, "b", "Bucket", "bucket");
    await clickPagePoint(page, surface(page), PAGE_CENTRE_MM);
    await expect(elementRow(page, "Fill 1")).toBeVisible();
    await expectTopLeft(fillPath(page), [RECTANGLE_LEFT_MM, RECTANGLE_TOP_MM]);

    await pickTool(page, "v", "Select", "select");
    // A press that never travels only selects. Picking the Rectangle first lets
    // the host's Properties panel settle, which can resize the Frame, before
    // the drag's screen points are worked out from the Frame's box.
    await clickPagePoint(page, surface(page), RECTANGLE_EDGE_MM);
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(/^Rectangle 1/);
    await expectTopLeft(linePath(page), [RECTANGLE_LEFT_MM, RECTANGLE_TOP_MM]);
    await dragPagePoint(
      page,
      surface(page),
      RECTANGLE_EDGE_MM,
      [RECTANGLE_EDGE_MM[0] + 30, RECTANGLE_EDGE_MM[1] + 10],
      {
        during: async () => {
          // Live in the Frame: the Rectangle follows the pointer before the release.
          await expect(mapFrame(page).locator('g[data-dragging="true"]')).toHaveCount(1);
          await capture(page, "maps-move-drag");
        },
      }
    );

    // The release commits the move, and the Fill follows its Rectangle.
    await expectTopLeft(linePath(page), [RECTANGLE_LEFT_MM + 30, RECTANGLE_TOP_MM + 10]);
    await expectTopLeft(fillPath(page), [RECTANGLE_LEFT_MM + 30, RECTANGLE_TOP_MM + 10]);
    await expect(mapFrame(page).locator("g[data-dragging], g[transform]")).toHaveCount(0);
    await capture(page, "maps-move-done");

    // The whole drag is one undo step, the Fill's move included.
    await page.keyboard.press("ControlOrMeta+z");
    await expectTopLeft(linePath(page), [RECTANGLE_LEFT_MM, RECTANGLE_TOP_MM]);
    await expectTopLeft(fillPath(page), [RECTANGLE_LEFT_MM, RECTANGLE_TOP_MM]);
    await expect(elementRow(page, "Fill 1")).toBeVisible();
  });

  test("Shift keeps the drag straight, and Escape during a drag puts the Rectangle back", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await placeRectangle(page);
    await pickTool(page, "v", "Select", "select");

    // Mostly rightwards with Shift: the Rectangle slides straight across.
    await dragPagePoint(
      page,
      surface(page),
      RECTANGLE_EDGE_MM,
      [RECTANGLE_EDGE_MM[0] + 25, RECTANGLE_EDGE_MM[1] + 6],
      { constrain: true }
    );
    await expectTopLeft(linePath(page), [RECTANGLE_LEFT_MM + 25, RECTANGLE_TOP_MM]);

    // Escape with the button still down cancels the drag, so the release moves nothing.
    const movedEdge: readonly [number, number] = [RECTANGLE_EDGE_MM[0] + 25, RECTANGLE_EDGE_MM[1]];
    await dragPagePoint(page, surface(page), movedEdge, [movedEdge[0] - 40, movedEdge[1] + 20], {
      during: async () => {
        await expect(mapFrame(page).locator('g[data-dragging="true"]')).toHaveCount(1);
        await page.keyboard.press("Escape");
        await expect(mapFrame(page).locator('g[data-dragging="true"]')).toHaveCount(0);
      },
    });
    await expectTopLeft(linePath(page), [RECTANGLE_LEFT_MM + 25, RECTANGLE_TOP_MM]);

    // The cancelled drag left no undo step: one Mod+Z undoes the Shift drag.
    await page.keyboard.press("ControlOrMeta+z");
    await expectTopLeft(linePath(page), [RECTANGLE_LEFT_MM, RECTANGLE_TOP_MM]);
  });

  test("a press on a Stamp only selects it, and a drag moves it where the pointer let go", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickTool(page, "i", "Insert", "insert");
    // The Insert tool offers one Place button, named after the picked Stamp.
    // The floating chrome's footer also offers "Place in a Chapter or Note…",
    // which shares the prefix, so the name has to rule that one out.
    const place = page.getByRole("button", { name: /^Place (?!in a Chapter)/ });
    // The floating chrome puts the pill, the twelve tool buttons, the Stamp
    // grid's tiles and the cards between the author and the Place button.
    await tabTo(page, place, { max: 120 });
    const stamp = (
      (await place.getAttribute("aria-label")) ??
      (await place.textContent()) ??
      ""
    ).replace(/^Place /, "");
    await page.keyboard.press("Enter");
    await expect(elementRow(page, stamp)).toBeVisible();
    await expect(drawnElements(page)).toHaveCount(1);

    // Placing leaves the Stamp selected; a press on the page around it lets go,
    // and a press on the Stamp that never travels picks it again in place.
    await pickTool(page, "v", "Select", "select");
    await clickPagePoint(page, surface(page), [20, 20]);
    // Nothing is selected, so the properties panel shows no Name field.
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveCount(0);
    await clickPagePoint(page, surface(page), PAGE_CENTRE_MM);
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(new RegExp(`^${stamp}`));
    const drawn = drawnElements(page).first();
    const [x, y] = await stampPoint(drawn);
    expect(x).toBeCloseTo(PAGE_CENTRE_MM[0], 1);
    expect(y).toBeCloseTo(PAGE_CENTRE_MM[1], 1);

    await dragPagePoint(page, surface(page), PAGE_CENTRE_MM, [60, 50]);
    await expect.poll(async () => (await stampPoint(drawn))[0]).toBeCloseTo(60, 0);
    expect((await stampPoint(drawn))[1]).toBeCloseTo(50, 0);

    // The arrow Commands still move the dragged Stamp, the keyboard's way: the
    // Frame keeps focus after the drag and forwards the key to the host (#760).
    const [movedX] = await stampPoint(drawn);
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(async () => (await stampPoint(drawn))[0]).toBeCloseTo(movedX + 10, 1);
  });
});
