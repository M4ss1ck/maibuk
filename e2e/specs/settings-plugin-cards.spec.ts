// Plugin cards in Settings → Plugins (issue #442): each Plugin is a bordered
// card whose header holds its name, state badges, a disclosure chevron, and —
// outside the trigger — a switch named "Enable <name>". A Built-in starts off
// on first sight with its Plugin Permissions pre-granted, so its card shows no
// review issue; the outline and the Command Palette list the card by name. The
// spec proves the first sight, the enable switch, the expanding panel order,
// the pre-granted Permissions accordion, the outline reveal, the UI-language
// names, and that the card still expands under reduced motion, all by keyboard.

import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import {
  expectFocusWithin,
  isFocusWithin,
  pressUntilFocused,
  tabTo,
} from "../support/keyboard";
import { expect, test } from "../support/test";

const PLUGIN_NAME = "Echoes";
/** The Echoes manifest description (the first text of an open card). */
const DESCRIPTION =
  "Points out words and phrases repeated closely enough, or often enough, that a reader would notice.";

const main = (page: Page) => page.getByRole("main", { name: "Main content" });
const navOption = (page: Page, name: string) =>
  page
    .getByRole("listbox", { name: "Primary navigation" })
    .getByRole("option", { name: new RegExp(`^${name}`) });
/** The Echoes card, by the Settings row id it carries (issue #442). */
const card = (page: Page) => page.locator('[data-settings-row="pluginCard.maibuk-echoes"]');
/** The card's disclosure trigger (the first button in the card header). */
const cardTrigger = (page: Page) => card(page).getByRole("button").first();
/** The card header's enable switch, named "Enable <name>". */
const enableSwitch = (page: Page) =>
  page.getByRole("switch", { name: `Enable ${PLUGIN_NAME}`, exact: true });
/** The nested Permissions accordion's trigger. */
const permissionsTrigger = (page: Page) =>
  page.getByRole("button", { name: /Plugin permissions/ });

/** Jumps to the Plugins section through the Settings outline, leaving its heading focused. */
async function openPluginsSection(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  // Instant section jumps: the jump animates otherwise, and the captures race it.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tree = page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("treegrid", { name: "Settings sections" });
  const pluginsEntry = tree.getByRole("row", { name: /^Plugins(, current)?$/ });
  await expect(tree).toBeVisible();
  // The outline is the page's last focusable region: Shift+Tab reaches it.
  for (let i = 0; i < 12; i++) {
    if (await isFocusWithin(tree)) break;
    await page.keyboard.press("Shift+Tab");
  }
  await expectFocusWithin(tree);
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", pluginsEntry, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(main(page).getByRole("heading", { name: "Plugins" })).toBeFocused();
}

/** Opens a React Aria Select by keyboard and picks the named option. */
async function chooseFromSelect(
  page: Page,
  trigger: ReturnType<Page["getByRole"]>,
  name: string,
  direction: "ArrowDown" | "ArrowUp" = "ArrowDown"
): Promise<void> {
  await tabTo(page, trigger, { max: 90 });
  await page.keyboard.press("Enter");
  const option = page.getByRole("option", { name, exact: true });
  await pressUntilFocused(page, direction, option, { max: 12 });
  await page.keyboard.press("Enter");
}

test.use({
  library: "echoesBook",
  plugins: ["maibuk-echoes"],
  builtInPlugins: [{ id: "maibuk-echoes" }],
});

test.describe("Settings Plugin cards @wf:settings-plugin-cards", () => {
  test("first sight: the Echoes switch is off and its entry is not available", async ({
    page,
  }) => {
    await page.goto("/");
    // The nav is up once a core entry is; the disabled Built-in contributes no
    // sidebar entry of its own.
    await expect(navOption(page, "Books")).toBeVisible();
    await expect(navOption(page, PLUGIN_NAME)).toHaveCount(0);

    // Its Open Echoes Command is not available either.
    await page.keyboard.press("F1");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await page.keyboard.type("Open Echoes");
    await expect(palette.getByRole("option", { name: "Open Echoes", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // The card is installed with its switch off.
    await openPluginsSection(page);
    await expect(card(page)).toBeVisible();
    await expect(enableSwitch(page)).not.toBeChecked();
    await capture(page, "settings-plugin-cards-collapsed");
    // Collapsed, the card is only its header row.
    const cardBox = await card(page).boundingBox();
    const headerBox = await cardTrigger(page).locator("xpath=..").boundingBox();
    expect((cardBox?.height ?? 0) - (headerBox?.height ?? 0)).toBeLessThanOrEqual(2);
  });

  test("the switch turns Echoes on, and Open Echoes opens its report", async ({ page }) => {
    await openPluginsSection(page);
    const toggle = enableSwitch(page);
    await tabTo(page, toggle, { max: 60 });
    await page.keyboard.press("Space");
    await expect(toggle).toBeChecked();

    // Its sidebar entry appears once it is running…
    await expect(navOption(page, PLUGIN_NAME)).toBeVisible({ timeout: 20_000 });

    // …and Open Echoes from the Command Palette opens the report.
    await page.keyboard.press("F1");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Open Echoes");
    await expect(palette.getByRole("option", { name: "Open Echoes", exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/plugin\/maibuk-echoes\/report$/);
    await expect(page.getByRole("heading", { name: PLUGIN_NAME, level: 1 })).toBeVisible();
  });

  test("the card expands to the description and the pre-granted Permissions", async ({
    page,
  }) => {
    await openPluginsSection(page);
    const trigger = cardTrigger(page);
    await tabTo(page, trigger, { max: 40 });
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await capture(page, "settings-plugin-cards-expanded");

    // The first text of the open panel is the localized manifest description.
    await expect(card(page).locator("p").first()).toHaveText(DESCRIPTION);

    // The pre-granted Built-in is approved: no Needs attention badge.
    await expect(card(page).getByText("Needs attention", { exact: true })).toHaveCount(0);

    // The nested Permissions accordion is collapsed, then lists the granted
    // Plugin Permissions once opened.
    const permissions = permissionsTrigger(page);
    await expect(permissions).toHaveAttribute("aria-expanded", "false");
    // Collapsed, the Permissions box is only its trigger: the closed panel
    // leaves no band of padding below it.
    const permissionsBox = await permissions.locator("xpath=..").boundingBox();
    const permissionsTriggerBox = await permissions.boundingBox();
    expect((permissionsBox?.height ?? 0) - (permissionsTriggerBox?.height ?? 0)).toBeLessThanOrEqual(2);
    await tabTo(page, permissions, { max: 40 });
    await page.keyboard.press("Enter");
    await expect(permissions).toHaveAttribute("aria-expanded", "true");
    await expect(
      card(page).getByRole("checkbox", { name: /Read your Library/ })
    ).toBeVisible();
  });

  test("the outline lists the card by name and choosing it reveals it", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });

    // Filter the outline to the Echoes card, then choose it.
    const nav = page.getByRole("navigation", { name: "Settings sections" });
    const tree = nav.getByRole("treegrid", { name: "Settings sections" });
    const search = nav.getByRole("searchbox", { name: "Search settings" });
    await tabTo(page, search, { max: 150 });
    await page.keyboard.type(PLUGIN_NAME);
    const entry = tree.getByRole("row", { name: /^Echoes(, current)?$/ });
    await expect(entry).toBeVisible();
    // The tree is one Tab stop; ArrowDown walks from the Plugins section to the
    // card row.
    const sectionRow = tree.getByRole("row", { name: /^Plugins(, current)?$/ });
    await tabTo(page, sectionRow, { max: 12 });
    await pressUntilFocused(page, "ArrowDown", entry, { max: 6 });
    await page.keyboard.press("Enter");

    // The card is expanded and its trigger focused.
    const trigger = cardTrigger(page);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  test("the card and its switch names follow the UI language", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const general = page.locator('[data-tutorial~="settings.general"]');
    await chooseFromSelect(page, general.getByRole("button", { name: "Language" }), "Español");
    await expect(page.getByRole("heading", { name: "Configuración", level: 1 })).toBeVisible();

    // The outline names the card in Spanish too: searching "Ecos" finds it,
    // and choosing it reveals the card.
    const nav = page.getByRole("navigation", { name: "Secciones de configuración" });
    const tree = nav.getByRole("treegrid", { name: "Secciones de configuración" });
    const search = nav.getByRole("searchbox", { name: "Buscar en la configuración" });
    await tabTo(page, search, { max: 150 });
    await page.keyboard.type("Ecos");
    const entry = tree.getByRole("row", { name: /^Ecos(, actual)?$/ });
    await expect(entry).toBeVisible();
    const sectionRow = tree.getByRole("row", { name: /^Plugins(, actual)?$/ });
    await tabTo(page, sectionRow, { max: 12 });
    await pressUntilFocused(page, "ArrowDown", entry, { max: 6 });
    await page.keyboard.press("Enter");
    await expect(cardTrigger(page)).toBeFocused();

    // The card name and the switch name read in Spanish.
    await expect(cardTrigger(page)).toHaveAccessibleName(/^Ecos/);
    await expect(page.getByRole("switch", { name: "Activar Ecos", exact: true })).toBeVisible();
  });

  test("with reduced motion the card still expands", async ({ page }) => {
    await openPluginsSection(page);
    // openPluginsSection() has set reduced motion; expanding needs no wait.
    const trigger = cardTrigger(page);
    await tabTo(page, trigger, { max: 40 });
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(card(page).locator("p").first()).toHaveText(DESCRIPTION);
  });
});
