// What every Maps editor spec needs before it measures anything: the editor
// opened on a Map of its own, and the Layers card (#778) opened the way an
// author does. The Layers card is shut until the author asks for it, so the
// Elements list is not in the page until then; Tab to the belt's Layers toggle
// and press Enter is how it opens.

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { pressUntilFocused, tabTo } from "./keyboard";

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** The Map cards, by their preview's alt text (the Map's name). */
export const mapNames = (page: Page) => page.getByRole("list").getByRole("img");

/** Opens Maps from the sidebar, waiting for the Plugin's launch scan. */
export async function openMaps(page: Page): Promise<void> {
  await expect(navOption(page, "Maps")).toBeVisible({ timeout: 60_000 });
  await tabTo(page, navOption(page, "Books"), { max: 60 });
  await pressUntilFocused(page, "ArrowDown", navOption(page, "Maps"), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/maps$/);
  await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
}

/** Creates a Map from the New Map dialog by keyboard. */
export async function createMap(page: Page, name: string): Promise<void> {
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
export async function openMap(page: Page, name: string): Promise<void> {
  await tabTo(page, page.getByRole("button", { name: new RegExp(`^${name}\\b`) }), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/map$/);
  await expect(page.locator('[data-plugin-frame="embedded"]')).toBeVisible();
}

/** The belt's Layers toggle, which is pressed while the card shows. */
export const layersToggle = (page: Page) =>
  page.getByRole("button", { name: "Layers", exact: true });

/** Opens the Layers card, when it is shut, and waits for its header. */
export async function openLayers(page: Page): Promise<void> {
  const toggle = layersToggle(page);
  if ((await toggle.getAttribute("aria-pressed")) !== "true") {
    await tabTo(page, toggle, { max: 60 });
    await page.keyboard.press("Enter");
  }
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Close Layers" })).toBeVisible();
}

/** Shuts the Layers card, when it shows. */
export async function closeLayers(page: Page): Promise<void> {
  const toggle = layersToggle(page);
  if ((await toggle.getAttribute("aria-pressed")) === "true") {
    await tabTo(page, toggle, { max: 60 });
    await page.keyboard.press("Enter");
  }
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Close Layers" })).toBeHidden();
}
