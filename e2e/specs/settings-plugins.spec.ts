// Settings → Plugins (issue #429): with no Plugin known the section shows its
// empty state. Runtime accordions are proven in Vitest (PluginsSettings.test.tsx);
// the E2E lane has no Plugin install path yet, so it covers the empty state.

import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { expect, test } from "../support/test";

test.use({ library: "empty" });

const settingsMain = (page: Page) => page.getByRole("main", { name: "Main content" });

async function openSettings(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

test.describe("Settings Plugins empty state @wf:settings-plugins", () => {
  test("shows the Plugins heading and its empty state", async ({ page }) => {
    await openSettings(page);
    const main = settingsMain(page);

    await expect(main.getByRole("heading", { name: "Plugins" })).toBeVisible();
    await expect(main.getByText("No Plugins yet")).toBeVisible();
    await expect(
      main.getByText("Plugins you install appear here, each with its own settings.")
    ).toBeVisible();
    await capture(page, "settings-plugins-empty");
  });
});
