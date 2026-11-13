// The Maps editor's pointer view (#777): Ctrl+wheel zooms around the pointer and
// Space+drag pans, the way the app's own Canvas does. The Frame only posts each
// request; the editor owns zoom and pan, so it crops the view and sends it back,
// and the Frame's own viewBox is what the author sees change. Every assertion
// here reads that viewBox: a zoom keeps the page point under the pointer where
// it was on screen, a plain wheel leaves the view alone, and a pan moves the
// drawing with the gesture while the Pencil draws nothing until Space is lifted.
// The Hand tool pans on a plain drag, and a drag over a Map Line neither
// selects nor moves it.
// Zoom has a keyboard path (its Commands, covered by `plugins-maps-editor`); so
// does picking a tool. The wheel and the drag themselves are
// `support/frame-stroke.ts`, which explains why the pointer gestures sit outside
// the spec.
// Tagged @sandbox because Maps runs in the Plugin sandbox: the lane runs it on
// Chromium, WebKit, and Firefox.

import type { FrameLocator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import {
  dragPan,
  drawStroke,
  fractionOfPagePoint,
  millimetresPerPixel,
  pagePointAt,
  wheelAt,
} from "../support/frame-stroke";
import { tabTo } from "../support/keyboard";
import { createMap, openMap, openMaps } from "../support/maps-layers";
import { expect, test } from "../support/test";

/** The Map editor's embedded Frame, the iframe element around it, and its surface. */
const mapFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-plugin-frame="embedded"] iframe');
const frameElement = (page: Page) => page.locator('[data-plugin-frame="embedded"] iframe');
const surface = (page: Page) => mapFrame(page).locator("#surface svg");

/** Every non-hidden Element the Frame draws. */
const drawnElements = (page: Page) => mapFrame(page).locator("[data-element-id]");

/** Where the wheel rests and where the pan is dragged, as fractions of the svg's box. */
const POINTER: readonly [number, number] = [0.7, 0.3];
const PAN_FROM: readonly [number, number] = [0.4, 0.45];
const PAN_TO: readonly [number, number] = [0.6, 0.55];
/**
 * Where the Hand's drag presses: on the Pencil stroke `drawStroke` draws from
 * (0.3, 0.35) to (0.6, 0.55), so Select would pick the Map Line there.
 */
const HAND_FROM: readonly [number, number] = [0.45, 0.45];
const HAND_TO: readonly [number, number] = [0.6, 0.6];

/** Starts on an open Map called Coastline, whose Frame draws its surface. */
async function openCoastline(page: Page): Promise<void> {
  await page.goto("/");
  await openMaps(page);
  await createMap(page, "Coastline");
  await openMap(page, "Coastline");
  await expect(surface(page)).toBeVisible();
}

/** Picks the Pencil with its Command and waits for the Frame to honour it. */
async function pickPencil(page: Page): Promise<void> {
  await page.keyboard.press("p");
  await expect(page.getByRole("button", { name: "Pencil", pressed: true }));
  // The scene round-trip is what proves the Frame is listening before a gesture.
  await expect(mapFrame(page).locator('svg[data-tool="pencil"]')).toBeVisible();
}

/** The zoom the cluster reads, as the whole percentage its readout shows. */
async function readoutPercent(page: Page): Promise<number> {
  const text = (await zoomReadout(page).textContent()) ?? "";
  return Number(text.replace(/[^\d]/g, ""));
}

/** Tabs into the Frame, which is how a key reaches its document. */
async function focusFrame(page: Page): Promise<void> {
  await tabTo(page, frameElement(page), { max: 60 });
  await expect(frameElement(page)).toBeFocused();
}

/** The zoom cluster's readout (#778): a button whose text is the view's zoom. */
const zoomReadout = (page: Page) => page.getByRole("button", { name: /^\d+\s?%$/ });

/** The Frame svg's viewBox as four numbers. */
async function viewBox(page: Page): Promise<number[]> {
  const value = await surface(page).getAttribute("viewBox");
  if (value === null) throw new Error("the Frame drew no viewBox");
  return value.split(" ").map(Number);
}

test.use({
  library: "empty",
  plugins: ["maibuk-maps"],
  pluginApprovals: [
    {
      pluginId: "maibuk-maps",
      granted: ["library:read", "editor:write", "files:pick", "files:save"],
    },
  ],
  builtInPlugins: [{ id: "maibuk-maps" }],
});

test.describe("Maps pointer view @wf:plugins-maps-pointer-view @sc:plugin.maibuk-maps.pencilTool @sc:plugin.maibuk-maps.handTool @sandbox", () => {
  test("zooms around the pointer on a Ctrl+wheel", async ({ page }) => {
    await openCoastline(page);
    await focusFrame(page);

    const before = await viewBox(page);
    // The page point under the pointer, and where it sits on screen right now.
    const anchor = await pagePointAt(surface(page), POINTER);
    const across = await fractionOfPagePoint(surface(page), anchor);
    await wheelAt(page, surface(page), POINTER, { notches: 2 });

    // The view really zoomed in: its crop is narrower than it was.
    await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(before[2] * 0.8);
    await capture(page, "maps-pointer-zoom", { around: [frameElement(page)] });

    // And it zoomed around the pointer: the page point that was under it is
    // still under it, so the drawing grew away from where the author pointed.
    await expect
      .poll(async () => (await fractionOfPagePoint(surface(page), anchor))[0])
      .toBeCloseTo(across[0], 2);
    await expect
      .poll(async () => (await fractionOfPagePoint(surface(page), anchor))[1])
      .toBeCloseTo(across[1], 2);

    // The zoom cluster reads the same view the gesture set: its percentage is
    // the crop the Frame just drew, so the readout and the drawing never
    // disagree about how far in the author is.
    await expect.poll(async () => readoutPercent(page)).toBeGreaterThan(100);
    const zoomed = await viewBox(page);
    // The readout is the whole percentage the editor rounds to, so it agrees
    // with the crop to within a point.
    expect(await readoutPercent(page)).toBeCloseTo((before[2] / zoomed[2]) * 100, -1);
  });

  test("leaves the view alone on a plain wheel", async ({ page }) => {
    await openCoastline(page);
    await focusFrame(page);

    const before = await viewBox(page);
    await wheelAt(page, surface(page), POINTER, { ctrl: false, notches: 2 });
    // A gesture that never reaches the editor leaves nothing to wait for, so
    // the second read is the whole check: the crop is the one that was there.
    expect(await viewBox(page)).toEqual(before);
  });

  test("pans on Space+drag without drawing, and the Pencil draws once Space is lifted", async ({
    page,
  }) => {
    await openCoastline(page);
    await pickPencil(page);
    await focusFrame(page);

    const pressed = await pagePointAt(surface(page), PAN_FROM);
    // One pixel of the drawing surface, in page millimetres.
    const pixel = await millimetresPerPixel(surface(page));

    await dragPan(page, surface(page), PAN_FROM, PAN_TO);

    // The drawing follows the gesture: the page point that was under the press
    // is under the release once the view has moved there, which is what a pan
    // is and what no other gesture would do. The pan is exact in the Frame, so
    // the only slack is the pixel the engine delivered the pointer on — Firefox
    // and WebKit round the pointer's place to a whole pixel, Chromium keeps the
    // fraction — plus the two decimals the viewBox is printed to. The travel
    // here is about forty-five millimetres, so a pan that stopped short, ran the
    // wrong way, or did not happen misses by far more than two pixels.
    await expect
      .poll(async () => Math.abs((await pagePointAt(surface(page), PAN_TO))[0] - pressed[0]))
      .toBeLessThan(2 * pixel);
    await expect
      .poll(async () => Math.abs((await pagePointAt(surface(page), PAN_TO))[1] - pressed[1]))
      .toBeLessThan(2 * pixel);
    await capture(page, "maps-pointer-pan", { around: [frameElement(page)] });
    // A press that pans never draws: the Pencil is still the tool, and the Map
    // has no Map Line to list.
    await expect(drawnElements(page)).toHaveCount(0);

    // Releasing Space gave the Pencil back, and the next drag is a stroke.
    await drawStroke(page, surface(page));
    await expect(drawnElements(page)).toHaveCount(1);
  });

  test("pans on a plain drag with the Hand, over a Map Line it never picks or moves", async ({
    page,
  }) => {
    await openCoastline(page);
    await pickPencil(page);
    await drawStroke(page, surface(page));
    await expect(drawnElements(page)).toHaveCount(1);
    const selected = mapFrame(page).locator('[data-element-id][data-selected="true"]');

    // The Hand by its Shortcut, from the host page, as every tool is picked.
    // Only the Select tool works on a selection, so the Hand drops it.
    await page.keyboard.press("h");
    await expect(page.getByRole("button", { name: "Hand", pressed: true })).toBeVisible();
    await expect(mapFrame(page).locator('svg[data-tool="hand"]')).toBeVisible();
    await expect(selected).toHaveCount(0);
    const lineBefore = await drawnElements(page).first().innerHTML();

    const pressed = await pagePointAt(surface(page), HAND_FROM);
    const pixel = await millimetresPerPixel(surface(page));
    await dragPan(page, surface(page), HAND_FROM, HAND_TO, { space: false });

    // The same check the Space pan makes: the page point under the press is
    // under the release, so the view moved with the drag.
    await expect
      .poll(async () => Math.abs((await pagePointAt(surface(page), HAND_TO))[0] - pressed[0]))
      .toBeLessThan(2 * pixel);
    await expect
      .poll(async () => Math.abs((await pagePointAt(surface(page), HAND_TO))[1] - pressed[1]))
      .toBeLessThan(2 * pixel);
    await capture(page, "maps-hand-pan", { around: [frameElement(page)] });

    // The drag drew nothing, picked nothing, and left the Map Line where it was.
    await expect(drawnElements(page)).toHaveCount(1);
    await expect(selected).toHaveCount(0);
    expect(await drawnElements(page).first().innerHTML()).toBe(lineBefore);
  });
});
