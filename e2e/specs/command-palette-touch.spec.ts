// Phone Command Palette (@touch): the palette opens from the navigation
// drawer's footer button, and a Recent row is removed with its X. Runs only
// in the `phone` project, driven by touch.

import type { Page } from "@playwright/test";
import { expect, test } from "../support/test";
import { capture } from "../support/capture";

test.use({ library: "paletteLibrary" });

const menuDialog = (page: Page) => page.getByRole("dialog", { name: "Primary navigation" });
const paletteDialog = (page: Page) => page.getByRole("dialog", { name: "Command palette" });

async function openDrawer(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation menu" }).tap();
  await expect(menuDialog(page)).toBeVisible();
}

async function openPaletteFromDrawer(page: Page): Promise<void> {
  await menuDialog(page).getByRole("button", { name: "Open command palette" }).tap();
  await expect(paletteDialog(page)).toBeVisible();
  await expect(
    paletteDialog(page).getByRole("searchbox", { name: "Find by name" })
  ).toBeFocused();
}

test.describe("phone Command Palette @touch @wf:command-palette", () => {
  test("tapping the drawer footer button opens the palette @touch @wf:command-palette", async ({
    page,
  }) => {
    await openDrawer(page);
    await openPaletteFromDrawer(page);
  });

  test("choosing a Command records Recent and tapping its X removes it @touch @wf:command-palette @sc:global.openCommandPalette @sc:commandPalette.removeRecent", async ({
    page,
  }) => {
    await openDrawer(page);
    await openPaletteFromDrawer(page);
    // Before any Command runs: Cycle theme pins the theme, and the capture
    // shoots both schemes.
    await expect(
      paletteDialog(page).getByRole("group", { name: "Suggested" }).getByRole("option").first()
    ).toBeVisible();
    await capture(page, "palette-phone");

    await page.keyboard.type("cycle theme");
    const command = paletteDialog(page).getByRole("option", {
      name: "Cycle theme",
      exact: true,
    });
    await expect(command).toBeVisible();
    await command.tap();
    await expect(paletteDialog(page)).toBeHidden();

    await openPaletteFromDrawer(page);
    // Cycle theme is also Suggested, so look in Recent only.
    const recent = paletteDialog(page)
      .getByRole("group", { name: "Recent" })
      .getByRole("option", { name: "Cycle theme", exact: true });
    await expect(recent).toBeVisible();
    await paletteDialog(page)
      .getByRole("button", { name: "Remove Cycle theme from recent" })
      .tap();
    await expect(recent).toHaveCount(0);
  });
});
