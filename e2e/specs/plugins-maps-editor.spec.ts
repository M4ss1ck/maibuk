// The Maps editor, the Built-in Plugin's drawing surface (#745): opening a Map
// from the Maps list shows the host-rendered tool picker, Elements list, and
// properties panel around the drawing Frame. This slice proves the way in and
// the editor's landmarks by keyboard; drawing, moving, and the Elements list
// actions are proven by the Vitest keyboard gate until the next slice adds
// their E2E steps. Tagged @sandbox because Maps runs in the Plugin sandbox: the
// lane runs it on Chromium, WebKit, and Firefox.

import type { Page } from "@playwright/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** The Map cards, by their preview's alt text (the Map's name). */
const mapNames = (page: Page) => page.getByRole("list").getByRole("img");

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

test.describe("Maps editor @wf:plugins-maps-editor @sc:plugin.maibuk-maps.openMap @sc:plugin.maibuk-maps.undo @sc:plugin.maibuk-maps.redo @sc:plugin.maibuk-maps.zoomIn @sc:plugin.maibuk-maps.zoomOut @sc:plugin.maibuk-maps.zoomReset @sc:plugin.maibuk-maps.panLeft @sc:plugin.maibuk-maps.panRight @sc:plugin.maibuk-maps.panUp @sc:plugin.maibuk-maps.panDown @sc:plugin.maibuk-maps.moveLeft @sc:plugin.maibuk-maps.moveRight @sc:plugin.maibuk-maps.moveUp @sc:plugin.maibuk-maps.moveDown @sc:plugin.maibuk-maps.moveLeftFar @sc:plugin.maibuk-maps.moveRightFar @sc:plugin.maibuk-maps.moveUpFar @sc:plugin.maibuk-maps.moveDownFar @sc:plugin.maibuk-maps.selectTool @sc:plugin.maibuk-maps.pencilTool @sc:plugin.maibuk-maps.deleteElement @sandbox", () => {
  test("opens a Map from the list by keyboard and shows the editor", async ({ page }) => {
    await page.goto("/");
    await openMaps(page);
    await createMap(page, "Coastline");

    const open = page.getByRole("button", { name: "Open Coastline" });
    await tabTo(page, open, { max: 60 });
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/map$/);
    await expect(page.getByRole("heading", { name: "Map", level: 1 })).toBeAttached();
    await expect(page.getByRole("radiogroup", { name: "Tool" })).toBeVisible();
    await expect(page.getByRole("listbox", { name: "Elements" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to Maps" })).toBeVisible();
  });
});
