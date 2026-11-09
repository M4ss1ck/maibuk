// Maps, the Built-in Plugin where the author designs Maps of their world
// (#737, #744): the Maps page lists Maps newest first with a preview, filters
// by Book, and creates, renames, and deletes a Map by keyboard alone. The Book
// Gallery card's Item Menu carries the Plugin's "Maps" entry, which opens the
// page filtered to that Book; a Map with no Book shows only under All. Tagged
// @sandbox because Maps runs in the Plugin sandbox: the lane runs it on
// Chromium, WebKit, and Firefox.

import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { expectTabContained, pressUntilFocused, tabTo } from "../support/keyboard";
import { SEED_BOOK } from "../support/seed/names";
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

/** Opens a host select by keyboard and picks `option` with the arrows. */
async function pick(page: Page, trigger: Locator, option: string): Promise<void> {
  await tabTo(page, trigger, { max: 30 });
  await page.keyboard.press("Enter");
  const listbox = page.getByRole("listbox").last();
  await expect(listbox).toBeVisible();
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", listbox.getByRole("option", { name: option }), {
    max: 20,
  });
  await page.keyboard.press("Enter");
}

/** Creates a Map from the New Map dialog by keyboard. */
async function createMap(page: Page, name: string, book: string | null): Promise<void> {
  const trigger = page.getByRole("button", { name: "New Map" });
  await tabTo(page, trigger, { max: 60 });
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New Map" });
  await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.type(name);
  if (book !== null) await pick(page, dialog.getByRole("button", { name: /Book$/ }), book);
  await tabTo(page, dialog.getByRole("button", { name: "Create" }), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(mapNames(page).first()).toHaveAccessibleName(name);
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

test.describe("Maps list @wf:plugins-maps-list @sc:plugin.maibuk-maps.openMaps @sc:plugin.maibuk-maps.bookMaps @sandbox", () => {
  test("creates, renames, and deletes a Map by keyboard alone", async ({ page }) => {
    await page.goto("/");
    await openMaps(page);
    await expect(page.getByText("No Maps yet")).toBeVisible();

    // The New Map dialog takes focus, keeps Tab inside, and Escape returns it.
    const newMap = page.getByRole("button", { name: "New Map" });
    await tabTo(page, newMap, { max: 60 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "New Map" });
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
    await expectTabContained(page, dialog);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(newMap).toBeFocused();

    // Create: name, Book, and a double-page spread.
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
    await page.keyboard.type("The Northern Reach");
    await pick(page, dialog.getByRole("button", { name: /Book$/ }), SEED_BOOK.title);
    await tabTo(page, dialog.getByRole("radio", { name: "Landscape page" }), { max: 20 });
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("radio", { name: "Double-page spread" })).toBeChecked();
    await capture(page, "maps-new-map-dialog");
    await tabTo(page, dialog.getByRole("button", { name: "Create" }), { max: 20 });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(mapNames(page)).toHaveCount(1);
    await expect(page.getByText(`${SEED_BOOK.title} · Double-page spread`)).toBeVisible();
    await capture(page, "maps-list");

    // Rename.
    await tabTo(page, page.getByRole("button", { name: "Rename The Northern Reach" }), { max: 60 });
    await page.keyboard.press("Enter");
    const rename = page.getByRole("dialog", { name: "Rename Map" });
    const field = rename.getByRole("textbox", { name: "Name" });
    await expect(field).toBeFocused();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("The Shattered Coast");
    await tabTo(page, rename.getByRole("button", { name: "Save" }), { max: 20 });
    await page.keyboard.press("Enter");
    await expect(rename).toBeHidden();
    await expect(mapNames(page).first()).toHaveAccessibleName("The Shattered Coast");

    // A reload keeps it: the index is in Plugin storage.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
    await expect(mapNames(page).first()).toHaveAccessibleName("The Shattered Coast", {
      timeout: 30_000,
    });

    // Delete, after a confirmation.
    await tabTo(page, page.getByRole("button", { name: "Delete The Shattered Coast" }), {
      max: 60,
    });
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Delete The Shattered Coast?");
    await tabTo(page, confirm.getByRole("button", { name: "Delete" }), { max: 10 });
    await page.keyboard.press("Enter");
    await expect(page.getByText("No Maps yet")).toBeVisible();
  });

  test("the Book Item Menu opens Maps filtered to that Book; a Map with no Book shows under All", async ({
    page,
  }) => {
    await page.goto("/");
    await openMaps(page);
    await createMap(page, "Loose Sketch", null);
    await createMap(page, "Lighthouse Coast", SEED_BOOK.title);

    // Back to the Book Gallery, then the Book's Item Menu by keyboard.
    await tabTo(page, navOption(page, "Maps"), { max: 60, backwards: true });
    await pressUntilFocused(page, "ArrowUp", navOption(page, "Books"), { max: 20 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/$/);
    const card = page.getByRole("grid", { name: "Books" }).getByRole("row", {
      name: SEED_BOOK.title,
    });
    await tabTo(page, card, { max: 60 });
    await page.keyboard.press("Shift+F10");
    const menu = page.getByRole("menu", { name: `More actions for ${SEED_BOOK.title}` });
    await expect(menu).toBeVisible();
    await capture(page, "maps-book-item-menu");
    await pressUntilFocused(page, "ArrowDown", menu.getByRole("menuitem", { name: "Maps" }));
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/maps$/);
    await expect(mapNames(page)).toHaveCount(1);
    await expect(mapNames(page).first()).toHaveAccessibleName("Lighthouse Coast");
    await capture(page, "maps-filtered");

    await pick(page, page.getByRole("button", { name: /Book$/ }), "All");
    await expect(mapNames(page)).toHaveCount(2);
    await expect(mapNames(page).nth(1)).toHaveAccessibleName("Loose Sketch");
  });
});
