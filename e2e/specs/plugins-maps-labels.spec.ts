// The Maps editor's Map Labels (#751): the Text tool's Place Map Label button
// adds one at the view centre, the Elements list lists it selected, and the
// Frame draws its text along a baseline; a click in the Frame with the Text
// tool adds one where the pointer landed. A new label stores no text, so the
// Frame draws its prompt as an italic placeholder and the Text field shows it
// as its own, until typing replaces it (#798). From the properties panel the
// Text field rewrites the label, the Font select moves it to a bundled face the
// Frame's own folder declares, and the Bend field bows the baseline into a
// quadratic off the chord; with the Select tool the label's bend handle drags
// that curve with the pointer, which changes the Bend value. The label, its
// text, font, and bend survive a reload and reopening the Map.
//
// The handle drag is `support/frame-stroke.ts`, beside the other pointer
// gestures the drawing Frame has no key for: the panel's Bend field is the
// keyboard path to the same curve. Tagged @sandbox because Maps runs in the
// Plugin sandbox: the lane runs it on Chromium, WebKit, and Firefox.

import type { FrameLocator, Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import {
  clickPagePoint,
  dragBendHandle,
  fontLoaded,
  type LabelInk,
  labelInk,
} from "../support/frame-stroke";
import { leaveFrame, pressUntilFocused, tabTo, tabToEither } from "../support/keyboard";
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
const frameElement = (page: Page) => page.locator('[data-plugin-frame="embedded"] iframe');
const surface = (page: Page) => mapFrame(page).locator("svg");

/** The Layers card's Elements list, and one Element's row button in it. */
const elementsList = (page: Page) =>
  page.getByRole("list").filter({ has: page.getByRole("button", { name: /^More actions for / }) });
const elementRow = (page: Page, name: string) =>
  elementsList(page).getByRole("button", { name: new RegExp(`^${name}`) });

/**
 * The text a Map Label draws in the Frame. A label's halo is a second copy of
 * the same text, so a label draws two, halo first. An empty label's placeholder
 * draws the same two, italic and faded (#798).
 */
const drawnLabelText = (page: Page) => mapFrame(page).locator("g[data-element-id] text.map-line");
/** The textPath each drawn copy writes, running along the label's baseline. */
const drawnLabelPaths = (page: Page) =>
  mapFrame(page).locator("g[data-element-id] text.map-line textPath");
/** The baseline the Frame defines for the label's textPath to follow. */
const baselinePaths = (page: Page) => mapFrame(page).locator('defs path[id^="label-path-"]');
/** The bend handle a selected, unlocked Map Label draws under the Select tool. */
const bendHandle = (page: Page) => mapFrame(page).locator("[data-bend-handle]");

/** The Text tool's Place button: the keyboard path to a label at the view centre. */
const placeLabelButton = (page: Page) =>
  page.getByRole("button", { name: "Place Map Label", exact: true });

/** The properties panel's fields a Map Label takes. */
const textField = (page: Page) => page.getByRole("textbox", { name: "Text", exact: true });
const fontTrigger = (page: Page) => page.getByRole("button", { name: "Font" });
const bendField = (page: Page) => page.getByRole("textbox", { name: "Bend (mm)", exact: true });

/**
 * The Map's page defaults to the landscape preset, so its centre is 114.3 by
 * 76.2 mm, the point a keyboard Place and the default view land on.
 */
const PAGE_CENTRE_MM: readonly [number, number] = [114.3, 76.2];

/** The placeholder a new, empty Map Label draws until the author types (#798). */
const LABEL_PLACEHOLDER = "Write your text here";

/** A label baseline's three points, in page millimetres. */
interface Baseline {
  start: readonly [number, number];
  control: readonly [number, number];
  end: readonly [number, number];
}

/**
 * The three points of a label baseline's `d` attribute. A straight label and a
 * bent one take one quadratic path, so only the control point's distance from
 * the chord says how far the baseline bows.
 */
function baseline(d: string): Baseline {
  const match = /^M (-?[\d.]+) (-?[\d.]+) Q (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)$/.exec(d);
  if (match === null) throw new Error(`unexpected label baseline: ${d}`);
  const [sx, sy, cx, cy, ex, ey] = match.slice(1).map(Number);
  return { start: [sx, sy], control: [cx, cy], end: [ex, ey] };
}

/**
 * How far a baseline's control point sits off its chord: 0 when the quadratic
 * draws straight, as a bend of 0 does, and non-zero once it bows.
 */
function offChord({ start, control, end }: Baseline): number {
  return (
    (end[0] - start[0]) * (control[1] - start[1]) - (end[1] - start[1]) * (control[0] - start[0])
  );
}

/** The `d` attribute of the label's baseline path in the Frame. */
async function baselineData(page: Page): Promise<string> {
  const d = await baselinePaths(page).first().getAttribute("d");
  if (d === null) throw new Error("the Frame draws no label baseline");
  return d;
}

/**
 * Asserts the Frame laid the label's text out along its baseline, so the word
 * is painted on the page rather than only written into the markup. A text
 * length alone proves nothing: an engine that drops the textPath still reports
 * the run's length (#751), so the glyph box must also sit where the baseline
 * runs.
 */
function expectInkOnBaseline({ lengths, ink, baseline: line }: LabelInk): void {
  expect(lengths.length).toBeGreaterThan(0);
  for (const length of lengths) expect(length).toBeGreaterThan(0);
  expect(ink.right - ink.left).toBeGreaterThan(0);
  expect(ink.bottom - ink.top).toBeGreaterThan(0);
  expect(ink.left).toBeGreaterThanOrEqual(line.left - 2);
  expect(ink.right).toBeLessThanOrEqual(line.right + 2);
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

/** Opens an empty Map in its editor, where every test below starts. */
async function openEditorWithMap(page: Page): Promise<void> {
  await page.goto("/");
  await openMaps(page);
  await createMap(page, "Coastline");
  await tabTo(page, page.getByRole("button", { name: /^Coastline\b/ }), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/map$/);
  await expect(surface(page)).toBeVisible();
  await openLayers(page);
}

/** Picks the Text tool with its key and waits for the Frame to honour it. */
async function pickText(page: Page): Promise<void> {
  await page.keyboard.press("t");
  await expect(
    page.getByRole("button", { name: "Text", exact: true, pressed: true })
  ).toBeVisible();
  // The scene round-trip is what proves the Frame is listening before a press.
  await expect(mapFrame(page).locator('svg[data-tool="text"]')).toBeVisible();
}

/** Places a Map Label with the Text tool's Place button, the keyboard's way. */
async function placeLabel(page: Page): Promise<void> {
  const place = placeLabelButton(page);
  await tabTo(page, place, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(elementRow(page, "Map Label 1")).toBeVisible();
}

/** Leaves the Frame and Tabs to a control in the properties panel. */
async function focusProperties(page: Page, target: Locator): Promise<void> {
  await leaveFrame(page, frameElement(page));
  // The Text tool's Place button sits in Properties after the label's fields,
  // so a field can be behind focus, which Firefox only reaches going back.
  await tabToEither(page, target, { max: 60 });
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

/** Writes a Map Label's field with a new value: select all, type it, Enter to commit. */
async function writeField(page: Page, field: Locator, value: string): Promise<void> {
  await focusProperties(page, field);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
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

test.describe("Maps Map Labels @wf:plugins-maps-labels @sc:plugin.maibuk-maps.textTool @sc:plugin.maibuk-maps.selectTool @sandbox", () => {
  test("Place Map Label adds a label at the view centre, listed, selected, and drawn along its straight baseline", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickText(page);
    await placeLabel(page);
    // Capture before the assertions below: the base branch draws the old
    // default text, which the text assertion would stop short of.
    await capture(page, "labels-placed-straight");

    // The row calls it what it is, and the properties panel holds the new
    // label's selection.
    const row = elementRow(page, "Map Label 1");
    await expect(row).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(/^Map Label 1/);

    // The Frame draws the placeholder along the label's baseline.
    await expect(drawnLabelPaths(page).first()).toHaveText(LABEL_PLACEHOLDER);
    // The baseline runs through the page centre: a text on a path starts from
    // the path's startOffset, never from an x and y of its own (#751).
    expect(baseline(await baselineData(page)).control).toEqual(PAGE_CENTRE_MM);

    // A new label bends 0, which the Frame draws as a quadratic whose control
    // point sits on the chord: straight.
    expect(offChord(baseline(await baselineData(page)))).toBe(0);

    // The glyphs are laid out along that baseline, not collapsed at the origin.
    expectInkOnBaseline(await labelInk(surface(page)));
  });

  test("a click in the Frame with the Text tool places a Map Label where the pointer landed", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickText(page);

    // A pointer-only gesture (see `support/frame-stroke.ts`): the Frame has no
    // key that names a point on the page. The Text tool opens no Insert card,
    // and Insert no longer offers a Map Label of its own.
    await expect(page.getByRole("button", { name: "Upload…", exact: true })).toHaveCount(0);
    const point = [150, 40] as const;
    await clickPagePoint(page, surface(page), point);

    await expect(elementRow(page, "Map Label 1")).toBeVisible();
    await expect(drawnLabelPaths(page).first()).toHaveText(LABEL_PLACEHOLDER);
    // The straight baseline's control point is the label's own page point.
    const [x, y] = baseline(await baselineData(page)).control;
    expect(x).toBeCloseTo(point[0], 0);
    expect(y).toBeCloseTo(point[1], 0);

    await page.keyboard.press("i");
    await expect(page.getByRole("button", { name: "Upload…", exact: true })).toBeVisible();
    await expect(placeLabelButton(page)).toHaveCount(0);
  });

  test("the Text field rewrites the drawn label's text", async ({ page }) => {
    await openEditorWithMap(page);
    await pickText(page);
    await placeLabel(page);

    await writeField(page, textField(page), "North Sea");
    await expect(drawnLabelPaths(page).first()).toHaveText("North Sea");
    await expect(elementRow(page, "Map Label 1")).toBeVisible();
  });

  test("a new Map Label shows its prompt as an italic placeholder the Text field replaces, and clearing the field brings it back", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickText(page);
    await placeLabel(page);
    // Capture before the assertions below, which the base branch fails: it
    // stores the prompt as the label's text.
    await capture(page, "labels-placeholder");

    // The label stores no text: the field is empty and offers the prompt as
    // its placeholder, and the Frame draws that prompt italic and muted.
    await expect(textField(page)).toHaveValue("");
    await expect(textField(page)).toHaveAttribute("placeholder", LABEL_PLACEHOLDER);
    await expect(drawnLabelText(page).last()).toHaveAttribute("font-style", "italic");
    await expect(drawnLabelText(page).last()).toHaveAttribute("opacity", "0.5");
    await expect(drawnLabelPaths(page).last()).toHaveText(LABEL_PLACEHOLDER);

    // The first keys typed are the label's text: nothing to select or delete.
    await focusProperties(page, textField(page));
    await page.keyboard.type("North Sea");
    await page.keyboard.press("Enter");
    await expect(drawnLabelPaths(page).first()).toHaveText("North Sea");
    await expect(drawnLabelText(page).last()).not.toHaveAttribute("font-style", "italic");

    // Clearing the field brings the placeholder back on the Map and in the field.
    await focusProperties(page, textField(page));
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    await expect(textField(page)).toHaveValue("");
    await expect(drawnLabelText(page).last()).toHaveAttribute("font-style", "italic");
    await expect(drawnLabelPaths(page).last()).toHaveText(LABEL_PLACEHOLDER);
    await expect(elementRow(page, "Map Label 1")).toBeVisible();
  });

  test("the Font select draws the label in a bundled face declared in the Plugin's own folder", async ({
    page,
  }) => {
    // Every font file the page asks for, so the bundled face is proven local:
    // nothing may leave the app for a font.
    const fontRequests: string[] = [];
    page.on("request", (request) => {
      if (/\.(?:ttf|otf|woff2?)(?:[?#]|$)/i.test(request.url())) fontRequests.push(request.url());
    });

    await openEditorWithMap(page);
    await pickText(page);
    await placeLabel(page);

    await pickOption(page, fontTrigger(page), "Cinzel");

    // The drawn text asks for the face by its family name, and the browser
    // resolves that name to the family the Frame's linked stylesheet declares.
    const ink = drawnLabelText(page).last();
    await expect(ink).toHaveAttribute("font-family", "Cinzel");
    await expect(ink).toHaveCSS("font-family", /Cinzel/);
    // The bundled face really loaded, not just a family name the text names.
    await expect.poll(() => fontLoaded(surface(page), "Cinzel")).toBe(true);

    // The face is bundled: a font request, if the engine makes one, stays on
    // the app's own origin, inside the Plugin's folder.
    const appOrigin = new URL(page.url()).origin;
    const foreign = fontRequests.filter((url) => new URL(url).origin !== appOrigin);
    expect(foreign).toEqual([]);
  });

  test("the Bend field bows the baseline off the chord, and dragging its handle with the pointer changes the Bend value", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickText(page);
    await placeLabel(page);

    // The handle belongs to the Select tool, whose key runs from the Place
    // button without typing into anything.
    await page.keyboard.press("v");
    await expect(page.getByRole("button", { name: "Select", exact: true, pressed: true }));
    await expect(mapFrame(page).locator('svg[data-tool="select"]')).toBeVisible();

    // Bend by the number field: the keyboard path to the same curve.
    await writeField(page, bendField(page), "6");
    await expect.poll(async () => offChord(baseline(await baselineData(page)))).not.toBe(0);

    // The textPath follows that quadratic, so the drawn name is curved. (A
    // textPath's own box is empty in WebKit and Firefox, so its text and the
    // path it follows are what the assertion reads.)
    const pathId = await baselinePaths(page).first().getAttribute("id");
    await expect(drawnLabelPaths(page).first()).toHaveAttribute("href", `#${pathId}`);
    await expect(drawnLabelPaths(page).first()).toHaveText(LABEL_PLACEHOLDER);
    await capture(page, "labels-curved");
    // A curved label is painted too: its glyph box follows the bowed baseline.
    expectInkOnBaseline(await labelInk(surface(page)));

    // The handle sits on the curve's apex; a pointer drag away from the chord
    // deepens the bend the panel reports.
    const handle = bendHandle(page);
    await expect(handle).toBeVisible();
    await dragBendHandle(page, surface(page), handle, [PAGE_CENTRE_MM[0], PAGE_CENTRE_MM[1] - 10]);
    // The panel reports the bend the pointer asked for, to a tenth of a
    // millimetre: a deeper curve than the 6 the field held, and the 10 mm the
    // drag named within the engines' own rounding.
    await expect.poll(async () => Number(await bendField(page).inputValue())).toBeGreaterThan(6);
    const dragged = Number(await bendField(page).inputValue());
    expect(dragged).toBeLessThan(12);
  });

  test("the label, its text, font, and bend survive a reload and reopening the Map", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickText(page);
    await placeLabel(page);

    await writeField(page, textField(page), "North Sea");
    await pickOption(page, fontTrigger(page), "Cinzel");
    await writeField(page, bendField(page), "6");
    await expect(drawnLabelPaths(page).first()).toHaveText("North Sea");

    // Back to Maps flushes the autosave the edits queued, so the reload below
    // reads the Map from Plugin storage rather than the editor's memory.
    await leaveFrame(page, frameElement(page));
    await tabTo(page, page.getByRole("button", { name: "Back to Maps" }), {
      max: 60,
      backwards: true,
    });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/maps$/);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: /^Coastline\b/ }), { max: 60 });
    await page.keyboard.press("Enter");
    await expect(surface(page)).toBeVisible();
    // The reload put the editor back, and the floating chrome (#778) starts with
    // its Layers card shut, so the document opens it again.
    await openLayers(page);
    await expect(elementRow(page, "Map Label 1")).toBeVisible();
    await expect(drawnLabelPaths(page).first()).toHaveText("North Sea");
    await expect(drawnLabelText(page).last()).toHaveAttribute("font-family", "Cinzel");
    expect(offChord(baseline(await baselineData(page)))).not.toBe(0);
  });
});
