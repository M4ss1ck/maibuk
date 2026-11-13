// The Maps editor's floating layout (#778, from #775 Decisions 1, 3, 7, 8): the
// drawing Frame takes the whole page body and every control floats over it as a
// card, the way the app's own Canvas does. Plugin CSS positions host Views
// around a `fill` Frame, which the unit guard `layout-css.test.tsx` holds
// selector by selector; what only a real engine can say is that the Frame's box
// really is the page body's, at the two desktop sizes #778 names, and that
// opening or closing any card or popover never moves it. The narrow switch is a
// container query on the editor's own root, so the page's chrome follows the
// editor's width rather than the window's.
// These specs also measure the geometry #775 review R2 asked for: Insert and
// Layers stack instead of covering each other, the zoom cluster stays visible
// above an open region, each region's full-height toggle really gives it the
// page, and the desktop header draws no such toggle.
// Tagged @sandbox because Maps runs in the Plugin sandbox: the lane runs it on
// Chromium, WebKit, and Firefox.

import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { tabTo, tabToEither } from "../support/keyboard";
import { pageScrollWidths, queryContainerAround } from "../support/layout";
import { createMap, openLayers, openMap, openMaps } from "../support/maps-layers";
import { expect, test } from "../support/test";

/** The page body the Frame fills, and the Frame's own wrapper. */
const pageBody = (page: Page) => page.locator("[data-plugin-page-body]");
const frameWrapper = (page: Page) => page.locator('[data-plugin-frame="embedded"]');

/** The floating chrome, each found through the control it holds. */
const toolButton = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const backToMaps = (page: Page) => page.getByRole("button", { name: "Back to Maps" });
const mapName = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** The zoom cluster (#778): a button whose text is the view's zoom. */
const zoomReadout = (page: Page) => page.getByRole("button", { name: /^\d+\s?%$/ });

/**
 * The floating card that holds `control`: its nearest ancestor that is one of
 * the editor root's own children, which is the slot the stylesheet positions.
 */
const cardHolding = (control: Locator) =>
  control.locator("xpath=ancestor::*[parent::*[@data-plugin-ui]][1]");

/** A box as four numbers, for comparisons that read `[x, y, width, height]`. */
type Box = { x: number; y: number; width: number; height: number };

/** The page body's box and the Frame's, measured now. */
async function boxes(page: Page): Promise<{ body: Box; frame: Box }> {
  const body = await pageBody(page).boundingBox();
  const frame = await frameWrapper(page).boundingBox();
  if (body === null || frame === null) throw new Error("the page body or the Frame is not drawn");
  return { body, frame };
}

/** `target`'s box, or a failure naming what was not drawn. */
async function boxOf(target: Locator, what: string): Promise<Box> {
  const box = await target.boundingBox();
  if (box === null) throw new Error(`${what} is not drawn`);
  return box;
}

/** Whether two boxes are the same box, to the pixel an engine rounds to. */
function expectSameBox(one: Box, two: Box, what: string): void {
  for (const edge of ["x", "y", "width", "height"] as const) {
    expect(one[edge], `${what}: ${edge}`).toBeCloseTo(two[edge], 0);
  }
}

/** Whether two boxes share no pixel: neither covers a corner of the other. */
function expectNoOverlap(one: Box, two: Box, what: string): void {
  const across = Math.min(one.x + one.width, two.x + two.width) - Math.max(one.x, two.x);
  const down = Math.min(one.y + one.height, two.y + two.height) - Math.max(one.y, two.y);
  expect(across > 1 && down > 1, `${what} overlap`).toBe(false);
}

/** Whether `region` is a bottom region: at most about half the page body. */
function expectHalfPageRegion(region: Box, body: Box, what: string): void {
  expect(region.height, `${what} starts at most half the page`).toBeLessThanOrEqual(
    body.height * 0.6
  );
}

/** Whether `region` has taken the page: all of it but the top bar and the belt. */
function expectTakesPage(region: Box, body: Box, what: string): void {
  expect(region.height, `${what} takes the page body`).toBeGreaterThan(body.height * 0.65);
}

/** Starts on an open Map called Coastline, which every test below measures. */
async function openEditor(page: Page): Promise<void> {
  await page.goto("/");
  await openMaps(page);
  await createMap(page, "Coastline");
  await openMap(page, "Coastline");
}

/**
 * Presses one control by keyboard, from wherever focus sits. The walk runs
 * forward first and back second: Chrome and WebKit wrap Tab from the page's last
 * control round to its first, but Firefox hands that Tab to the browser chrome,
 * so a control earlier in the tab order than the one focus sits on is only
 * reachable with Shift+Tab (the belt's last control is Layers and Insert sits
 * before it, #778). Reaching a control you have tabbed past by going back is
 * what an author does.
 */
async function pressControl(page: Page, control: Locator): Promise<void> {
  await tabToEither(page, control);
  await page.keyboard.press("Enter");
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

test.describe("Maps floating layout @wf:plugins-maps-layout @sandbox", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the Frame fills the page body and the cards float over it at 1440x900", async ({
    page,
  }) => {
    await openEditor(page);

    const { body, frame } = await boxes(page);
    expectSameBox(frame, body, "the Frame and the page body");

    // The chrome floats over the drawing, inside the body it covers: the
    // top-left pill and the tool belt both sit within the Frame's box, which is
    // what "the drawing gets the whole page" means to the author.
    for (const card of [backToMaps(page), toolButton(page, "Pencil")]) {
      const cardBox = await card.boundingBox();
      if (cardBox === null) throw new Error("the card is not drawn");
      expect(cardBox.x).toBeGreaterThanOrEqual(body.x);
      expect(cardBox.y).toBeGreaterThanOrEqual(body.y);
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(body.x + body.width);
      expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(body.y + body.height);
    }

    await capture(page, "maps-layout");
  });

  test("no card or popover changes the Frame's size", async ({ page }) => {
    await openEditor(page);
    const before = await boxes(page);
    expectSameBox(before.frame, before.body, "the Frame and the page body");

    // Every card that opens and shuts, and a popover over them: the Frame is
    // pinned to the body, so none of them may take a pixel of it.
    const steps: Array<{ name: string; run(): Promise<void> }> = [
      {
        name: "Layers opens",
        run: async () => {
          await pressControl(page, toolButton(page, "Layers"));
          await expect(page.getByRole("button", { name: "Close Layers" })).toBeVisible();
        },
      },
      {
        name: "Layers shuts",
        run: async () => {
          await pressControl(page, toolButton(page, "Layers"));
          await expect(page.getByRole("button", { name: "Close Layers" })).toBeHidden();
        },
      },
      {
        name: "Insert opens its card",
        run: async () => {
          await pressControl(page, toolButton(page, "Insert"));
          await expect(page.getByRole("button", { name: "Place Capital" })).toBeVisible();
        },
      },
      {
        name: "the Pen opens Properties",
        run: async () => {
          await pressControl(page, toolButton(page, "Pen"));
          await expect(page.getByRole("button", { name: "Minimise Properties" })).toBeVisible();
        },
      },
      {
        name: "Properties minimises",
        run: async () => {
          await pressControl(page, page.getByRole("button", { name: "Minimise Properties" }));
          await expect(page.getByRole("button", { name: "Restore Properties" })).toBeVisible();
        },
      },
      {
        name: "Properties restores",
        run: async () => {
          await pressControl(page, page.getByRole("button", { name: "Restore Properties" }));
          await expect(page.getByRole("button", { name: "Minimise Properties" })).toBeVisible();
        },
      },
      {
        name: "the Export popover opens",
        run: async () => {
          await pressControl(page, toolButton(page, "Export"));
          await expect(page.getByRole("dialog")).toBeVisible();
        },
      },
      {
        name: "the Export popover shuts",
        run: async () => {
          await page.keyboard.press("Escape");
          await expect(page.getByRole("dialog")).toBeHidden();
        },
      },
    ];

    for (const step of steps) {
      await step.run();
      const now = await boxes(page);
      expectSameBox(now.frame, before.frame, `the Frame after ${step.name}`);
      expectSameBox(now.body, before.body, `the page body after ${step.name}`);
    }
  });

  test("the Map name in the top-left pill is the Map's own, and renames it", async ({ page }) => {
    await openEditor(page);
    await pressControl(page, mapName(page, "Coastline"));
    const dialog = page.getByRole("dialog", { name: "Rename Map" });
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Seaboard");
    await tabTo(page, dialog.getByRole("button", { name: "Save" }), { max: 10 });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(mapName(page, "Seaboard")).toBeVisible();
  });

  test("Insert and Layers share a column without covering each other", async ({ page }) => {
    await openEditor(page);

    // Both cards take the one box beside the belt (#778), so opening the second
    // while the first shows used to leave the Stamp picker under the Elements
    // list (#775 review R2). They stack instead: Insert above the middle,
    // Layers below it.
    await pressControl(page, toolButton(page, "Insert"));
    const placeStamp = page.getByRole("button", { name: "Place Capital" });
    await expect(placeStamp).toBeVisible();
    await openLayers(page);

    const insert = await boxOf(cardHolding(placeStamp), "the Insert card");
    const layers = await boxOf(
      cardHolding(page.getByRole("button", { name: "Close Layers" })),
      "the Layers card"
    );
    expectNoOverlap(insert, layers, "the Insert and Layers cards");
    expect(insert.y + insert.height, "Insert sits above Layers").toBeLessThanOrEqual(layers.y + 1);

    await capture(page, "maps-layout-insert-layers");
  });

  test("the desktop header draws no full-height toggle", async ({ page }) => {
    await openEditor(page);

    // A region at the desktop width already takes the room its content needs,
    // so the toggle that gives it the whole page only exists on the narrow
    // page: at 1440 it was drawn and did nothing (#775 review R2). The
    // stylesheet hides it, which also takes it out of the accessibility tree,
    // so neither a pointer nor a screen reader finds it.
    await pressControl(page, toolButton(page, "Pen"));
    await expect(page.getByRole("button", { name: "Minimise Properties" })).toBeVisible();
    const propertiesToggle = toolButton(page, "Full-height Properties");
    await expect(propertiesToggle).toHaveCount(0);

    await openLayers(page);
    const layersToggle = toolButton(page, "Full-height Layers");
    await expect(layersToggle).toHaveCount(0);
  });
});

test.describe("Maps floating layout at 1024x768 @wf:plugins-maps-layout @sandbox", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("the Frame still fills the page body at 1024x768", async ({ page }) => {
    await openEditor(page);
    const { body, frame } = await boxes(page);
    expectSameBox(frame, body, "the Frame and the page body");
    await capture(page, "maps-layout-1024");
  });
});

test.describe("Maps layout follows the editor's container @wf:plugins-maps-layout @sandbox", () => {
  // A window wide enough for the desktop chrome, where the app's own sidebar
  // leaves the editor narrower than 640px: the stylesheet's switch is on the
  // editor's width, so this window gets the narrow chrome (#779, #775 review
  // R2). The viewport stays above the breakpoint, which is what makes the
  // reading of the container the thing this test proves.
  test.use({ viewport: { width: 800, height: 900 } });

  test("a narrow editor in a wide window gets the narrow chrome", async ({ page }) => {
    await openEditor(page);

    const container = await queryContainerAround(toolButton(page, "Pencil"));
    expect(container, "the page draws no query container above the belt").not.toBeNull();
    expect(container?.isRoot, "the editor root is the query container").toBe(true);
    // The window is past the breakpoint; the editor is not.
    expect(page.viewportSize()?.width ?? 0).toBeGreaterThanOrEqual(640);
    expect(container?.width, "the editor's own width").toBeLessThan(640);

    // The narrow chrome: the pill's three controls fold into one overflow
    // popover, so Export has no button of its own.
    await expect(toolButton(page, "More actions")).toBeVisible();
    await expect(toolButton(page, "Export")).toBeHidden();

    // The 44px touch minimum is a pointer rule, not a width one: this desktop
    // pointer keeps the host's own controls below the touch size even though
    // the chrome is the narrow one (#779, #775 Decision 6).
    const pencil = await boxOf(toolButton(page, "Pencil"), "the Pencil control");
    expect(pencil.width).toBeLessThan(44);

    await capture(page, "maps-layout-800");
  });
});

test.describe("Maps layout opened at 1440x900 then narrowed to 390x844 @wf:plugins-maps-layout @sandbox", () => {
  // A phone is a coarse pointer, which is what the touch minimum asks for: the
  // 44px targets are a pointer rule, so the run below has to report one (#779).
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: true });

  test("the narrowed page never scrolls sideways and every control is a 44px target", async ({
    page,
  }) => {
    // The editor is reached at the desktop width, where the host's sidebar
    // offers Maps, and the screen is narrowed afterwards: a phone shows this
    // page with no sidebar at all, and the Plugin CSS takes over.
    await openEditor(page);
    await page.setViewportSize({ width: 390, height: 844 });

    // The chrome is bars over an edge-to-edge drawing now, so nothing may push
    // the page wider than the screen it is drawn on.
    const scroll = await pageScrollWidths(page);
    expect(scroll.scrollWidth, "the page's scroll width").toBeLessThanOrEqual(scroll.clientWidth);

    // The state a phone shows first: every card shut, the Map filling the page
    // under the bars, and the zoom cluster above the belt (#779).
    await capture(page, "maps-layout-390");

    // Properties open, so the controls below include the tall card's own: the
    // narrow block makes every one of them a thumb-sized target (#779).
    await pressControl(page, toolButton(page, "Pen"));
    await expect(page.getByRole("button", { name: "Minimise Properties" })).toBeVisible();

    // Properties at half height, the Map still drawn above it (#779).
    await capture(page, "maps-layout-390-properties");

    const buttons = pageBody(page).getByRole("button");
    const count = await buttons.count();
    expect(count, "the editor draws controls").toBeGreaterThan(0);
    let measured = 0;
    for (let index = 0; index < count; index++) {
      const button = buttons.nth(index);
      if (!(await button.isVisible())) continue;
      const box = await button.boundingBox();
      if (box === null) continue;
      measured += 1;
      const name = (await button.getAttribute("aria-label")) ?? (await button.innerText());
      expect(box.width, `${name}: width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `${name}: height`).toBeGreaterThanOrEqual(44);
    }
    expect(measured, "controls measured").toBeGreaterThan(0);
  });

  test("the overflow popover and the full-height Properties toggle leave the Frame alone, and Properties takes the page", async ({
    page,
  }) => {
    await openEditor(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const before = await boxes(page);

    // The overflow popover opens over the bar: it may not take a pixel of the
    // Frame (#779).
    await pressControl(page, toolButton(page, "More actions"));
    await expect(page.getByRole("dialog")).toBeVisible();
    const withOverflow = await boxes(page);
    expectSameBox(withOverflow.frame, before.frame, "the Frame with the overflow popover open");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    // Properties is a bottom region at most half the page tall until its own
    // toggle gives it the page (#779). Its box is what says so: the header
    // alone would flip `aria-pressed` and move nothing, which is the failure
    // this test exists to catch.
    await pressControl(page, toolButton(page, "Pen"));
    const properties = () =>
      boxOf(
        cardHolding(page.getByRole("button", { name: "Minimise Properties" })),
        "the Properties region"
      );
    const halfPage = await properties();
    expectHalfPageRegion(halfPage, before.body, "Properties");

    await pressControl(page, toolButton(page, "Full-height Properties"));
    await expect(toolButton(page, "Full-height Properties")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    const fullPage = await properties();
    expectTakesPage(fullPage, before.body, "Properties at full height");
    expect(fullPage.height, "Properties grew").toBeGreaterThan(halfPage.height + 100);
    const fullHeight = await boxes(page);
    expectSameBox(fullHeight.frame, before.frame, "the Frame with Properties at full height");
    await capture(page, "maps-layout-390-properties-full");

    // Pressed again, Properties gives the page back.
    await pressControl(page, toolButton(page, "Full-height Properties"));
    await expect(toolButton(page, "Full-height Properties")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    const restored = await properties();
    expect(restored.height, "Properties back to its region height").toBeCloseTo(halfPage.height, 0);
  });

  test("the full-height Layers toggle gives Layers the page and gives it back", async ({
    page,
  }) => {
    await openEditor(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const { body } = await boxes(page);

    // Layers owns the same toggle Properties does (#779, #775 review R2): its
    // card is a bottom region until the toggle takes the page.
    await openLayers(page);
    const layers = () =>
      boxOf(cardHolding(page.getByRole("button", { name: "Close Layers" })), "the Layers region");
    const halfPage = await layers();
    expectHalfPageRegion(halfPage, body, "Layers");

    await pressControl(page, toolButton(page, "Full-height Layers"));
    await expect(toolButton(page, "Full-height Layers")).toHaveAttribute("aria-pressed", "true");
    const fullPage = await layers();
    expectTakesPage(fullPage, body, "Layers at full height");
    expect(fullPage.height, "Layers grew").toBeGreaterThan(halfPage.height + 100);
    await capture(page, "maps-layout-390-layers-full");

    await pressControl(page, toolButton(page, "Full-height Layers"));
    await expect(toolButton(page, "Full-height Layers")).toHaveAttribute("aria-pressed", "false");
    const restored = await layers();
    expect(restored.height, "Layers back to its region height").toBeCloseTo(halfPage.height, 0);
  });

  test("with a region open the zoom cluster stays visible above it", async ({ page }) => {
    await openEditor(page);
    await page.setViewportSize({ width: 390, height: 844 });

    // Selecting any Element opens Properties, so a phone spends most of its
    // time with a region open; zooming out and reading the zoom must not
    // depend on shutting it (#775 review R2).
    await pressControl(page, toolButton(page, "Pen"));
    const properties = await boxOf(
      cardHolding(page.getByRole("button", { name: "Minimise Properties" })),
      "the Properties region"
    );

    await expect(zoomReadout(page)).toBeVisible();
    const cluster = await boxOf(zoomReadout(page), "the zoom cluster's readout");
    expectNoOverlap(cluster, properties, "the zoom cluster and the Properties region");
    expect(cluster.y + cluster.height, "the cluster sits above the region").toBeLessThanOrEqual(
      properties.y + 1
    );

    // Layers holds the same bottom edge, so the cluster clears it too.
    await openLayers(page);
    const layers = await boxOf(
      cardHolding(page.getByRole("button", { name: "Close Layers" })),
      "the Layers region"
    );
    const clusterWithLayers = await boxOf(zoomReadout(page), "the zoom cluster's readout");
    expectNoOverlap(clusterWithLayers, layers, "the zoom cluster and the Layers region");
  });
});
