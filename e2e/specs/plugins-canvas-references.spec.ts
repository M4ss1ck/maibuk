// Canvas References from a Plugin (#836): the `fixture-everything` Plugin's
// `items` source answers the Canvas Reference picker in a tab of its own, and
// its two deterministic rows drive a Generic card's Present, Missing, and
// Unavailable states — by keyboard alone, over the seeded `canvasWithNodes`
// Library. The picker helpers and the card locators follow `canvas.spec.ts`,
// and the Settings helpers follow `plugins-fixture-everything.spec.ts`. The
// Built-in Maps and Reader Plugins answer the same picker through their own
// sources (#837, #838), so a Map and a Document drive those same three states.
// Tagged @sandbox because both are Plugin sandbox surfaces.

import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { installFilePicker } from "../support/file-picker";
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

/** The host's own Canvas Reference sources, in the picker's order; Plugin sources follow them. */
const HOST_TABS = ["Notes", "Books", "Chapters", "Canvases"];

/** The Maps and Reader Plugins, by the name their Settings card and tab carry. */
const MAPS = "Maps";
const READER = "Reader";
/** Reader's declared source: the picker tab's label and the card's header. */
const DOCUMENTS = "Documents";
/**
 * Both Plugin sources' tabs, in Plugin name order: the picker sorts them by
 * Plugin name, so Maps comes before Reader's Documents.
 */
const PLUGIN_TABS = [MAPS, DOCUMENTS];
/** The Map the Maps spec creates on this Canvas. */
const MAP_NAME = "Saltmarsh";
/** The Shelf title Reader gives the fixture: its file name without the extension. */
const DOCUMENT_TITLE = "twelve-pages";
/** The one fixture the Reader flows pick, as the file manager would hand it over. */
const PDF_FIXTURE = {
  name: "twelve-pages.pdf",
  path: "plugins/maibuk-reader/fixtures/twelve-pages.pdf",
  type: "application/pdf",
};

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

const openMapCanvas = (page: Page) => openCanvas(page, /Map/);

const pluginRow = (page: Page, pluginName: string) =>
  page.getByRole("button", { name: new RegExp(`^${pluginName}`) });

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
async function expandPluginRow(page: Page, pluginName: string): Promise<void> {
  await tabTo(page, pluginRow(page, pluginName), { max: 30 });
  await page.keyboard.press("Enter");
}

/** The card's enable switch. */
const enableSwitch = (page: Page, pluginName: string) =>
  page.getByRole("switch", { name: `Enable ${pluginName}`, exact: true });

/** N, then Enter, opens the picker on the seeded Canvas, which holds `count` references. */
async function openReferencePicker(page: Page, count: number): Promise<Locator> {
  // Wait for the loaded Canvas (and its seeded Canvas References) before the N
  // shortcut, which is unbound until then.
  await expect(references(page)).toHaveCount(count);
  await page.keyboard.press("n");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Add reference" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder("Search…")).toBeFocused();
  return dialog;
}

/**
 * Arrow-keys the picker's tab list from Notes to the tab labelled `label`, which
 * sits after the last host source, and proves the whole order on the way: the
 * picker opens on Notes, and one Tab reaches the selected tab (a roving tab
 * stop).
 */
async function selectItemSourceTab(
  page: Page,
  dialog: Locator,
  label: string,
  expectedTabs: readonly string[],
  captureName: string
): Promise<void> {
  const tabList = dialog.getByRole("tablist", { name: "Add reference" });
  const tabs = tabList.getByRole("tab");
  await expect(tabs).toHaveText([...expectedTabs]);

  const tab = tabList.getByRole("tab", { name: label, exact: true });
  await tabTo(page, tabList.getByRole("tab", { name: "Notes", exact: true }), { max: 5 });
  await pressUntilFocused(page, "ArrowRight", tab, { max: 6 });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await capture(page, captureName, { around: [dialog] });
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
    await openMapCanvas(page);
    const dialog = await openReferencePicker(page, 2);
    await selectItemSourceTab(
      page,
      dialog,
      SOURCE_LABEL,
      [...HOST_TABS, SOURCE_LABEL],
      "canvas-reference-plugin-tab"
    );

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
    await openMapCanvas(page);
    const dialog = await openReferencePicker(page, 2);
    await selectItemSourceTab(
      page,
      dialog,
      SOURCE_LABEL,
      [...HOST_TABS, SOURCE_LABEL],
      "canvas-reference-plugin-tab"
    );

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
    await openMapCanvas(page);
    const dialog = await openReferencePicker(page, 2);
    await selectItemSourceTab(
      page,
      dialog,
      SOURCE_LABEL,
      [...HOST_TABS, SOURCE_LABEL],
      "canvas-reference-plugin-tab"
    );
    await chooseItem(page, dialog, ALPHA.title);
    await expect(references(page).last()).toContainText(ALPHA.subtitle);
    // The placement is written before the Canvas is loaded afresh.
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const mapUrl = page.url();

    // Turn the Plugin off from its Settings row, by keyboard.
    await openPluginsSection(page);
    await expandPluginRow(page, PLUGIN_NAME);
    await tabTo(page, enableSwitch(page, PLUGIN_NAME), { max: 20 });
    await page.keyboard.press("Space");
    await expect(enableSwitch(page, PLUGIN_NAME)).not.toBeChecked();

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
    await expandPluginRow(page, PLUGIN_NAME);
    await tabTo(page, enableSwitch(page, PLUGIN_NAME), { max: 20 });
    await page.keyboard.press("Space");
    await expect(enableSwitch(page, PLUGIN_NAME)).toBeChecked();

    await page.goto(mapUrl);
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);
    const restored = references(page).last();
    await expect(restored).toContainText(ALPHA.subtitle);
    await expect(restored.getByRole("button", { name: `Open ${ALPHA.title}` })).toBeEnabled();
  });
});

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** The Map cards, by their preview's alt text (the Map's name). */
const mapNames = (page: Page) => page.getByRole("list").getByRole("img");

/** Opens Maps from the sidebar, waiting for the Plugin's launch scan. */
async function openMaps(page: Page): Promise<void> {
  await expect(navOption(page, MAPS)).toBeVisible({ timeout: 60_000 });
  await tabTo(page, navOption(page, "Books"), { max: 60 });
  await pressUntilFocused(page, "ArrowDown", navOption(page, MAPS), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/maps$/);
  await expect(page.getByRole("heading", { name: MAPS, level: 1 })).toBeVisible();
}

/** Creates a Map with no Book from the New Map dialog by keyboard. */
async function createMap(page: Page, name: string): Promise<void> {
  const trigger = page.getByRole("button", { name: "New Map" });
  await tabTo(page, trigger, { max: 60 });
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New Map" });
  await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.type(name);
  await tabTo(page, dialog.getByRole("button", { name: "Create" }), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(mapNames(page).first()).toHaveAccessibleName(name);
}

/** Opens Reader from the sidebar, waiting for the Plugin's launch scan. */
async function openReader(page: Page): Promise<void> {
  await expect(navOption(page, READER)).toBeVisible({ timeout: 60_000 });
  await tabTo(page, navOption(page, "Books"), { max: 60 });
  await pressUntilFocused(page, "ArrowDown", navOption(page, READER), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/reader$/);
  await expect(page.getByRole("heading", { name: "Shelf", level: 2 })).toBeVisible();
}

/** The whole-page Frame an open Document renders, and its own page indicator. */
const documentFrame = (page: Page) => page.frameLocator('[data-plugin-frame="page"] iframe');
const pageIndicator = (page: Page) => documentFrame(page).locator("#page-indicator");

test.describe("Maps and Documents Canvas References @wf:plugins-canvas-references @sc:canvas.addReference @sandbox", () => {
  test.use({
    library: "canvasWithNodes",
    // Playwright reads a two-item array option as [value, options], so each
    // list is wrapped in that tuple.
    plugins: [["maibuk-maps", "maibuk-reader"], { scope: "test" }],
    // The records the approval flow writes for a Built-in: required granted.
    pluginApprovals: [
      [
        {
          pluginId: "maibuk-maps",
          granted: ["library:read", "editor:write", "files:pick", "files:save"],
        },
        { pluginId: "maibuk-reader", granted: ["files:pick"] },
      ],
      { scope: "test" },
    ],
    builtInPlugins: [[{ id: "maibuk-maps" }, { id: "maibuk-reader" }], { scope: "test" }],
  });

  // A file dialog is the one way in no key reaches: the double answers it.
  test.beforeEach(async ({ page }) => {
    await installFilePicker(page, [PDF_FIXTURE]);
  });

  test("a Map reference places, opens, turns Unavailable with Maps off, comes back, and goes Missing when the Map is deleted", async ({
    page,
  }) => {
    // Five Canvas loads and two Settings round trips outrun the 30s default.
    test.setTimeout(90_000);
    await page.goto("/");
    await openMaps(page);
    await createMap(page, MAP_NAME);

    await openMapCanvas(page);
    const dialog = await openReferencePicker(page, 2);
    await selectItemSourceTab(
      page,
      dialog,
      MAPS,
      [...HOST_TABS, ...PLUGIN_TABS],
      "canvas-reference-maps-tab"
    );

    await chooseItem(page, dialog, MAP_NAME);

    // The placed card names its source above the Map's name.
    const card = references(page).last();
    await expect(card).toContainText(MAPS);
    await expect(card).toContainText(MAP_NAME);
    await capture(page, "canvas-reference-map-card", { around: [card] });
    // The placement is written before the Canvas is loaded afresh.
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const canvasUrl = page.url();

    // Open asks Maps, which loads the Map onto its own page.
    await tabTo(page, card, { max: 60 });
    await tabTo(page, card.getByRole("button", { name: `Open ${MAP_NAME}` }), { max: 5 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/map$/);

    // Turn Maps off from its Settings row, by keyboard.
    await openPluginsSection(page);
    await expandPluginRow(page, MAPS);
    await tabTo(page, enableSwitch(page, MAPS), { max: 20 });
    await page.keyboard.press("Space");
    await expect(enableSwitch(page, MAPS)).not.toBeChecked();

    // The card stays on the Canvas with its stored label, and cannot open.
    await page.goto(canvasUrl);
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);
    const unavailable = references(page).last();
    await expect(unavailable).toContainText(MAP_NAME);
    await expect(unavailable).toContainText(UNAVAILABLE_LINE);
    await expect(unavailable.getByRole("button", { name: `Open ${MAP_NAME}` })).toBeDisabled();
    await capture(page, "canvas-reference-map-unavailable", { around: [unavailable] });

    // Turning it back on resolves the same reference again.
    await openPluginsSection(page);
    await expandPluginRow(page, MAPS);
    await tabTo(page, enableSwitch(page, MAPS), { max: 20 });
    await page.keyboard.press("Space");
    await expect(enableSwitch(page, MAPS)).toBeChecked();

    await page.goto(canvasUrl);
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);
    await expect(
      references(page)
        .last()
        .getByRole("button", { name: `Open ${MAP_NAME}` })
    ).toBeEnabled();

    // Deleting the Map, after a confirmation, leaves the card Missing. The
    // Canvas page has no sidebar and "/" restores it, so Maps opens by URL.
    await page.goto("/plugin/maibuk-maps/maps");
    await expect(page.getByRole("heading", { name: MAPS, level: 1 })).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: `Delete ${MAP_NAME}` }), {
      max: 60,
    });
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(`Delete ${MAP_NAME}?`);
    await tabTo(page, confirm.getByRole("button", { name: "Delete" }), { max: 10 });
    await page.keyboard.press("Enter");
    await expect(page.getByText("No Maps yet")).toBeVisible();

    await page.goto(canvasUrl);
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);
    const missing = references(page).last();
    await expect(missing).toContainText(MAP_NAME);
    await expect(missing).toContainText(MISSING_LINE);
    await capture(page, "canvas-reference-map-missing", { around: [missing] });
  });

  test("a Document reference places, opens, turns Unavailable with the Reader off, and goes Missing when removed from the Shelf", async ({
    page,
  }) => {
    // A file pick, a PDF parse, and two Settings round trips outrun the 30s default.
    test.setTimeout(90_000);
    // Reader shelves the picked PDF; the Shelf then answers the Documents tab.
    await page.goto("/");
    await openReader(page);
    await tabTo(page, page.getByRole("button", { name: "Open file…", exact: true }), {
      max: 60,
    });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/document$/);
    await expect(pageIndicator(page)).toContainText("of 12", { timeout: 30_000 });

    await openMapCanvas(page);
    const dialog = await openReferencePicker(page, 2);
    await selectItemSourceTab(
      page,
      dialog,
      DOCUMENTS,
      [...HOST_TABS, ...PLUGIN_TABS],
      "canvas-reference-documents-tab"
    );

    await chooseItem(page, dialog, DOCUMENT_TITLE);

    // The placed card names its source above the Document's title and format.
    const card = references(page).last();
    await expect(card).toContainText(DOCUMENTS);
    await expect(card).toContainText("PDF");
    await capture(page, "canvas-reference-document-card", { around: [card] });
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const canvasUrl = page.url();

    // Open asks Reader, which reads the Document onto its own page.
    await tabTo(page, card, { max: 60 });
    await tabTo(page, card.getByRole("button", { name: `Open ${DOCUMENT_TITLE}` }), { max: 5 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/document$/);

    // Turn Reader off from its Settings row, by keyboard.
    await openPluginsSection(page);
    await expandPluginRow(page, READER);
    await tabTo(page, enableSwitch(page, READER), { max: 20 });
    await page.keyboard.press("Space");
    await expect(enableSwitch(page, READER)).not.toBeChecked();

    await page.goto(canvasUrl);
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);
    const unavailable = references(page).last();
    await expect(unavailable).toContainText(DOCUMENT_TITLE);
    await expect(unavailable).toContainText(UNAVAILABLE_LINE);
    await expect(
      unavailable.getByRole("button", { name: `Open ${DOCUMENT_TITLE}` })
    ).toBeDisabled();
    await capture(page, "canvas-reference-document-unavailable", { around: [unavailable] });

    // Turning it back on resolves the same reference again.
    await openPluginsSection(page);
    await expandPluginRow(page, READER);
    await tabTo(page, enableSwitch(page, READER), { max: 20 });
    await page.keyboard.press("Space");
    await expect(enableSwitch(page, READER)).toBeChecked();

    await page.goto(canvasUrl);
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);
    await expect(
      references(page)
        .last()
        .getByRole("button", { name: `Open ${DOCUMENT_TITLE}` })
    ).toBeEnabled();

    // Remove from Shelf forgets the Document, which leaves the card Missing.
    // Tab from Settings never leaves the page in Firefox, so the Shelf opens by URL.
    await page.goto("/plugin/maibuk-reader/reader");
    await expect(page.getByRole("heading", { name: "Shelf", level: 2 })).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "Remove from Shelf", exact: true }), {
      max: 60,
    });
    await page.keyboard.press("Enter");
    await expect(page.getByText("Your Shelf is empty", { exact: true })).toBeVisible();

    await page.goto(canvasUrl);
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);
    const missing = references(page).last();
    await expect(missing).toContainText(DOCUMENT_TITLE);
    await expect(missing).toContainText(MISSING_LINE);
    await capture(page, "canvas-reference-document-missing", { around: [missing] });
  });
});
