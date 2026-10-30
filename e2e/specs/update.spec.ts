// Update: What's new offers the in-app Update where the install can Update, and
// the Download page always. A real install cannot run under Playwright, so the
// spec arms a scripted adapter through the test-only seam (e2e/support/update.ts);
// the store, the shutdown routine, and the signature paths are covered by
// Vitest and Rust tests.

import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
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
    await capture(page, "update-installed", { around: [dialog(page)] });
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

  test("Progress shows on the bar and the badge, sized or not", async ({ page }) => {
    await arm(page, { steps: 4, stepMs: 1500 });
    await openWhatsNew(page);
    await press(page, inDialog(page, `Update to ${RELEASE}`));
    const bar = dialog(page).getByRole("progressbar", { name: "Update download" });
    await expect(bar).toHaveAttribute("value", /^(25|50)$/);
    await capture(page, "update-progress", { around: [dialog(page)] });

    await page.keyboard.press("Escape");
    await expect(badge(page)).toContainText(/\d+%/);
    await capture(page, "update-badge-progress", { around: [badge(page)] });
  });

  test("Unknown size shows an indeterminate bar", async ({ page }) => {
    await arm(page, { unknownSize: true, steps: 4, stepMs: 1500 });
    await openWhatsNew(page);
    await press(page, inDialog(page, `Update to ${RELEASE}`));
    const bar = dialog(page).getByRole("progressbar", { name: "Update download" });
    await expect(bar).toBeVisible();
    await expect(bar).not.toHaveAttribute("value");
    await capture(page, "update-progress-indeterminate", { around: [dialog(page)] });
  });

  test("Windows: Update downloads, then Restart to update / Later drops it", async ({ page }) => {
    await arm(page, { bundleType: "nsis" });
    await openWhatsNew(page);

    await press(page, inDialog(page, `Update to ${RELEASE}`));
    await expect(
      dialog(page).getByText(`${RELEASE} is downloaded. Restart Maibuk to install it.`)
    ).toBeVisible();
    await expect(inDialog(page, "Restart to update")).toBeVisible();
    await expect(badge(page)).toContainText("Restart");
    await capture(page, "update-downloaded-windows", { around: [dialog(page)] });

    await press(page, inDialog(page, "Later"));
    await expect(dialog(page)).toBeHidden();
    await expect(badge(page)).toBeFocused();
    await expect(page.getByText(/The downloaded update was discarded/)).toBeVisible();

    // Offered again: Update, then Restart to update runs the shutdown routine
    // and hands over to the installer (a no-op in the web build).
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible();
    await press(page, inDialog(page, `Update to ${RELEASE}`));
    await press(page, inDialog(page, "Restart to update"));
    await expect(dialog(page).getByRole("status")).toContainText("Restarting");
  });
});
