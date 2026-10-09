// Settings → Plugins (issue #429): with no Plugin known the section shows its
// empty state. Reached through the outline by keyboard alone; runtime
// accordions are proven in Vitest (PluginsSettings.test.tsx) since the E2E
// lane has no Plugin install path yet.

import type { Page } from "@playwright/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { capture } from "../support/capture";
import { expect, test } from "../support/test";

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

const outlineTree = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name })
    .getByRole("treegrid", { name });
const outlineEntry = (page: Page, navName: string, entryName: string) =>
  outlineTree(page, navName).getByRole("row", { name: new RegExp(`^${entryName}(, current)?$`) });

test.describe("Settings Plugins empty state @wf:settings-plugins", () => {
  test("shows the Plugins heading and its empty state", async ({ page }) => {
    await openSettings(page);
    // Instant section jumps: the jump animates otherwise, and the capture
    // would race it.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const main = settingsMain(page);

    // The outline comes last in the page: Shift+Tab from the top reaches it.
    await tabTo(page, outlineEntry(page, "Settings sections", "Appearance"), {
      backwards: true,
      max: 6,
    });
    await pressUntilFocused(
      page,
      "ArrowDown",
      outlineEntry(page, "Settings sections", "Plugins"),
      { max: 20 }
    );
    await page.keyboard.press("Enter");
    await expect(main.getByRole("heading", { name: "Plugins" })).toBeFocused();

    await expect(main.getByText("No Plugins yet")).toBeVisible();
    await expect(
      main.getByText("Plugins you install appear here, each with its own settings.")
    ).toBeVisible();
    await capture(page, "settings-plugins-empty");
  });

  test("shows the empty state in Spanish", async ({ page }) => {
    await openSettings(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const general = page.locator('[data-tutorial~="settings.general"]');
    await chooseFromSelect(page, general.getByRole("button", { name: "Language" }), "Español");

    await expect(page.getByRole("heading", { name: "Configuración", level: 1 })).toBeVisible();
    // Filter the outline to the one Plugins entry, then jump to it.
    const search = page
      .getByRole("navigation", { name: "Secciones de configuración" })
      .getByRole("searchbox", { name: "Buscar en la configuración" });
    await tabTo(page, search, { max: 150 });
    await page.keyboard.type("plugins");
    const pluginsEntry = page
      .getByRole("navigation", { name: "Secciones de configuración" })
      .getByRole("treegrid", { name: "Secciones de configuración" })
      .getByRole("row", { name: /^Plugins(, current)?$/ });
    await expect(pluginsEntry).toBeVisible();
    await tabTo(page, pluginsEntry, { max: 10 });
    await page.keyboard.press("Enter");
    // The main landmark label localizes too.
    const mainEs = page.getByRole("main", { name: "Contenido principal" });
    await expect(mainEs.getByRole("heading", { name: "Plugins" })).toBeFocused();
    await expect(mainEs.getByText("Aún no hay Plugins")).toBeVisible();
    await expect(
      mainEs.getByText("Los Plugins que instales aparecen aquí, cada uno con sus ajustes.")
    ).toBeVisible();
    await capture(page, "settings-plugins-empty-es");
  });
});
