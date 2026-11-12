// The Maps editor's Layers card (#778) is shut until the author asks for it, so
// the Elements list is not in the page until then. Every Maps spec that reads or
// drives that list opens it the way an author does: Tab to the belt's Layers
// toggle and press Enter.

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { tabTo } from "./keyboard";

/** The belt's Layers toggle, which is pressed while the card shows. */
export const layersToggle = (page: Page) =>
  page.getByRole("button", { name: "Layers", exact: true });

/** Opens the Layers card, when it is shut, and waits for the Elements list. */
export async function openLayers(page: Page): Promise<void> {
  const toggle = layersToggle(page);
  if ((await toggle.getAttribute("aria-pressed")) !== "true") {
    await tabTo(page, toggle, { max: 60 });
    await page.keyboard.press("Enter");
  }
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("listbox", { name: "Elements" })).toBeVisible();
}

/** Shuts the Layers card, when it shows. */
export async function closeLayers(page: Page): Promise<void> {
  const toggle = layersToggle(page);
  if ((await toggle.getAttribute("aria-pressed")) === "true") {
    await tabTo(page, toggle, { max: 60 });
    await page.keyboard.press("Enter");
  }
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("listbox", { name: "Elements" })).toBeHidden();
}
