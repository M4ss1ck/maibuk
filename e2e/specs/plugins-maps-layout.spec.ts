// The Maps editor's floating layout (#778, from #775 Decisions 1, 3, 7, 8): the
// drawing Frame takes the whole page body and every control floats over it as a
// card, the way the app's own Canvas does. Plugin CSS positions host Views
// around a `fill` Frame, which the unit guard `layout-css.test.tsx` holds
// selector by selector; what only a real engine can say is that the Frame's box
// really is the page body's, at the two desktop sizes #778 names, and that
// opening or closing any card or popover never moves it.
// Tagged @sandbox because Maps runs in the Plugin sandbox: the lane runs it on
// Chromium, WebKit, and Firefox.

import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { pageScrollWidths } from "../support/layout";
import { expect, test } from "../support/test";

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** The Map cards, by their preview's alt text (the Map's name). */
const mapNames = (page: Page) => page.getByRole("list").getByRole("img");

/** The page body the Frame fills, and the Frame's own wrapper. */
const pageBody = (page: Page) => page.locator("[data-plugin-page-body]");
const frameWrapper = (page: Page) => page.locator('[data-plugin-frame="embedded"]');

/** The floating chrome, each found through the control it holds. */
const toolButton = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const backToMaps = (page: Page) => page.getByRole("button", { name: "Back to Maps" });
const mapName = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** A box as four numbers, for comparisons that read `[x, y, width, height]`. */
type Box = { x: number; y: number; width: number; height: number };

/** The page body's box and the Frame's, measured now. */
async function boxes(page: Page): Promise<{ body: Box; frame: Box }> {
  const body = await pageBody(page).boundingBox();
  const frame = await frameWrapper(page).boundingBox();
  if (body === null || frame === null) throw new Error("the page body or the Frame is not drawn");
  return { body, frame };
}

/** Whether two boxes are the same box, to the pixel an engine rounds to. */
function expectSameBox(one: Box, two: Box, what: string): void {
  for (const edge of ["x", "y", "width", "height"] as const) {
    expect(one[edge], `${what}: ${edge}`).toBeCloseTo(two[edge], 0);
  }
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

/** Opens a Map from the list and waits for its editor's Frame to draw. */
async function openMap(page: Page, name: string): Promise<void> {
  await tabTo(page, page.getByRole("button", { name: `Open ${name}` }), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/map$/);
  await expect(frameWrapper(page)).toBeVisible();
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
  try {
    await tabTo(page, control, { max: 40 });
  } catch {
    await tabTo(page, control, { max: 40, backwards: true });
  }
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
          await expect(page.getByRole("listbox", { name: "Elements" })).toBeVisible();
        },
      },
      {
        name: "Layers shuts",
        run: async () => {
          await pressControl(page, toolButton(page, "Layers"));
          await expect(page.getByRole("listbox", { name: "Elements" })).toBeHidden();
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

test.describe("Maps narrow layout at 390x844 @wf:plugins-maps-layout @sandbox", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the narrow page never scrolls sideways and every control is a 44px target", async ({
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

    const before = await boxes(page);

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

    // The overflow popover opens over the bar, and the full-height toggle gives
    // Properties the page: neither may take a pixel of the Frame (#779).
    await pressControl(page, toolButton(page, "More actions"));
    await expect(page.getByRole("dialog")).toBeVisible();
    const withOverflow = await boxes(page);
    expectSameBox(withOverflow.frame, before.frame, "the Frame with the overflow popover open");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await pressControl(page, toolButton(page, "Full-height Properties"));
    await expect(toolButton(page, "Full-height Properties")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    const fullHeight = await boxes(page);
    expectSameBox(fullHeight.frame, before.frame, "the Frame with Properties at full height");
  });
});
