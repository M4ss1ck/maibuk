// Canvas References from a Plugin (#836): the `fixture-everything` Plugin's
// `items` source answers the Canvas Reference picker in a tab of its own, and
// its two deterministic rows drive a Generic card's Present, Missing, and
// Unavailable states — by keyboard alone, over the seeded `canvasWithNodes`
// Library. The picker helpers and the card locators follow `canvas.spec.ts`,
// and the Settings helpers follow `plugins-fixture-everything.spec.ts`.

import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

const PLUGIN_NAME = "Fixture Everything";
/** The Plugin's declared source: the picker tab's label and the card's header. */
const SOURCE_LABEL = "Fixture items";
/** The fixture's required Plugin Permissions, in manifest order: the record the
 * approval flow writes, so the seeded copy enables without a review. */
const REQUIRED_PERMISSIONS = [
  "library:read",
  "library:write",
  "editor:read",
  "editor:decorate",
  "secrets",
  "network:api.fixture.test",
];

/** The source's present row, as the fixture answers it. */
const ALPHA = { title: "Fixture Alpha", subtitle: "Fixture subtitle" };
/** The row the fixture answers as gone. */
const GONE = "Fixture Gone";

/** The notification the Plugin's own `open` shows for the present row. */
const OPENED = `Fixture opened ${ALPHA.title}`;

/** The line a Missing card adds under its stored label. */
const MISSING_LINE = "This item no longer exists";
/**
 * The line an Unavailable card adds after a page load: a turned-off Plugin has no
 * lifecycle entry and Settings has not scanned yet, so the card cannot name it.
 * The unit tests cover the named line.
 */
const UNAVAILABLE_LINE = "Not available here";

// React Flow's node wrapper carries no accessible name, so the reference cards
// are located by their type class, as `canvas.spec.ts` does.
const references = (page: Page) => page.locator(".react-flow__node-reference");

/**
 * The URL changes while the Canvas is still loading, and its shortcuts bind only
 * once it is ready; the tool toolbar renders at that same moment.
 */
async function expectCanvasReady(page: Page) {
  await expect(page).toHaveURL(/\/canvas\/[\w-]+$/);
  await expect(page.getByRole("toolbar", { name: "Tools" })).toBeVisible();
}

/** Opens a Canvas from the gallery the way an author would: Tab in, arrows, Enter. */
async function openCanvas(page: Page, name: RegExp) {
  await page.goto("/canvas");
  const grid = page.getByRole("grid", { name: "Canvases" });
  const row = grid.getByRole("row", { name });
  // Tab presses sent before the gallery renders land on an empty body.
  await expect(row).toBeVisible();
  await tabTo(page, grid.getByRole("row").first(), { max: 40 });
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowRight", row, { max: 12 });
  await page.keyboard.press("Enter");
  await expectCanvasReady(page);
}

const openMap = (page: Page) => openCanvas(page, /Map/);

const pluginRow = (page: Page) => page.getByRole("button", { name: new RegExp(`^${PLUGIN_NAME}`) });

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

/** The card's enable switch. */
const enableSwitch = (page: Page) =>
  page.getByRole("switch", { name: `Enable ${PLUGIN_NAME}`, exact: true });

/** N, then Enter, opens the picker on the seeded Canvas. */
async function openReferencePicker(page: Page): Promise<Locator> {
  // Wait for the loaded Canvas (and its seeded Canvas References) before the N
  // shortcut, which is unbound until then.
  await expect(references(page)).toHaveCount(2);
  await page.keyboard.press("n");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Add reference" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder("Search…")).toBeFocused();
  return dialog;
}

/**
 * Arrow-keys the picker's tab list from Notes to the Plugin's own tab, which sits
 * after the last host source, and proves the whole order on the way: the picker
 * opens on Notes, and one Tab reaches the selected tab (a roving tab stop).
 */
async function selectItemSourceTab(page: Page, dialog: Locator): Promise<void> {
  const tabList = dialog.getByRole("tablist", { name: "Add reference" });
  const tabs = tabList.getByRole("tab");
  await expect(tabs).toHaveText(["Notes", "Books", "Chapters", "Canvases", SOURCE_LABEL]);

  const tab = tabList.getByRole("tab", { name: SOURCE_LABEL, exact: true });
  await tabTo(page, tabList.getByRole("tab", { name: "Notes", exact: true }), { max: 5 });
  await pressUntilFocused(page, "ArrowRight", tab, { max: 6 });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await capture(page, "canvas-reference-plugin-tab", { around: [dialog] });
}

/**
 * Chooses one listed row by keyboard: Tab into the list, Enter on the option. A
 * row's subtitle is part of its option's name, so the name is matched as a
 * substring and the row is expected to be the only match.
 */
async function chooseItem(page: Page, dialog: Locator, title: string): Promise<void> {
  const option = dialog.getByRole("option", { name: title });
  await expect(option).toHaveCount(1);
  // Tab lands on the list's first row; the arrow keys walk to the rest.
  await tabTo(page, dialog.getByRole("option").first(), { max: 5 });
  await pressUntilFocused(page, "ArrowDown", option, { max: 5 });
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(references(page)).toHaveCount(3);
}

test.describe("Plugin Canvas References @wf:plugins-canvas-references @sc:canvas.addReference @sandbox", () => {
  test.use({
    library: "canvasWithNodes",
    plugins: ["fixture-everything"],
    // The record the approval flow writes: required granted, optional off.
    pluginApprovals: [{ pluginId: "fixture-everything", granted: [...REQUIRED_PERMISSIONS] }],
  });

  test("a Plugin tab lists its items and places a Generic card that opens through the Plugin", async ({
    page,
  }) => {
    await openMap(page);
    const dialog = await openReferencePicker(page);
    await selectItemSourceTab(page, dialog);

    await chooseItem(page, dialog, ALPHA.title);

    // The placed card names its source above the row's title and subtitle.
    const card = references(page).last();
    await expect(card).toContainText(SOURCE_LABEL);
    await expect(card).toContainText(ALPHA.title);
    await expect(card).toContainText(ALPHA.subtitle);
    await capture(page, "canvas-reference-generic-card", { around: [card] });

    // Open asks the Plugin itself, which reports what it opened.
    await tabTo(page, card, { max: 60 });
    await tabTo(page, card.getByRole("button", { name: `Open ${ALPHA.title}` }), { max: 5 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: OPENED })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("a Missing item flips the card and Open is disabled", async ({ page }) => {
    await openMap(page);
    const dialog = await openReferencePicker(page);
    await selectItemSourceTab(page, dialog);

    await chooseItem(page, dialog, GONE);

    // The Plugin answers `missing`, so the card keeps its stored label and says
    // what it lost, and its Open button cannot be pressed.
    const card = references(page).last();
    await expect(card).toContainText(GONE);
    await expect(card).toContainText(MISSING_LINE);
    await expect(card.getByRole("button", { name: `Open ${GONE}` })).toBeDisabled();
    await capture(page, "canvas-reference-missing-card", { around: [card] });
  });

  test("turning the Plugin off leaves its reference Unavailable and turning it on restores it", async ({
    page,
  }) => {
    await openMap(page);
    const dialog = await openReferencePicker(page);
    await selectItemSourceTab(page, dialog);
    await chooseItem(page, dialog, ALPHA.title);
    await expect(references(page).last()).toContainText(ALPHA.subtitle);
    // The placement is written before the Canvas is loaded afresh.
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const mapUrl = page.url();

    // Turn the Plugin off from its Settings row, by keyboard.
    await openPluginsSection(page);
    await expandPluginRow(page);
    await tabTo(page, enableSwitch(page), { max: 20 });
    await page.keyboard.press("Space");
    await expect(enableSwitch(page)).not.toBeChecked();

    // The card stays on the Canvas with its stored label, and cannot open.
    await page.goto(mapUrl);
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);
    const unavailable = references(page).last();
    await expect(unavailable).toContainText(ALPHA.title);
    await expect(unavailable).toContainText(UNAVAILABLE_LINE);
    await expect(unavailable.getByRole("button", { name: `Open ${ALPHA.title}` })).toBeDisabled();
    await capture(page, "canvas-reference-unavailable-card", { around: [unavailable] });

    // Turning it back on resolves the same reference again.
    await openPluginsSection(page);
    await expandPluginRow(page);
    await tabTo(page, enableSwitch(page), { max: 20 });
    await page.keyboard.press("Space");
    await expect(enableSwitch(page)).toBeChecked();

    await page.goto(mapUrl);
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);
    const restored = references(page).last();
    await expect(restored).toContainText(ALPHA.subtitle);
    await expect(restored.getByRole("button", { name: `Open ${ALPHA.title}` })).toBeEnabled();
  });
});
