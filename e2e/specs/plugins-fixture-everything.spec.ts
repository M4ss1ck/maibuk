// The `fixture-everything` Plugin (issue #446): one Plugin declares every
// contribution point and every Plugin Permission. The first group seeds it
// unapproved and approves it by keyboard, granting the required Plugin
// Permissions and leaving the optional ones off (the record the approval flow
// writes, proven by `src/test/unit/e2e-plugin-seed.test.ts`). The second seeds
// that same record and drives every surface it contributes, in English and in
// Spanish. The third seeds the on-demand sibling and reaches it from the
// Command Palette.
//
// @no-webkit: seeding the Plugin Directory needs OPFS, which the pinned
// Playwright WebKit build lacks (microsoft/playwright#18235; e2e/README.md).

import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { seedSettings } from "../support/storage";
import { SEED_BOOK, SEED_CHAPTERS } from "../support/seed/names";
import { expect, test } from "../support/test";

const PLUGIN_NAME = "Fixture Everything";
/** The fixture's required Plugin Permissions, in manifest order. */
const REQUIRED_PERMISSIONS = [
  "library:read",
  "library:write",
  "editor:read",
  "editor:decorate",
  "secrets",
  "network:fixture.invalid",
];
const REQUIRED_READ = "Read your Library · Required to enable this Plugin";
const OPTIONAL_LABELS = [
  "Change the focused editor · Optional",
  "Use the clipboard · Optional",
  "Run programs on your computer · Optional",
];

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });
const main = (page: Page) => page.getByRole("main");
const pluginRow = (page: Page) => page.getByRole("button", { name: PLUGIN_NAME, exact: true });

/** Jumps to the Plugins section through the Settings outline, leaving its heading focused. */
async function openPluginsSection(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tree = page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("treegrid", { name: "Settings sections" });
  const pluginsEntry = tree.getByRole("row", { name: /^Plugins(, current)?$/ });
  await expect(tree).toBeVisible();
  for (let i = 0; i < 12; i++) {
    if (await isFocusWithin(tree)) break;
    await page.keyboard.press("Shift+Tab");
  }
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", pluginsEntry, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Plugins" })).toBeFocused();
}

/** Tabs to the Plugin's row and expands it. */
async function expandPluginRow(page: Page): Promise<void> {
  await tabTo(page, pluginRow(page), { max: 30 });
  await page.keyboard.press("Enter");
}

/** Opens the Command Palette and returns its dialog. */
async function openPalette(page: Page, name = "Command palette"): Promise<Locator> {
  await page.keyboard.press("F1");
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Types a palette query into the open palette and returns the matching item. */
async function paletteItem(page: Page, dialog: Locator, query: string): Promise<Locator> {
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(query);
  const option = dialog.getByRole("option", { name: query, exact: true });
  await expect(option).toBeVisible();
  return option;
}

/** Types a palette query and waits for the item with `key` to be the active result. */
async function selectPaletteItem(
  page: Page,
  dialog: Locator,
  query: string,
  key: string
): Promise<void> {
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(query);
  const searchbox = dialog.getByRole("searchbox");
  await expect
    .poll(async () => (await searchbox.getAttribute("aria-activedescendant")) ?? "")
    .toContain(key);
}

test.describe("fixture-everything approval @wf:plugins-contributions @no-webkit", () => {
  test.use({ library: "empty", unapprovedPlugins: ["fixture-everything"] });

  test("approves it from the permission dialog by keyboard and it starts", async ({ page }) => {
    await openPluginsSection(page);
    await expandPluginRow(page);

    const review = page.getByRole("button", { name: "Review and enable", exact: true });
    await tabTo(page, review, { max: 12 });
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Review access" });
    await expect(dialog).toBeVisible();
    // A required Plugin Permission is checked and locked.
    const required = dialog.getByRole("checkbox", { name: REQUIRED_READ, exact: true });
    await expect(required).toBeChecked();
    await expect(required).toBeDisabled();
    // Leave every optional one off.
    for (const label of OPTIONAL_LABELS) {
      const optional = dialog.getByRole("checkbox", { name: label, exact: true });
      await expect(optional).toBeChecked();
      await tabTo(page, optional, { max: 20 });
      await page.keyboard.press("Space");
      await expect(optional).not.toBeChecked();
    }
    await capture(page, "plugins-fixture-permissions");

    const approve = dialog.getByRole("button", { name: "Approve this copy and enable", exact: true });
    await tabTo(page, approve, { max: 20 });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();

    // It became ready: its page renders the Plugin's own Remote UI tree.
    await page.goto("/plugin/fixture-everything/panel");
    await expect(page.getByRole("heading", { name: "Everything fixture", level: 1 })).toBeVisible();
    await expect(page.getByText("Deterministic content")).toBeVisible({ timeout: 15_000 });
    await capture(page, "plugins-fixture-page");

    // The approval persisted across a reload, with the optional grants still off.
    await page.reload();
    await expect(page.getByText("Deterministic content")).toBeVisible({ timeout: 15_000 });
    await openPluginsSection(page);
    await expandPluginRow(page);
    await expect(main(page).getByText("Enabled", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: OPTIONAL_LABELS[0], exact: true })
    ).not.toBeChecked();
  });
});

test.describe("fixture-everything contributions @wf:plugins-contributions @no-webkit", () => {
  test.use({
    library: "oneBookThreeChapters",
    plugins: ["fixture-everything"],
    // The record the approval flow writes: required granted, optional off.
    pluginApprovals: [
      { pluginId: "fixture-everything", granted: [...REQUIRED_PERMISSIONS] },
    ],
  });

  test("the sidebar entry opens the Plugin page and it renders its content", async ({ page }) => {
    await page.goto("/");
    await expect(navOption(page, "Everything fixture")).toBeVisible({ timeout: 15_000 });
    await capture(page, "plugins-fixture-sidebar");

    await tabTo(page, navOption(page, "Books"));
    await pressUntilFocused(page, "ArrowDown", navOption(page, "Everything fixture"), { max: 10 });
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/plugin\/fixture-everything\/panel$/);
    await expect(page.getByRole("heading", { name: "Everything fixture", level: 1 })).toBeVisible();
    await expect(page.getByText("Deterministic content")).toBeVisible({ timeout: 15_000 });
  });

  test("the Command Palette lists the Commands it can run here", async ({ page }) => {
    await page.goto("/");
    await expect(navOption(page, "Everything fixture")).toBeVisible({ timeout: 15_000 });

    // A navigating Command is available whenever the Plugin is installed, and a
    // global Command once it is ready. The target Command `stamp` has no target
    // on the Book list, so it is not runnable here; the test below runs it with
    // a Chapter open (#446).
    const dialog = await openPalette(page);
    await paletteItem(page, dialog, "Open fixture page");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    const reopened = await openPalette(page);
    await paletteItem(page, reopened, "English only");
  });

  test("the target Command is listed and runs from the palette on the open Chapter", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(navOption(page, "Everything fixture")).toBeVisible({ timeout: 15_000 });
    // Open the seeded Book: its last Chapter opens in the editor, the item
    // `stamp` declares as its target, so the palette offers it here.
    const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
    await expect(card).toHaveCount(1);
    await page.keyboard.press("1");
    await expect(card).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();

    const dialog = await openPalette(page);
    const option = await paletteItem(page, dialog, "Stamp");
    await expect(option).toBeVisible();
    await page.keyboard.press("Enter");

    // The host captured the open Chapter as the target: the Plugin reads it
    // back through the Library API and names it in its notification.
    await expect(page.getByRole("status").filter({ hasText: /Fixture stamped .+/ })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("the Settings row the Plugin declares renders", async ({ page }) => {
    await openPluginsSection(page);
    await expandPluginRow(page);
    await expect(page.getByRole("textbox", { name: "Fixture row" })).toBeVisible();
    await capture(page, "plugins-fixture-settings-row");
  });

  test("the editor toolbar shows the Plugin's button", async ({ page }) => {
    await seedSettings(page, { toolbarExpanded: true });
    await page.goto("/");
    await expect(navOption(page, "Everything fixture")).toBeVisible({ timeout: 15_000 });
    const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
    await expect(card).toHaveCount(1);
    await page.keyboard.press("1");
    await expect(card).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();

    const button = page.getByRole("toolbar", { name: "Toolbar" }).getByRole("button", { name: "Stamp" });
    await expect(button).toBeVisible({ timeout: 15_000 });
    await capture(page, "plugins-fixture-toolbar");
  });

  test("a Chapter Item Menu shows the Plugin's entry", async ({ page }) => {
    await page.goto("/");
    await expect(navOption(page, "Everything fixture")).toBeVisible({ timeout: 15_000 });
    const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
    await expect(card).toHaveCount(1);
    await page.keyboard.press("1");
    await expect(card).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
    // Leave the editor for the Chapter list.
    await page.keyboard.press("Escape");

    const grid = page.getByRole("grid", { name: "Chapters" });
    const row = grid.getByRole("row", { name: SEED_CHAPTERS[1].title });
    await expect(row).toBeVisible();
    await tabTo(page, grid.getByRole("row", { selected: true }));
    await pressUntilFocused(page, "ArrowUp", row);

    await page.keyboard.press("Shift+F10");
    const menu = page.getByRole("menu", { name: `More actions for ${SEED_CHAPTERS[1].title}` });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Stamp" })).toBeVisible();
    await capture(page, "plugins-fixture-chapter-menu");
  });

  test("localizes its labels, keeping an English-only Command English", async ({ page }) => {
    await seedSettings(page, { language: "es" });
    await page.goto("/");
    // The sidebar entry's label is the Plugin's localized page title.
    const spanishNav = page.getByRole("listbox", { name: "Navegación principal" });
    await expect(
      spanishNav.getByRole("option", { name: /^Fixture completo/ })
    ).toBeVisible({ timeout: 15_000 });

    const dialog = await openPalette(page, "Paleta de comandos");
    // The localized Command's Spanish label.
    await paletteItem(page, dialog, "Abrir la página del fixture");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // The English-only Command keeps its manifest label in Spanish.
    const reopened = await openPalette(page, "Paleta de comandos");
    await paletteItem(page, reopened, "English only");
  });
});

test.describe("fixture-everything on demand @wf:plugins-contributions @no-webkit", () => {
  test.use({
    library: "empty",
    plugins: ["fixture-everything-on-demand"],
    pluginApprovals: [
      { pluginId: "fixture-everything-on-demand", granted: [...REQUIRED_PERMISSIONS] },
    ],
  });

  test("warm-starts at launch and a Command from the Command Palette reaches it", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(navOption(page, "Everything fixture")).toBeVisible({ timeout: 15_000 });
    // An on-demand Plugin with a global Command warm-starts at launch: it is
    // effectively persistent (#401; src/components/plugins/PluginCommands.tsx).
    await expect(page.locator("iframe")).toHaveCount(1);

    // Running one of its Commands from the Command Palette reaches it, and the
    // result it draws through its Worker appears.
    const dialog = await openPalette(page);
    await selectPaletteItem(
      page,
      dialog,
      "Open fixture page",
      "command:plugin.fixture-everything-on-demand.openPage"
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/plugin\/fixture-everything-on-demand\/panel$/);
    await expect(page.getByText("Deterministic content")).toBeVisible({ timeout: 15_000 });
  });
});
