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
  dblclickPagePoint,
  dragBendHandle,
  dblclickLabelInk,
  dragTransformHandle,
  fontLoaded,
  type LabelInk,
  labelInk,
  labelLineBaselines,
  millimetresPerPixel,
  textBoxGeometry,
  wheelAt,
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
/** The on-map text box a Map Label is written in (#800). */
const labelEditor = (page: Page) => mapFrame(page).locator("textarea.map-label-editor");
/** The lines a multi-line Map Label draws, one tspan each, ink copy only. */
const drawnLines = (page: Page) =>
  mapFrame(page).locator("g[data-element-id] text.map-line").last().locator("tspan");
/** A selected label's transform grip by its handle id, such as `e` for its right side. */
const transformGrip = (page: Page, id: string) =>
  mapFrame(page).locator(`[data-transform-handle-hit="${id}"]`);
/** The selected label's transform box outline. */
const transformBox = (page: Page) => mapFrame(page).locator("[data-transform] .map-transform-box");

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
  // An auto-width label's baseline is exactly its letters' advances (#800), so
  // a glyph's own overhang, such as the italic placeholder's slant, may reach a
  // little past it: a fraction of the letters' height, never a clipped word.
  const overhang = Math.max(2, (ink.bottom - ink.top) * 0.2);
  expect(ink.left).toBeGreaterThanOrEqual(line.left - overhang);
  expect(ink.right).toBeLessThanOrEqual(line.right + overhang);
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

    // The click opens the label's text box on the Map (#800): typing writes
    // the label, never the editor's tool Shortcuts, and Escape commits it.
    await expect(labelEditor(page)).toBeFocused();
    await page.keyboard.type("Gulf");
    await page.keyboard.press("Escape");
    await expect(labelEditor(page)).toHaveCount(0);
    await expect(drawnLabelPaths(page).first()).toHaveText("Gulf");
    // The Properties Text field follows the commit.
    await expect(textField(page)).toHaveValue("Gulf");
    await expect(
      page.getByRole("button", { name: "Text", exact: true, pressed: true })
    ).toBeVisible();

    await tabTo(page, placeLabelButton(page), { max: 60 });
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

    // Placing the label puts the caret in its Text field (#800), so the first
    // keys typed are its text: nothing to select, delete, or Tab to, and no
    // letter reaches the tool Shortcuts.
    await expect(textField(page)).toBeFocused();
    await page.keyboard.type("North Sea");
    await page.keyboard.press("Enter");
    await expect(drawnLabelPaths(page).first()).toHaveText("North Sea");
    await expect(drawnLabelText(page).last()).not.toHaveAttribute("font-style", "italic");
    await expect(
      page.getByRole("button", { name: "Text", exact: true, pressed: true })
    ).toBeVisible();

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

  test("a double click on a Map Label with the Select tool opens its text box on the Map", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickText(page);
    const point = [150, 40] as const;
    await clickPagePoint(page, surface(page), point);
    await expect(labelEditor(page)).toBeFocused();
    await page.keyboard.type("Gulf");
    await page.keyboard.press("Escape");
    await expect(drawnLabelPaths(page).first()).toHaveText("Gulf");

    // The Select tool, then a click on bare page to drop the selection, so the
    // double click below is what picks the label again.
    await tabTo(page, placeLabelButton(page), { max: 60 });
    await page.keyboard.press("v");
    await expect(mapFrame(page).locator('svg[data-tool="select"]')).toBeVisible();
    await clickPagePoint(page, surface(page), [30, 130]);
    await expect(textField(page)).toHaveCount(0);

    // A pointer-only gesture: the keyboard reaches the same text by Tab, in
    // the Properties Text field. The box opens on the whole name, selected.
    await dblclickPagePoint(page, surface(page), point);
    await expect(labelEditor(page)).toBeFocused();
    await expect(labelEditor(page)).toHaveValue("Gulf");
    await expect(
      page.getByRole("button", { name: "Select", exact: true, pressed: true })
    ).toBeVisible();
    await page.keyboard.type("Gulf of Mexico");
    await page.keyboard.press("Escape");
    await expect(drawnLabelPaths(page).first()).toHaveText("Gulf of Mexico");
    // The keys wrote the label: "v" and "e" never switched the tool.
    await expect(
      page.getByRole("button", { name: "Select", exact: true, pressed: true })
    ).toBeVisible();
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
    // button without typing into anything. Placing left the caret in the Text
    // field (#800), so focus goes back to the button first.
    await tabTo(page, placeLabelButton(page), { max: 60 });
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

/** The Width and Rotation fields and the Auto width switch a Map Label takes. */
const widthField = (page: Page) => page.getByRole("textbox", { name: "Width (mm)", exact: true });
const rotationField = (page: Page) =>
  page.getByRole("textbox", { name: "Rotation (degrees)", exact: true });
const autoWidth = (page: Page) => page.getByRole("switch", { name: "Auto width" });

/** The selected label's box width, in page millimetres, from its transform outline. */
async function boxWidth(page: Page): Promise<number> {
  const width = await transformBox(page).getAttribute("width");
  if (width === null) throw new Error("the Frame draws no transform box");
  return Number(width);
}

/** Places a Map Label with a Text tool click, so its text box opens on the Map. */
async function clickToPlace(page: Page, point: readonly [number, number]): Promise<void> {
  await pickText(page);
  await clickPagePoint(page, surface(page), point);
  await expect(labelEditor(page)).toBeFocused();
}

/** Picks the Select tool from the Frame, where an Escape from the text box leaves focus. */
async function pickSelectInFrame(page: Page): Promise<void> {
  await page.keyboard.press("v");
  await expect(mapFrame(page).locator('svg[data-tool="select"]')).toBeVisible();
}

test.describe("Maps Map Label text box @wf:plugins-maps-labels @sc:plugin.maibuk-maps.textTool @sc:plugin.maibuk-maps.selectTool @sandbox", () => {
  const POINT = [114.3, 76.2] as const;
  /** Words that fit the clear page between the Layers card and Properties on one line. */
  const WORDS = "Gulf of the Seven Isles";

  test("Escape commits the text box and hands the keys back to the tool Shortcuts, as one undo step", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await clickToPlace(page, POINT);
    // The empty box holds its whole italic prompt: no letter is clipped.
    const empty = await textBoxGeometry(labelEditor(page));
    expect(empty.promptInk).toBeGreaterThan(0);
    expect(empty.width).toBeGreaterThanOrEqual(empty.promptInk);
    await capture(page, "labels-text-box-open");
    // Every letter writes the label: "v" and "e" would pick Select and Eraser.
    await page.keyboard.type("Seven Eves");
    await expect(
      page.getByRole("button", { name: "Text", exact: true, pressed: true })
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(labelEditor(page)).toHaveCount(0);
    await expect(drawnLabelPaths(page).first()).toHaveText("Seven Eves");
    await capture(page, "labels-text-box-committed");

    // Focus stayed in the Frame, so the next key is a tool Shortcut again.
    await pickSelectInFrame(page);

    // The commit is one undo step: the label goes back to empty, then returns.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(drawnLabelPaths(page).last()).toHaveText(LABEL_PLACEHOLDER);
    await expect(elementRow(page, "Map Label 1")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(drawnLabelPaths(page).first()).toHaveText("Seven Eves");
  });

  test("a press on the Map and a Tab both commit the text box", async ({ page }) => {
    await openEditorWithMap(page);
    await clickToPlace(page, POINT);
    await page.keyboard.type("Gulf");
    await page.keyboard.press("Escape");
    await pickSelectInFrame(page);

    // A press on bare page commits and drops the selection.
    await dblclickPagePoint(page, surface(page), POINT);
    await expect(labelEditor(page)).toBeFocused();
    await page.keyboard.type("Bay");
    await clickPagePoint(page, surface(page), [30, 130]);
    await expect(labelEditor(page)).toHaveCount(0);
    await expect(drawnLabelPaths(page).first()).toHaveText("Bay");

    // Tab moves focus on, and the box commits as it goes.
    await dblclickPagePoint(page, surface(page), POINT);
    await expect(labelEditor(page)).toBeFocused();
    await page.keyboard.type("Sound");
    await page.keyboard.press("Tab");
    await expect(labelEditor(page)).toHaveCount(0);
    await expect(drawnLabelPaths(page).first()).toHaveText("Sound");
  });

  test("an empty commit keeps the placeholder, and the box fits one letter or a long sentence on one line", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await clickToPlace(page, POINT);
    // Empty: Escape stores nothing and the prompt stays, sized to the prompt.
    await page.keyboard.press("Escape");
    await expect(drawnLabelPaths(page).last()).toHaveText(LABEL_PLACEHOLDER);
    await pickSelectInFrame(page);
    await clickPagePoint(page, surface(page), POINT);
    const promptWidth = await boxWidth(page);

    // One letter: an auto box shrinks to it.
    await dblclickPagePoint(page, surface(page), POINT);
    await expect(labelEditor(page)).toBeFocused();
    await page.keyboard.type("A");
    await page.keyboard.press("Escape");
    await expect(drawnLabelPaths(page).first()).toHaveText("A");
    await expect.poll(() => boxWidth(page)).toBeLessThan(promptWidth / 4);
    await expect.poll(() => boxWidth(page)).toBeGreaterThan(0);

    // A long sentence: the box grows to hold it, so no letter is clipped.
    const sentence = "The Great Southern Gulf of the Seven Kingdoms";
    await dblclickPagePoint(page, surface(page), POINT);
    await expect(labelEditor(page)).toBeFocused();
    await page.keyboard.type(sentence);
    await page.keyboard.press("Escape");
    await expect(drawnLabelPaths(page).first()).toHaveText(sentence);
    await expect.poll(() => boxWidth(page)).toBeGreaterThan(promptWidth);
    await expect(autoWidth(page)).toBeChecked();
    expectInkOnBaseline(await labelInk(surface(page)));
    await capture(page, "labels-long-auto");
  });

  test("Enter writes three lines, drawn one under the other, and a multi-line label does not bend", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await clickToPlace(page, POINT);
    await page.keyboard.type("North");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Sea");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Coast");
    await expect(labelEditor(page)).toHaveValue("North\nSea\nCoast");
    await page.keyboard.press("Escape");
    await expect(drawnLines(page)).toHaveText(["North", "Sea", "Coast"]);
    await capture(page, "labels-three-lines");

    // The lines stack down from the first one's baseline.
    const ys = await labelLineBaselines(surface(page));
    expect(ys[1]).toBeGreaterThan(ys[0]);
    expect(ys[2] - ys[1]).toBeCloseTo(ys[1] - ys[0], 5);

    // Properties shows every line, and the Bend field and handle are off.
    await expect(textField(page)).toHaveValue("North\nSea\nCoast");
    await expect(bendField(page)).toBeDisabled();
    await pickSelectInFrame(page);
    await clickPagePoint(page, surface(page), POINT);
    await expect(transformBox(page)).toBeVisible();
    await expect(bendHandle(page)).toHaveCount(0);
  });

  test("a side handle drag sets a fixed width the text wraps at, and a bent one-line label keeps its curve", async ({
    page,
  }) => {
    // Between the Layers card and Properties, so both side grips stay clear.
    const at = [118, 76.2] as const;
    await openEditorWithMap(page);
    await clickToPlace(page, at);
    await page.keyboard.type(WORDS);
    await page.keyboard.press("Escape");
    await pickSelectInFrame(page);
    await clickPagePoint(page, surface(page), at);
    const before = await boxWidth(page);
    await expect(transformGrip(page, "e")).toBeVisible();

    // Drag the right side in to about half the width.
    await dragTransformHandle(page, surface(page), transformGrip(page, "e"), [
      at[0] + before / 4,
      at[1],
    ]);
    await expect(autoWidth(page)).not.toBeChecked();
    await expect.poll(() => drawnLines(page).count()).toBeGreaterThan(1);
    const lines = await drawnLines(page).allTextContents();
    expect(lines.join(" ")).toBe(WORDS);
    const fixed = await boxWidth(page);
    expect(fixed).toBeLessThan(before * 0.8);
    expect(Number(await widthField(page).inputValue())).toBeCloseTo(fixed, 0);
    await capture(page, "labels-fixed-wrap");

    // The Auto width switch puts it back on one line.
    await focusProperties(page, autoWidth(page));
    await page.keyboard.press("Space");
    await expect(drawnLabelPaths(page).first()).toHaveText(WORDS);

    // One line bends: the Bend field is on and bows the baseline.
    await expect(bendField(page)).toBeEnabled();
    await writeField(page, bendField(page), "6");
    await expect.poll(async () => offChord(baseline(await baselineData(page)))).not.toBe(0);
    await expect(drawnLabelPaths(page).first()).toHaveText(WORDS);
  });

  test("the text box sits over a turned label on a zoomed Map", async ({ page }) => {
    await openEditorWithMap(page);
    await clickToPlace(page, POINT);
    await page.keyboard.type("Delta");
    await page.keyboard.press("Escape");
    await writeField(page, rotationField(page), "30");
    // Zoom in around the label with a Ctrl wheel, then edit it there.
    await wheelAt(page, surface(page), [0.5, 0.5], { notches: 3 });
    // Out of the Rotation field to a button, so "v" is a tool Shortcut.
    await tabTo(page, placeLabelButton(page), { max: 60 });
    await page.keyboard.press("v");
    await expect(mapFrame(page).locator('svg[data-tool="select"]')).toBeVisible();
    const ink = await labelInk(surface(page));
    const centre = await dblclickLabelInk(page, surface(page), frameElement(page));
    await expect(labelEditor(page)).toBeFocused();
    await expect(labelEditor(page)).toHaveValue("Delta");
    await capture(page, "labels-zoomed-turned-edit");
    // Turned with the label, and centred on the ink it replaces.
    const geometry = await textBoxGeometry(labelEditor(page));
    expect(geometry.transform).toContain("rotate(30deg)");
    const box = await labelEditor(page).boundingBox();
    if (box === null) throw new Error("the text box has no box");
    expect(Math.abs(box.x + box.width / 2 - centre.x)).toBeLessThan(Math.max(12, box.width * 0.15));
    expect(Math.abs(box.y + box.height / 2 - centre.y)).toBeLessThan(
      Math.max(12, box.height * 0.5)
    );
    // The box is drawn at the zoomed size: the 6 mm cap at the Frame's own scale.
    const mmPerPx = await millimetresPerPixel(surface(page));
    expect(geometry.fontPx).toBeCloseTo(6 / mmPerPx, 0);
    expect(ink.ink.right).toBeGreaterThan(ink.ink.left);
    await page.keyboard.type("Delta Bay");
    await page.keyboard.press("Escape");
    await expect(drawnLabelPaths(page).first()).toHaveText("Delta Bay");
  });

  test("the text box works with Properties minimised and on a narrow window", async ({ page }) => {
    await openEditorWithMap(page);
    await pickText(page);
    // Minimised: the Text field is not mounted, and typing still writes the label.
    const minimise = page.getByRole("button", { name: "Minimise Properties" });
    await tabTo(page, minimise, { max: 60 });
    await page.keyboard.press("Enter");
    await expect(textField(page)).toHaveCount(0);
    await clickPagePoint(page, surface(page), POINT);
    await expect(labelEditor(page)).toBeFocused();
    await page.keyboard.type("Isle");
    await page.keyboard.press("Escape");
    await expect(drawnLabelPaths(page).first()).toHaveText("Isle");
    await expect(
      page.getByRole("button", { name: "Text", exact: true, pressed: true })
    ).toBeVisible();

    // Narrow: Properties is a bottom region, and the box still opens on the Map.
    await page.setViewportSize({ width: 390, height: 844 });
    await pickSelectInFrame(page);
    await dblclickPagePoint(page, surface(page), POINT);
    await expect(labelEditor(page)).toBeFocused();
    await page.keyboard.type("Isle of Mist");
    await page.keyboard.press("Escape");
    await expect(drawnLabelPaths(page).first()).toHaveText("Isle of Mist");
    await capture(page, "labels-narrow-edit");
  });

  test("three lines in a fixed box survive a reload", async ({ page }) => {
    await openEditorWithMap(page);
    await clickToPlace(page, POINT);
    await page.keyboard.type("North");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Sea of the Long Winter");
    await page.keyboard.press("Escape");
    await writeField(page, widthField(page), "30");
    await expect(autoWidth(page)).not.toBeChecked();
    const lines = await drawnLines(page).allTextContents();
    expect(lines.length).toBeGreaterThan(2);

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
    await openLayers(page);
    await expect(drawnLines(page)).toHaveText(lines);
  });
});
