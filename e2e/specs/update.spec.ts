// Update: What's new offers the in-app Update where the install can Update, and
// the Download page always. A real install cannot run under Playwright, so the
// spec arms a scripted adapter through the test-only seam (e2e/support/update.ts);
// the store, the shutdown routine, and the signature paths are covered by
// Vitest and Rust tests.

import type { Locator, Page } from "@playwright/test";
import { tabTo } from "../support/keyboard";
import { expectActiveOption } from "../support/palette";
import { expect, test } from "../support/test";
import { armUpdate, type UpdateSeamScript } from "../support/update";

const RELEASE = "99.0.0";

const badge = (page: Page) => page.getByRole("button", { name: /^Maibuk v.*What.s new/ }).first();
const dialog = (page: Page) => page.getByRole("dialog", { name: "What's new" });
const inDialog = (page: Page, name: string) => dialog(page).getByRole("button", { name });

async function arm(page: Page, script: Partial<UpdateSeamScript> = {}): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
  await armUpdate(page, { bundleType: "appimage", release: RELEASE, ...script });
}

async function openWhatsNew(page: Page): Promise<void> {
  await tabTo(page, badge(page), { max: 30 });
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
}

async function press(page: Page, button: Locator): Promise<void> {
  await tabTo(page, button, { max: 12 });
  await page.keyboard.press("Enter");
}

test.describe("Update @wf:shell-update", () => {
  test("Update by keyboard shows progress, then Restart now / Later", async ({ page }) => {
    await arm(page);
    await openWhatsNew(page);

    await press(page, inDialog(page, `Update to ${RELEASE}`));

    await expect(dialog(page).getByText(`${RELEASE} is installed`)).toBeVisible();
    await expect(inDialog(page, "Restart now")).toBeVisible();
    await expect(inDialog(page, "Download page")).toBeVisible();

    await press(page, inDialog(page, "Later"));
    await expect(dialog(page)).toBeHidden();
    await expect(badge(page)).toContainText("Restart");
  });

  test("Command Palette: Update Maibuk @sc:global.updateMaibuk", async ({ page }) => {
    await arm(page);

    await page.keyboard.press("F1");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await page.keyboard.type("update maibuk");
    const option = palette.getByRole("option", { name: /Update Maibuk/ }).first();
    await expect(option).toBeVisible();
    await expectActiveOption(palette, option);
    await page.keyboard.press("Enter");

    await expect(palette).toBeHidden();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByText(`${RELEASE} is installed`)).toBeVisible();
  });

  test("An install that cannot Update offers only the Download page", async ({ page }) => {
    await arm(page, { bundleType: "unknown" });
    await openWhatsNew(page);

    await expect(inDialog(page, "Download page")).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: /^Update to/ })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await page.keyboard.press("F1");
    await page.keyboard.type("update maibuk");
    await expect(
      page
        .getByRole("dialog", { name: "Command palette" })
        .getByRole("option", { name: /Update Maibuk/ })
    ).toHaveCount(0);
  });

  test("A failed download shows the error with Retry and the Download page", async ({ page }) => {
    await arm(page, { failure: "bad-signature" });
    await openWhatsNew(page);

    await press(page, inDialog(page, `Update to ${RELEASE}`));

    await expect(dialog(page).getByRole("alert")).toContainText("signature check");
    await expect(inDialog(page, "Retry")).toBeVisible();
    await expect(inDialog(page, "Download page")).toBeVisible();
  });
});
