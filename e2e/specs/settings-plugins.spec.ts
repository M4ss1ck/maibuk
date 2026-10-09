// Settings → Plugins (issue #429): with no Plugin known the section shows its
// empty state. Runtime accordions are proven in Vitest (PluginsSettings.test.tsx);
// the E2E lane has no Plugin install path yet, so it covers the empty state.

import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { expect, test } from "../support/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";

test.use({ library: "empty" });

const settingsMain = (page: Page) => page.getByRole("main", { name: "Main content" });

async function openSettings(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

/** Opens a React Aria Select by keyboard and picks the named option. */
async function chooseFromSelect(
  page: Page,
  trigger: ReturnType<Page["getByRole"]>,
  name: string,
  direction: "ArrowDown" | "ArrowUp" = "ArrowDown"
) {
  await tabTo(page, trigger, { max: 90 });
  await page.keyboard.press("Enter");
  const option = page.getByRole("option", { name, exact: true });
  await pressUntilFocused(page, direction, option, { max: 12 });
  await page.keyboard.press("Enter");
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

  test("shows the empty state in Spanish", async ({ page }) => {
    await openSettings(page);
    const main = settingsMain(page);
    const general = page.locator('[data-tutorial~="settings.general"]');
    await chooseFromSelect(page, general.getByRole("button", { name: "Language" }), "Español");

    await expect(page.getByRole("heading", { name: "Configuración", level: 1 })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Plugins" })).toBeVisible();
    await expect(main.getByText("Aún no hay Plugins")).toBeVisible();
    await expect(
      main.getByText("Los Plugins que instales aparecen aquí, cada uno con sus ajustes.")
    ).toBeVisible();
    await capture(page, "settings-plugins-empty-es");
  });
});
