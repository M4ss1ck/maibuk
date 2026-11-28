// Reader, the Built-in Plugin that opens the author's own files (#653): the
// Shelf lists Documents it remembers, opening one hands the Frame to the
// Document's Reading Position, a Missing Document can be located again without
// losing that Position, and Remove forgets it. Since #944 the Shelf is the
// reader page's own Frame (`assets/ui/shelf.html`): opening a Document from the
// Shelf, and going Back to it, happens inside that one Frame, so the host URL
// stays `/plugin/maibuk-reader/reader` throughout. A file dropped from the file
// manager is the one way in no key reaches (#828), so that path goes through
// `support/file-drop.ts`, which sends the events a real drag sends. The file
// dialog is the E2E lane's File System Access double (`support/file-picker.ts`):
// a real `File` stands in for the browser's handle, so the grant persists in
// IndexedDB and the reload proves the Reading Position survives a restart.
// Tagged @sandbox because Reader is a Frame and a Worker plugin: the lane runs
// it on Chromium, WebKit, and Firefox.
//
// Every pick is made by a key press (the Shelf's "Import files" button, or the
// "Open file…" Command); the double only answers the dialog the browser would
// have shown. "Import files" shelves the pick in the background and leaves it
// closed, so Enter on its row opens it; "Open file…" opens it at once. Every
// Shelf action is a key press too: Enter on a row, the
// row's Document menu from Shift+F10, or a palette Command acting on the row
// the author last focused.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FrameLocator, Locator, Page } from "@playwright/test";
import { unzipSync, zipSync } from "fflate";
import { capture } from "../support/capture";
import { dropFiles, type DroppedFile } from "../support/file-drop";
import {
  chooseNextFile,
  chooseNextFiles,
  installFilePicker,
  setFileMissing,
  useFolderInput,
} from "../support/file-picker";
import { leaveFrame, pressUntilFocused, tabTo, tabToEither } from "../support/keyboard";
import { paletteDialog, selectPaletteCommand } from "../support/palette";
import { REPO_ROOT } from "../support/seed/seeds";
import { expect, test } from "../support/test";

const PDF = "twelve-pages.pdf";
const EPUB = "flowing.epub";
const FB2 = "story.fb2";

/** The fixtures Reader opens: a twelve-page PDF and a reflowable EPUB. */
const FIXTURES = [
  { name: PDF, path: "plugins/maibuk-reader/fixtures/twelve-pages.pdf", type: "application/pdf" },
  {
    name: EPUB,
    path: "plugins/maibuk-reader/fixtures/flowing.epub",
    type: "application/epub+zip",
  },
  { name: FB2, path: "plugins/maibuk-reader/fixtures/story.fb2", type: "application/xml" },
];

/** A committed Reader fixture, by file name. */
const fixturePath = (name: string) => resolve(REPO_ROOT, "plugins/maibuk-reader/fixtures", name);

/**
 * A folder named `Library` in a fresh temporary directory, for a folder Import
 * (#948): `files` maps each path inside it to the bytes or fixture it holds.
 */
function libraryFolder(files: Record<string, string | Uint8Array>): string {
  const root = join(mkdtempSync(join(tmpdir(), "maibuk-reader-import-")), "Library");
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(join(target, ".."), { recursive: true });
    if (typeof source === "string") copyFileSync(fixturePath(source), target);
    else writeFileSync(target, source);
  }
  return root;
}

/** The Shelf's Import card, a live status region inside the Frame. */
const importCard = (page: Page) => pageFrame(page).getByRole("status", { name: "Import progress" });

/** The Import report, a Dialog at desktop widths. */
const importReport = (page: Page) => pageFrame(page).getByRole("dialog", { name: "Import report" });

/**
 * Imports a folder: Enter on `button` (the empty Shelf's "Import folder", or
 * the chooser's Folder option) opens the folder dialog, which answers with `folder`.
 */
async function importFolderWith(page: Page, button: Locator, folder: string): Promise<void> {
  await tabTo(page, button, { max: 60 });
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles(folder);
}

/** Opens the finished Import's report from its card by keyboard. */
async function openImportReport(page: Page): Promise<Locator> {
  await tabTo(page, importCard(page).getByRole("button", { name: "View report" }), { max: 60 });
  await page.keyboard.press("Enter");
  const report = importReport(page);
  await expect(report).toBeVisible();
  return report;
}

/** The report's count tile for `label`, e.g. "Added". */
const reportTile = (report: Locator, label: string) =>
  report.locator(".shelf-report__tile").filter({ hasText: new RegExp(`^\\d+${label}$`) });

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** A fixture as the file manager would hand it over: its own bytes, base64. */
function droppedFixture(name: string): DroppedFile {
  const fixture = FIXTURES.find((candidate) => candidate.name === name);
  if (fixture === undefined) throw new Error(`no fixture named ${name}`);
  return {
    name: fixture.name,
    type: fixture.type,
    base64: readFileSync(resolve(REPO_ROOT, fixture.path)).toString("base64"),
  };
}

/**
 * The reader page's one page Frame wrapper, the host element around the iframe.
 * It is also where the host's drop listener takes a file: the hook lives on the
 * page root, so a drop on the wrapper bubbles to it whether the Frame draws the
 * Shelf or an open Document.
 */
const pageFrameWrapper = (page: Page) => page.locator('[data-plugin-frame="page"]');

/** The Frame the reader page mounts: the Shelf, and the Document opened in it. */
const pageFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-plugin-frame="page"] iframe');

/** The wrapper's iframe, as a host locator, for the keyboard helpers. */
const frameElement = (page: Page) => pageFrameWrapper(page).locator("iframe");

/**
 * The Shelf's own heading, drawn inside the Frame: "All Documents" on the Wide
 * toolbar, "Shelf" in the phone header (#945).
 */
const shelfHeading = (page: Page) =>
  pageFrame(page).getByRole("heading", { name: /^(All Documents|Shelf)$/, level: 1 });

/** The Shelf row for a Document, by the title its cover and title line carry. */
const shelfRow = (page: Page, title: string) =>
  pageFrame(page).getByRole("gridcell", { name: new RegExp(title) });

/** The Document menu a Shelf row opens, inside the Frame. */
const documentMenu = (page: Page) =>
  pageFrame(page).getByRole("menu", { name: "Document actions" });

/** The Frame's own page indicator, e.g. "2 (4 of 12)". */
const pageIndicator = (page: Page) => pageFrame(page).locator("#page-indicator");

/** Opens Reader from the sidebar, waiting for the Frame's Shelf. */
async function openReader(page: Page): Promise<void> {
  await expect(navOption(page, "Reader")).toBeVisible({ timeout: 60_000 });
  await tabTo(page, navOption(page, "Books"), { max: 60 });
  await pressUntilFocused(page, "ArrowDown", navOption(page, "Reader"), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/reader$/);
  await expect(shelfHeading(page)).toBeVisible({ timeout: 30_000 });
}

/** Leaves the Plugin page for the Library, so the next mount starts fresh. */
async function goHome(page: Page): Promise<void> {
  // The Primary navigation is a roving-focus listbox: only its active option is
  // in the tab order, so move from wherever focus is to Books with the arrow.
  // The sidebar comes before the page, so walk back to it: Firefox's Tab does
  // not wrap from the page's last control to the document's start.
  await tabTo(page, navOption(page, "Reader"), { max: 60, backwards: true });
  await pressUntilFocused(page, "ArrowUp", navOption(page, "Books"), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
}

/**
 * Shelves a file from the empty Shelf: "Import files" opens the picker, and the
 * pick imports in the background. The Document is not opened; its row appears
 * on the Shelf, and the host URL stays on /reader.
 */
async function importFiles(page: Page, title: string = "twelve-pages"): Promise<void> {
  await tabTo(page, pageFrame(page).getByRole("button", { name: "Import files", exact: true }), {
    max: 60,
  });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/reader$/);
  await expect(shelfRow(page, title)).toBeVisible({ timeout: 30_000 });
}

/**
 * Shelves a file from a Shelf that already has rows: the toolbar's Import opens
 * the chooser with "Files" focused, and Enter picks. Like the empty Shelf's
 * button, the pick imports in the background and only its row appears.
 */
async function importFromToolbar(page: Page, title: string): Promise<void> {
  // The toolbar sits before the rows, so focus may have to walk back to it.
  await tabToEither(page, pageFrame(page).getByRole("button", { name: "Import", exact: true }));
  await page.keyboard.press("Enter");
  const chooser = pageFrame(page).getByRole("dialog", { name: "Import" });
  await expect(chooser.getByRole("button", { name: /^Files/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(shelfRow(page, title)).toBeVisible({ timeout: 30_000 });
}

/** Shelves a file from the empty Shelf, then opens its row: the old one-step pick. */
async function importAndOpen(page: Page, title: string = "twelve-pages"): Promise<void> {
  await importFiles(page, title);
  await openFromShelf(page, title);
}

/**
 * Opens a Document whose row is on the Shelf: Tab to the grid's one cell for
 * that title and Enter, which asks the Worker to open it inside the same Frame.
 * The URL never leaves /reader, so nothing else marks the switch.
 */
async function openFromShelf(page: Page, title: string = "twelve-pages"): Promise<void> {
  await tabTo(page, shelfRow(page, title), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/reader$/);
}

/** Tabs from the host into the Frame, so the reading keys reach it. */
async function focusDocument(page: Page): Promise<FrameLocator> {
  const frame = pageFrame(page);
  await expect(pageIndicator(page)).toBeVisible({ timeout: 30_000 });
  await tabTo(page, frameElement(page), { max: 60 });
  return frame;
}

/** Pages forward `count` times inside the Frame. */
async function pageForward(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await page.keyboard.press("ArrowRight");
}

/**
 * Opens the palette with F1 and runs the Command named `label`. The palette's
 * field takes focus a beat after the dialog draws, so this waits for it before
 * typing: a key that lands before the field does would be typed nowhere and the
 * query would arrive with its head missing under load.
 */
async function runPalette(page: Page, label: string): Promise<void> {
  await page.keyboard.press("F1");
  const dialog = paletteDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("searchbox")).toBeFocused();
  await selectPaletteCommand(page, dialog, label);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

/**
 * Runs a palette Command from the host. The Frame keeps keyboard focus while it
 * is mounted, so focus leaves it first or F1 would open nothing.
 */
async function runHostCommand(page: Page, label: string): Promise<void> {
  await leaveFrame(page, frameElement(page));
  await runPalette(page, label);
}

/** Opens the focused row's Document menu with Shift+F10 and returns it. */
async function openRowMenu(page: Page): Promise<Locator> {
  await page.keyboard.press("Shift+F10");
  const menu = documentMenu(page);
  await expect(menu).toBeVisible();
  return menu;
}

/**
 * The wide grid card's layout at one cover size, measured in the browser:
 * the cover box is the cover's own width at 2:3, the format badge sits inside
 * it, the progress bar spans the card, the title starts below the cover, and
 * the meta line stays on one line. jsdom cannot lay these out.
 */
async function expectGridCard(page: Page, title: string, width: number): Promise<void> {
  const card = shelfRow(page, title);
  const box = async (selector: string) => {
    const rect = await card.locator(selector).first().boundingBox();
    if (rect === null) throw new Error(`${selector} is not drawn`);
    return rect;
  };
  const cover = await box(".shelf-card__cover");
  const image = await box(".kit-cover");
  const badge = await box(".shelf-card__format");
  const progress = await box(".shelf-card__progress");
  const titleLine = await box(".shelf-card__title");
  const meta = await box(".shelf-card__meta");
  expect(cover.width).toBe(width);
  expect(cover.height).toBe(width * 1.5);
  expect(image.height).toBeLessThanOrEqual(cover.height);
  expect(badge.x + badge.width).toBeLessThanOrEqual(cover.x + cover.width);
  expect(progress.width).toBe(width);
  expect(titleLine.y).toBeGreaterThanOrEqual(cover.y + cover.height);
  expect(titleLine.height).toBeGreaterThan(0);
  // One line of `--type-small-line` (18 px in tokens.css).
  expect(meta.height).toBeLessThanOrEqual(18);
}

test.use({
  plugins: ["maibuk-reader"],
  // A seeded Built-in approval starts disabled; Reader needs to be enabled, and
  // its one required Plugin Permission pre-granted, to reach its Shelf.
  pluginApprovals: [{ pluginId: "maibuk-reader", granted: ["files:pick"] }],
  builtInPlugins: [{ id: "maibuk-reader" }],
});

test.beforeEach(async ({ page }) => {
  await installFilePicker(page, FIXTURES);
});

test.describe("Reader", () => {
  test("page forward to page 4, back to the Shelf, reload, and reopen at page 4 @wf:reader-open-reopen @sc:plugin.maibuk-reader.openFile @sc:plugin.maibuk-reader.nextPage @sc:plugin.maibuk-reader.previousPage @sc:plugin.maibuk-reader.lastPage @sc:plugin.maibuk-reader.firstPage @sc:plugin.maibuk-reader.findInDocument @sc:plugin.maibuk-reader.toggleContents @sc:plugin.maibuk-reader.zoomIn @sc:plugin.maibuk-reader.zoomOut @sc:plugin.maibuk-reader.fitWidth @sc:plugin.maibuk-reader.fitPage @sc:plugin.maibuk-reader.backToShelf @sc:plugin.maibuk-reader.toggleContinuousScroll @sandbox", async ({
    page,
  }) => {
    await page.goto("/");
    await openReader(page);
    await expect(pageFrame(page).getByText("Your Shelf is empty", { exact: true })).toBeVisible();
    await capture(page, "reader-shelf-empty");

    // "Import files" shelves the PDF in the background; Enter on its row opens
    // it inside the same Frame, and the host URL stays on /reader.
    await importAndOpen(page);
    const frame = await focusDocument(page);
    await expect(pageIndicator(page)).toContainText("1 of 12");

    // Arrow keys page inside the Frame; the Command does the same from the
    // host's keyboard, and both leave the indicator on the same page.
    await pageForward(page, 1);
    await expect(pageIndicator(page)).toContainText("2 of 12");
    await runHostCommand(page, "Next page");
    await expect(pageIndicator(page)).toContainText("3 of 12");
    await runHostCommand(page, "Previous page");
    await expect(pageIndicator(page)).toContainText("2 of 12");
    // The host palette hands focus back to the host, so re-enter the Frame
    // before the arrow keys page inside it.
    await focusDocument(page);
    await pageForward(page, 2);
    await expect(pageIndicator(page)).toContainText("4 of 12");
    await capture(page, "reader-page-view");

    await runHostCommand(page, "Find in Document");
    await expect(frame.getByRole("searchbox")).toBeVisible();
    await focusDocument(page);
    await page.keyboard.press("Escape");
    await expect(frame.getByRole("searchbox")).toBeHidden();

    await runHostCommand(page, "Toggle contents");
    await expect(frame.getByRole("tree")).toBeVisible();
    await focusDocument(page);
    await page.keyboard.press("Escape");
    await expect(frame.getByRole("tree")).toBeHidden();

    // The zoom Commands are keyboard-reachable through the palette even
    // though Reader ships them unbound; the Frame's own zoom readout moves.
    const zoom = frame.locator("#zoom-level");
    const before = await zoom.textContent();
    await runHostCommand(page, "Zoom in");
    await expect(zoom).not.toHaveText(before ?? "");
    await runHostCommand(page, "Zoom out");
    await runHostCommand(page, "Fit width");
    await runHostCommand(page, "Fit page");

    // Back to Shelf returns to the Shelf inside the same Frame, still on
    // /reader, with the Reading Position drawn on the row.
    await runHostCommand(page, "Back to Shelf");
    await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/reader$/);
    await expect(shelfHeading(page)).toBeVisible();
    await expect(shelfRow(page, "twelve-pages")).toContainText("p. 4 of 12");
    await capture(page, "reader-shelf-filled");

    // A reload at /reader draws the Shelf again; reopening its row opens the
    // Document in the Frame at page 4.
    await page.reload();
    await expect(shelfHeading(page)).toBeVisible({ timeout: 60_000 });
    await openFromShelf(page);
    await expect(pageIndicator(page)).toContainText("4 of 12", { timeout: 30_000 });

    // Last page and first page round-trip the same Position from the host.
    await focusDocument(page);
    await runHostCommand(page, "Last page");
    await expect(pageIndicator(page)).toContainText("12 of 12");
    await runHostCommand(page, "First page");
    await expect(pageIndicator(page)).toContainText("1 of 12");

    // Continuous scroll stacks every page; the Command and the toolbar toggle agree.
    const layout = frame.locator("#layout-toggle");
    await runHostCommand(page, "Continuous scroll");
    await expect(layout).toHaveAttribute("aria-pressed", "true");
    await expect(frame.locator(".pdf-page:not([hidden])")).toHaveCount(12);
    await capture(page, "reader-continuous-view");
    await runHostCommand(page, "Continuous scroll");
    await expect(layout).toHaveAttribute("aria-pressed", "false");
    await expect(frame.locator(".pdf-page:not([hidden])")).toHaveCount(1);
  });

  test("open the reflowable EPUB by Command, page forward twice, and reopen at the same spot @wf:reader-open-reopen @sc:plugin.maibuk-reader.openReader @sc:plugin.maibuk-reader.openFile @sandbox", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(navOption(page, "Reader")).toBeVisible({ timeout: 60_000 });
    await runPalette(page, "Open Reader");
    await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/reader$/);
    await expect(shelfHeading(page)).toBeVisible({ timeout: 30_000 });

    // "Open file…" from the palette shelves the EPUB and opens it in the
    // reader page's Frame; the host URL never leaves /reader.
    await chooseNextFile(page, EPUB);
    await runHostCommand(page, "Open file…");

    const frame = await focusDocument(page);
    await expect(frame.getByRole("heading", { name: "One" })).toBeVisible({ timeout: 30_000 });
    await pageForward(page, 2);

    // The spot is whichever of the two chapters' text is on screen; the
    // indicator says where in its section the page sits.
    const spot = await pageIndicator(page).textContent();
    const visible = frame.getByText(
      /The spice must flow across Arrakis\.|The journey continues past the desert\./
    );
    await expect(visible).toBeVisible();
    await capture(page, "reader-flowing-view");

    // Escape returns to the Shelf inside the same Frame, still on /reader.
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/reader$/);
    await expect(shelfHeading(page)).toBeVisible();

    await openFromShelf(page, "Dune");
    await expect(pageIndicator(page)).toHaveText(spot ?? "", { timeout: 30_000 });
    await expect(
      pageFrame(page).getByText(
        /The spice must flow across Arrakis\.|The journey continues past the desert\./
      )
    ).toBeVisible();

    // Contents is the EPUB's nav (One, Two). It opens by the Command, so it
    // runs before the search and no palette step follows the capture.
    await focusDocument(page);
    await runHostCommand(page, "Toggle contents");
    await expect(frame.getByRole("tree").getByText("One", { exact: true })).toBeVisible();
    await capture(page, "reader-contents");
    await focusDocument(page);
    await page.keyboard.press("Escape");
    await expect(frame.getByRole("tree")).toBeHidden();

    // Search runs inside the Frame: Ctrl+F opens the bar with focus in its
    // input, the query types there, and Enter runs it. The status reads
    // "1 of N" once the first match is shown.
    await page.keyboard.press("ControlOrMeta+f");
    await expect(frame.getByRole("searchbox")).toBeVisible();
    await page.keyboard.type("spice");
    await page.keyboard.press("Enter");
    await expect(frame.locator("#search-status")).toHaveText(/^1 of \d+$/, { timeout: 30_000 });
    await capture(page, "reader-search");
  });

  test("a Missing Document shows its state, and Locate again keeps the Reading Position @wf:reader-missing-locate @sc:plugin.maibuk-reader.openFile @sc:plugin.maibuk-reader.locateDocument @sandbox", async ({
    page,
  }) => {
    await page.goto("/");
    await openReader(page);
    await importAndOpen(page);
    await focusDocument(page);
    await pageForward(page, 3);
    await expect(pageIndicator(page)).toContainText("4 of 12");
    await page.keyboard.press("Escape");
    await expect(shelfRow(page, "twelve-pages")).toContainText("p. 4 of 12");

    // The device can no longer read the file: the next mount marks the row.
    await setFileMissing(page, PDF, true);
    await goHome(page);
    await openReader(page);
    await expect(
      shelfRow(page, "twelve-pages").getByText("Missing", { exact: true })
    ).toBeVisible();
    await capture(page, "reader-missing-document");

    // The palette's "Locate" acts on the row the author selected: the same
    // bytes match its Fingerprint and reattach the Document, Position kept.
    await tabTo(page, shelfRow(page, "twelve-pages"), { max: 60 });
    await setFileMissing(page, PDF, false);
    await chooseNextFile(page, PDF);
    await runHostCommand(page, "Locate");
    await expect(pageFrame(page).getByText("Missing", { exact: true })).toHaveCount(0);
    await expect(shelfRow(page, "twelve-pages")).toContainText("p. 4 of 12");

    // The row's own Document menu locates it again, by keyboard: Shift+F10
    // offers Locate first on a Missing row, and Enter takes it.
    await setFileMissing(page, PDF, true);
    await goHome(page);
    await openReader(page);
    await expect(
      shelfRow(page, "twelve-pages").getByText("Missing", { exact: true })
    ).toBeVisible();
    await setFileMissing(page, PDF, false);
    await chooseNextFile(page, PDF);
    await tabTo(page, shelfRow(page, "twelve-pages"), { max: 60 });
    const menu = await openRowMenu(page);
    const locate = menu.getByRole("menuitem", { name: "Locate", exact: true });
    await expect(locate).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(pageFrame(page).getByText("Missing", { exact: true })).toHaveCount(0);
    await expect(shelfRow(page, "twelve-pages")).toContainText("p. 4 of 12");

    // Reopening lands on page 4, and Back returns focus to the row that opened it.
    await openFromShelf(page);
    await expect(pageIndicator(page)).toContainText("4 of 12", { timeout: 30_000 });
    await focusDocument(page);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/reader$/);
    await expect(shelfRow(page, "twelve-pages")).toBeFocused();
  });

  test("Remove from Shelf forgets the Document and leaves its file alone @wf:reader-remove @sc:plugin.maibuk-reader.removeFromShelf @sandbox", async ({
    page,
  }) => {
    await page.goto("/");
    await openReader(page);
    await importAndOpen(page);
    await focusDocument(page);
    await page.keyboard.press("Escape");
    await expect(shelfRow(page, "twelve-pages")).toBeVisible();

    // Shift+F10 opens the row's Document menu; Remove from Shelf… asks first,
    // and the confirmation states the real counts it would delete.
    await tabTo(page, shelfRow(page, "twelve-pages"), { max: 60 });
    const menu = await openRowMenu(page);
    await expect(menu.getByRole("menuitem", { name: "Open", exact: true })).toBeFocused();
    await capture(page, "reader-document-menu");
    await page.keyboard.press("ArrowDown");
    await expect(
      menu.getByRole("menuitem", { name: "Remove from Shelf…", exact: true })
    ).toBeFocused();
    await page.keyboard.press("Enter");

    const dialog = pageFrame(page).getByRole("alertdialog", {
      name: 'Remove "twelve-pages" from the Shelf?',
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Its 0 Bookmarks and 0 Highlights are deleted too.");
    await expect(dialog).toContainText("Reading Stats are kept. The file stays on your device.");
    await capture(page, "reader-remove-confirm");
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Remove", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(shelfRow(page, "twelve-pages")).toHaveCount(0);
    await expect(pageFrame(page).getByText("Your Shelf is empty", { exact: true })).toBeVisible();

    // The palette's "Remove from Shelf…" Command removes the selected row the
    // same way, so a re-picked file goes through the confirmation again.
    await importAndOpen(page);
    await focusDocument(page);
    await page.keyboard.press("Escape");
    await expect(shelfRow(page, "twelve-pages")).toBeVisible();
    await tabTo(page, shelfRow(page, "twelve-pages"), { max: 60 });
    await runHostCommand(page, "Remove from Shelf…");
    const confirm = pageFrame(page).getByRole("alertdialog", {
      name: 'Remove "twelve-pages" from the Shelf?',
    });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(shelfRow(page, "twelve-pages")).toHaveCount(0);
    await expect(pageFrame(page).getByText("Your Shelf is empty", { exact: true })).toBeVisible();
  });

  test("switch the Shelf's view, sort by title, filter by format, search, and find it all again after a reload @wf:reader-shelf-view @sc:plugin.maibuk-reader.searchShelf @sc:plugin.maibuk-reader.showShelfOptions @sc:plugin.maibuk-reader.clearShelfFilters @sandbox", async ({
    page,
  }) => {
    const frame = pageFrame(page);
    await page.goto("/");
    await openReader(page);
    // Two Documents on the Shelf: the PDF from the empty state, then the EPUB
    // from the toolbar's Import.
    await importAndOpen(page);
    await focusDocument(page);
    await page.keyboard.press("Escape");
    await expect(shelfRow(page, "twelve-pages")).toBeVisible();
    await chooseNextFile(page, EPUB);
    // Import reads the EPUB's own title, so the row says "Dune" from the start (#949).
    await importFromToolbar(page, "Dune");
    await openFromShelf(page, "Dune");
    await focusDocument(page);
    await page.keyboard.press("Escape");
    await expect(shelfRow(page, "Dune")).toBeVisible();
    await expect(frame.getByText("2 Documents", { exact: true })).toBeVisible();
    // Opened once, so neither Document is new any more.
    await expect(frame.getByText("New", { exact: true })).toHaveCount(0);
    await expectGridCard(page, "Dune", 128);
    await capture(page, "reader-shelf-grid-medium");

    // Cover size: one Tab stop after the view switch; the arrows walk S, M, L.
    const sizes = frame.getByRole("radiogroup", { name: "Cover size" });
    // Back from the EPUB, focus is on its row, after the toolbar: walk either way.
    await tabToEither(page, sizes.getByRole("radio", { name: "Medium" }), { max: 60 });
    await page.keyboard.press("ArrowLeft");
    await expect(sizes.getByRole("radio", { name: "Small" })).toBeChecked();
    await expectGridCard(page, "Dune", 88);
    await capture(page, "reader-shelf-grid-small");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(sizes.getByRole("radio", { name: "Large" })).toBeChecked();
    await expectGridCard(page, "Dune", 176);
    await capture(page, "reader-shelf-grid-large");
    await page.keyboard.press("ArrowLeft");
    await expect(sizes.getByRole("radio", { name: "Medium" })).toBeChecked();

    // View: the Shelf view radio group is one Tab stop; ArrowRight picks List,
    // then Compact, and ArrowLeft comes back to List.
    const views = frame.getByRole("radiogroup", { name: "Shelf view" });
    await tabTo(page, views.getByRole("radio", { name: "Grid" }), { max: 10, backwards: true });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(views.getByRole("radio", { name: "Compact" })).toBeChecked();
    await capture(page, "reader-shelf-compact");
    await page.keyboard.press("ArrowLeft");
    await expect(views.getByRole("radio", { name: "List" })).toBeChecked();
    await expect(frame.getByRole("radiogroup", { name: "Cover size" })).toHaveCount(0);
    await capture(page, "reader-shelf-list");

    // Sort: the Sort popover's radio list, by keyboard, to Title (A to Z).
    // Sort and Filters sit before the view switch, so Shift+Tab walks back.
    await tabTo(page, frame.getByRole("button", { name: "Sort by: Recent" }), {
      max: 10,
      backwards: true,
    });
    await page.keyboard.press("Enter");
    const sorts = frame.getByRole("radiogroup", { name: "Sort by" });
    await expect(sorts.getByRole("radio", { name: "Recent" })).toBeVisible();
    await capture(page, "reader-shelf-sort");
    await tabTo(page, sorts.getByRole("radio", { name: "Recent" }), { max: 10 });
    await page.keyboard.press("ArrowDown");
    await expect(sorts.getByRole("radio", { name: "Title" })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(frame.getByRole("button", { name: "Sort by: Title" })).toBeVisible();
    const titles = frame.locator(".shelf-list__title");
    await expect(titles).toHaveText(["Dune", "twelve-pages"]);

    // Filter: the Filters popover's PDF chip leaves the PDF alone, with its chip.
    await tabTo(page, frame.getByRole("button", { name: /^Filters/ }), { max: 60 });
    await page.keyboard.press("Enter");
    await tabTo(page, frame.getByRole("button", { name: "PDF", exact: true }), { max: 20 });
    await capture(page, "reader-shelf-filters");
    await page.keyboard.press("Space");
    await page.keyboard.press("Escape");
    await expect(frame.getByRole("button", { name: "Remove filter Format: PDF" })).toBeVisible();
    await expect(titles).toHaveText(["twelve-pages"]);
    await expect(frame.getByText("1 of 2", { exact: true })).toBeVisible();
    await capture(page, "reader-shelf-filtered");
    await runHostCommand(page, "View, sort and filter…");
    await expect(frame.getByRole("dialog", { name: "Filters" })).toBeVisible();
    await page.keyboard.press("Escape");
    await runHostCommand(page, "Clear Shelf filters");
    await expect(titles).toHaveText(["Dune", "twelve-pages"]);

    // Search: / focuses the field from the grid, typing filters, Escape clears
    // it and hands focus back to the row it came from.
    await tabTo(page, shelfRow(page, "Dune"), { max: 60 });
    await page.keyboard.press("/");
    const search = frame.getByRole("searchbox", { name: "Search the Shelf" });
    await expect(search).toBeFocused();
    await page.keyboard.type("twelve");
    await expect(titles).toHaveText(["twelve-pages"]);
    await capture(page, "reader-shelf-search");
    // A search nothing matches says so in place of the rows.
    await page.keyboard.type("zz");
    await expect(frame.getByRole("heading", { name: "No Documents match" })).toBeVisible();
    await capture(page, "reader-shelf-no-match");
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(titles).toHaveText(["Dune", "twelve-pages"]);
    await expect(shelfRow(page, "Dune")).toBeFocused();
    // Ctrl or Cmd+F, Find in Document's shortcut, searches the Shelf here.
    await page.keyboard.press("ControlOrMeta+f");
    await expect(search).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(shelfRow(page, "Dune")).toBeFocused();

    // Remembered: a reload draws the same List view and Title sort.
    await page.reload();
    await expect(shelfHeading(page)).toBeVisible({ timeout: 30_000 });
    await expect(views.getByRole("radio", { name: "List" })).toBeChecked();
    await expect(frame.getByRole("button", { name: "Sort by: Title" })).toBeVisible();
    await expect(titles).toHaveText(["Dune", "twelve-pages"]);
  });

  test("make a Collection, file a Document from its menu, filter the Shelf to it from the rail, reload, rename it, and delete it @wf:reader-collections @sc:plugin.maibuk-reader.newCollection @sc:plugin.maibuk-reader.renameCollection @sc:plugin.maibuk-reader.deleteCollection @sandbox", async ({
    page,
  }) => {
    // The rail is drawn once the Frame is at least 960 px wide.
    await page.setViewportSize({ width: 1600, height: 900 });
    const frame = pageFrame(page);
    await page.goto("/");
    await openReader(page);
    await importAndOpen(page);
    await focusDocument(page);
    await page.keyboard.press("Escape");
    await expect(shelfRow(page, "twelve-pages")).toBeVisible();
    await chooseNextFile(page, EPUB);
    // Import reads the EPUB's own title, so the row says "Dune" from the start (#949).
    await importFromToolbar(page, "Dune");
    await openFromShelf(page, "Dune");
    await focusDocument(page);
    await page.keyboard.press("Escape");
    await expect(shelfRow(page, "Dune")).toBeVisible();
    const rail = frame.getByRole("complementary", { name: "Collections" });
    await expect(rail).toBeVisible();

    // New Collection, from the palette.
    await runHostCommand(page, "New Collection…");
    const create = frame.getByRole("dialog", { name: "New Collection" });
    await expect(create).toBeVisible();
    await expect(create.getByRole("textbox", { name: "Name" })).toBeFocused();
    await page.keyboard.type("Research");
    await capture(page, "reader-collection-new");
    await page.keyboard.press("Enter");
    await expect(create).toBeHidden();
    const research = rail.getByRole("button", { name: /^Research\s*0$/ });
    await expect(research).toBeVisible();

    // File Dune from its Document menu; the check box keeps the menu open.
    await tabTo(page, shelfRow(page, "Dune"), { max: 60 });
    const menu = await openRowMenu(page);
    const box = menu.getByRole("menuitemcheckbox", { name: /^Research/ });
    await pressUntilFocused(page, "ArrowDown", box, { max: 10 });
    await page.keyboard.press("Space");
    await expect(box).toHaveAttribute("aria-checked", "true");
    await capture(page, "reader-collection-menu");
    await page.keyboard.press("Escape");
    await expect(rail.getByRole("button", { name: /^Research\s*1$/ })).toBeVisible();

    // Filter to it from the rail.
    const filed = rail.getByRole("button", { name: /^Research\s*1$/ });
    await tabTo(page, filed, { max: 60, backwards: true });
    await page.keyboard.press("Enter");
    await expect(filed).toHaveAttribute("aria-current", "true");
    await expect(frame.getByRole("heading", { level: 1, name: "Research" })).toBeVisible();
    await expect(shelfRow(page, "twelve-pages")).toHaveCount(0);
    await expect(shelfRow(page, "Dune")).toBeVisible();
    await capture(page, "reader-collection-rail");

    // Remembered across a reload.
    await page.reload();
    await expect(frame.getByRole("heading", { level: 1, name: "Research" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(shelfRow(page, "twelve-pages")).toHaveCount(0);

    // Rename Collection acts on the filtered one.
    await runHostCommand(page, "Rename Collection…");
    const rename = frame.getByRole("dialog", { name: "Rename Collection" });
    const name = rename.getByRole("textbox", { name: "Name" });
    await expect(name).toBeFocused();
    await expect(name).toHaveValue("Research");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Notes");
    await page.keyboard.press("Enter");
    await expect(rename).toBeHidden();
    await expect(frame.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible();

    // Delete Collection too, and every Document comes back.
    await runHostCommand(page, "Delete Collection…");
    const confirm = frame.getByRole("alertdialog", { name: "Delete “Notes”?" });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText("Its Documents stay on the Shelf.")).toBeVisible();
    await capture(page, "reader-collection-delete");
    await tabTo(page, confirm.getByRole("button", { name: "Delete", exact: true }), { max: 5 });
    await page.keyboard.press("Enter");
    await expect(confirm).toBeHidden();
    await expect(frame.getByRole("heading", { level: 1, name: "All Documents" })).toBeVisible();
    await expect(shelfRow(page, "twelve-pages")).toBeVisible();
    await expect(rail.getByText("No Collections yet")).toBeVisible();
  });

  test("drop the EPUB on the Shelf Frame, then the PDF on the open Document @wf:reader-drop @sandbox", async ({
    page,
  }) => {
    await page.goto("/");
    await openReader(page);
    await expect(pageFrame(page).getByText("Your Shelf is empty", { exact: true })).toBeVisible();

    // A drop on the reader page's Frame wrapper shelves the Document and opens
    // it inside that same Frame. Unlike "Import files", a drop still opens it.
    await dropFiles(pageFrameWrapper(page), [droppedFixture(EPUB)]);
    await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/reader$/);
    const frame = await focusDocument(page);
    await expect(frame.getByRole("heading", { name: "One" })).toBeVisible({ timeout: 30_000 });
    await expect(
      frame.getByText(
        /The spice must flow across Arrakis\.|The journey continues past the desert\./
      )
    ).toBeVisible();
    await capture(page, "reader-drop-epub");

    // A drop on the same open-document Frame switches to the PDF.
    await dropFiles(pageFrameWrapper(page), [droppedFixture(PDF)]);
    await expect(pageIndicator(page)).toContainText("of 12", { timeout: 30_000 });
    await capture(page, "reader-drop-pdf");

    // Escape leaves the Document for the Shelf inside the same Frame, which
    // lists both Documents.
    await focusDocument(page);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/reader$/);
    await expect(shelfRow(page, "Dune")).toBeVisible();
    await expect(shelfRow(page, "twelve-pages")).toBeVisible();
    await capture(page, "reader-shelf-dropped");
  });

  test("on a phone, the Shelf draws the phone grid and a tap on More opens the Document menu as a sheet @wf:reader-remove @touch", async ({
    page,
  }) => {
    // The background Import and the open through the More menu outrun the 30s default.
    test.setTimeout(60_000);
    await page.goto("/plugin/maibuk-reader/reader");
    await expect(shelfHeading(page)).toBeVisible({ timeout: 60_000 });
    await capture(page, "reader-shelf-empty-phone");
    await pageFrame(page).getByRole("button", { name: "Import files" }).tap();
    await expect(shelfRow(page, "twelve-pages")).toBeVisible({ timeout: 30_000 });
    // Touch opens a row through its More menu's Open.
    await pageFrame(page).getByRole("button", { name: "More for twelve-pages" }).tap();
    await documentMenu(page).getByRole("menuitem", { name: "Open", exact: true }).tap();
    await expect(pageIndicator(page)).toBeVisible({ timeout: 30_000 });
    await pageFrame(page).getByRole("button", { name: "Back to Shelf" }).tap();
    await expect(shelfRow(page, "twelve-pages")).toBeVisible();
    await capture(page, "reader-shelf-phone");

    // The phone header's View, sort and filter button opens the options sheet.
    await pageFrame(page).getByRole("button", { name: "View, sort and filter" }).tap();
    const sheet = pageFrame(page).getByRole("dialog", { name: "View and filters" });
    await expect(sheet).toBeVisible();
    await capture(page, "reader-shelf-options-phone");
    await sheet.getByRole("button", { name: "Done", exact: true }).tap();
    await expect(sheet).toBeHidden();

    // Its search button swaps the header for the search field.
    await pageFrame(page).getByRole("button", { name: "Search the Shelf" }).tap();
    const phoneSearch = pageFrame(page).getByRole("searchbox", { name: "Search the Shelf" });
    await expect(phoneSearch).toBeFocused();
    await page.keyboard.type("twelve");
    await capture(page, "reader-shelf-search-phone");
    await pageFrame(page).getByRole("button", { name: "Close search" }).tap();
    await expect(phoneSearch).toHaveCount(0);

    // Touch reaches the Document menu through the row's More button.
    await pageFrame(page).getByRole("button", { name: "More for twelve-pages" }).tap();
    const menu = documentMenu(page);
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Open", exact: true })).toBeVisible();
    await capture(page, "reader-document-menu-phone");
    await menu.getByRole("menuitem", { name: "Remove from Shelf…", exact: true }).tap();
    const confirm = pageFrame(page).getByRole("alertdialog", {
      name: 'Remove "twelve-pages" from the Shelf?',
    });
    await expect(confirm).toContainText("Its 0 Bookmarks and 0 Highlights are deleted too.");
    await capture(page, "reader-remove-confirm-phone");
    await confirm.getByRole("button", { name: "Remove", exact: true }).tap();
    await expect(shelfRow(page, "twelve-pages")).toHaveCount(0);
    await expect(pageFrame(page).getByText("Your Shelf is empty", { exact: true })).toBeVisible();
  });
});

// The background Import (#948): picked files or a whole folder land on the
// Shelf while the author keeps reading, the card counts them, Cancel keeps what
// was added, and the report names every file. Every rule behind the counts
// (Fingerprint skip, relink, duplicates, the sort) is proven in Reader's Vitest
// suite (import.test.ts); these specs prove the flows in a real browser.
test.describe("Reader Import", () => {
  test("import two picked files, read the report by keyboard, and open its Details @wf:reader-import @sc:plugin.maibuk-reader.importFiles @sc:plugin.maibuk-reader.viewImportReport @sandbox", async ({
    page,
  }) => {
    await page.goto("/");
    await openReader(page);
    // The palette's "Import files…" Command runs the same pick as the empty
    // Shelf's button, which the other Reader specs press.
    await chooseNextFiles(page, [PDF, FB2]);
    await runHostCommand(page, "Import files…");

    // Both Documents land on the Shelf; neither opens.
    await expect(shelfRow(page, "twelve-pages")).toBeVisible({ timeout: 30_000 });
    await expect(pageFrame(page).getByText("2 Documents", { exact: true })).toBeVisible();
    const card = importCard(page);
    await expect(card).toContainText("Imported files");
    await expect(card).toContainText("2 added");
    await capture(page, "reader-import-done");

    const report = await openImportReport(page);
    await expect(report).toContainText("Picked files");
    await expect(reportTile(report, "Added")).toContainText("2");
    await expect(reportTile(report, "Unreadable")).toContainText("0");
    await capture(page, "reader-import-report");

    // Enter on a Details summary opens its list, as a browser's native
    // <details> does; the jsdom suite cannot press it for real.
    // Added is the first of the three Details lists.
    const added = report.locator("details").first();
    const summary = added.locator("summary");
    await expect(summary).toHaveText(/^Added\s*2$/);
    await tabTo(page, summary, { max: 20 });
    await expect(added.getByText(PDF, { exact: true })).toBeHidden();
    await page.keyboard.press("Enter");
    await expect(added.getByText(PDF, { exact: true })).toBeVisible();
    await expect(added.getByText(FB2, { exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(added.getByText(PDF, { exact: true })).toBeHidden();

    // Escape closes the report and returns focus to the card's View report.
    await page.keyboard.press("Escape");
    await expect(report).toBeHidden();
    await expect(card.getByRole("button", { name: "View report" })).toBeFocused();
  });

  test("import a folder through the directory input, then import it again and add nothing @wf:reader-import @sc:plugin.maibuk-reader.importFolder @sc:plugin.maibuk-reader.viewImportReport @chromium-only", async ({
    page,
  }) => {
    const folder = libraryFolder({
      [EPUB]: EPUB,
      "Sub/twelve-pages.pdf": PDF,
      "Sub/broken.epub": "corrupt.epub",
      "notes.txt": new TextEncoder().encode("not a Document"),
    });
    await useFolderInput(page);
    await page.goto("/");
    await openReader(page);
    await importFolderWith(
      page,
      pageFrame(page).getByRole("button", { name: "Import folder", exact: true }),
      folder
    );

    await expect(shelfRow(page, "twelve-pages")).toBeVisible({ timeout: 30_000 });
    await expect(pageFrame(page).getByText("2 Documents", { exact: true })).toBeVisible();
    const card = importCard(page);
    await expect(card).toContainText('Imported "Library"');
    await expect(card).toContainText("2 added");
    await expect(card).toContainText("1 unreadable");

    let report = await openImportReport(page);
    await expect(report).toContainText('Folder "Library" and its subfolders');
    await expect(report).toContainText("3 files found");
    await expect(reportTile(report, "Added")).toContainText("2");
    await expect(reportTile(report, "Unreadable")).toContainText("1");
    const unreadable = report.getByRole("region", { name: "Unreadable" });
    await expect(unreadable).toContainText("broken.epub");
    await expect(unreadable).toContainText("Corrupt or incomplete file");
    await capture(page, "reader-import-folder-report");
    await page.keyboard.press("Escape");
    await expect(report).toBeHidden();

    // The toolbar's Import opens the chooser; its Folder option imports the
    // same folder again, which finds every Document already on the Shelf.
    await tabToEither(page, pageFrame(page).getByRole("button", { name: "Import", exact: true }));
    await page.keyboard.press("Enter");
    const chooser = pageFrame(page).getByRole("dialog", { name: "Import" });
    await expect(chooser.getByRole("button", { name: /^Files/ })).toBeFocused();
    await capture(page, "reader-import-chooser");
    await importFolderWith(page, chooser.getByRole("button", { name: /^Folder/ }), folder);
    await expect(card).toContainText("0 added", { timeout: 30_000 });
    await expect(card).toContainText("2 already on Shelf");
    // The palette's "View import report" Command opens the same report.
    await runHostCommand(page, "View import report");
    report = importReport(page);
    await expect(report).toBeVisible();
    await expect(reportTile(report, "Added")).toContainText("0");
    await expect(reportTile(report, "Already on the Shelf")).toContainText("2");
    await page.keyboard.press("Escape");
    await expect(pageFrame(page).getByText("2 Documents", { exact: true })).toBeVisible();
  });

  test("Cancel a running folder Import by keyboard and keep what it added, after a reload too @wf:reader-import @sc:plugin.maibuk-reader.importFolder @sc:plugin.maibuk-reader.cancelImport @chromium-only", async ({
    page,
  }) => {
    // Enough distinct Documents that the Import is still running when Cancel
    // lands: each copy differs by a trailing comment, so none is a duplicate.
    const story = readFileSync(fixturePath(FB2), "utf8");
    const files: Record<string, Uint8Array> = {};
    for (let index = 0; index < 400; index += 1) {
      // Each copy names its own title: copies sharing one would be collisions (#949).
      const copy = story.replace(/<book-title>([^<]*)</, `<book-title>$1 ${index}<`);
      files[`story-${String(index).padStart(3, "0")}.fb2`] = new TextEncoder().encode(
        `${copy}\n<!-- copy ${index} -->\n`
      );
    }
    const folder = libraryFolder(files);
    await useFolderInput(page);
    await page.goto("/");
    await openReader(page);
    await importFolderWith(
      page,
      pageFrame(page).getByRole("button", { name: "Import folder", exact: true }),
      folder
    );

    const card = importCard(page);
    await expect(card).toContainText("of 400 files", { timeout: 30_000 });
    await capture(page, "reader-import-running");
    // The palette's "Cancel import" Command; the card's own Cancel button is
    // pressed by keyboard in Reader's Frame suite (frame/shelf.test.tsx).
    await runHostCommand(page, "Cancel import");
    await expect(card).toContainText("Import cancelled", { timeout: 30_000 });

    const counts = (await card.textContent()) ?? "";
    const added = Number(/(\d+) added/.exec(counts)?.[1]);
    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThan(400);
    await expect(pageFrame(page).getByText(`${added} Documents`, { exact: true })).toBeVisible();

    // What Cancel kept is stored: a reload draws the same Shelf.
    await page.reload();
    await expect(shelfHeading(page)).toBeVisible({ timeout: 60_000 });
    await expect(pageFrame(page).getByText(`${added} Documents`, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });
});

// Import collisions (#949): a file with a Shelf Document's title and author but
// another Fingerprint waits in the report until the author chooses. The Keep
// both, Replace, and Skip rules are proven in Reader's Vitest suite
// (import.test.ts); this spec proves the report's keyboard flow in a browser.
test.describe("Reader Import collisions", () => {
  test("resolve a collision by keyboard: Apply waits for a choice, and Close, decide later keeps it @wf:reader-import-collisions @sc:plugin.maibuk-reader.importFolder @sc:plugin.maibuk-reader.viewImportReport @chromium-only", async ({
    page,
  }) => {
    // The same EPUB, its entries deflated: the same title and author, other bytes.
    const original = unzipSync(readFileSync(fixturePath(EPUB)));
    const rezipped = zipSync(
      Object.fromEntries(
        Object.entries(original).map(([name, data]) => [
          name,
          [data, { level: name === "mimetype" ? 0 : 6 }] as const,
        ])
      )
    );
    await useFolderInput(page);
    await page.goto("/");
    await openReader(page);
    await importFolderWith(
      page,
      pageFrame(page).getByRole("button", { name: "Import folder", exact: true }),
      libraryFolder({ [EPUB]: EPUB })
    );
    const card = importCard(page);
    await expect(card).toContainText("1 added", { timeout: 30_000 });
    await tabTo(page, card.getByRole("button", { name: "Dismiss" }), { max: 60 });
    await page.keyboard.press("Enter");

    await tabToEither(page, pageFrame(page).getByRole("button", { name: "Import", exact: true }));
    await page.keyboard.press("Enter");
    const chooser = pageFrame(page).getByRole("dialog", { name: "Import" });
    await expect(
      chooser.getByRole("checkbox", { name: /^Put a folder's Documents in a Collection/ })
    ).toBeChecked();
    await capture(page, "reader-import-chooser-collect");
    await importFolderWith(
      page,
      chooser.getByRole("button", { name: /^Folder/ }),
      libraryFolder({ "dune-second-edition.epub": rezipped })
    );
    await expect(card).toContainText("1 collision", { timeout: 30_000 });
    // Undecided collisions keep the card: it offers View report, never Dismiss.
    await expect(card.getByRole("button", { name: "Dismiss" })).toHaveCount(0);

    const report = await openImportReport(page);
    await expect(reportTile(report, "Collisions to resolve")).toContainText("1");
    await expect(report).toContainText("dune-second-edition.epub");
    await expect(report).toContainText("0 of 1");
    const apply = report.getByRole("button", { name: "Apply choices" });
    await tabTo(page, apply, { max: 40 });
    await page.keyboard.press("Enter");
    await expect(report).toContainText("0 of 1");

    // The row's radio group: its first option holds the tab stop; an arrow chooses.
    const row = report.getByRole("radiogroup", { name: /^Choice for / });
    await tabTo(page, row.getByRole("radio", { name: "Keep both" }), { max: 40 });
    await page.keyboard.press("ArrowRight");
    await expect(row.getByRole("radio", { name: "Replace", checked: true })).toBeVisible();
    await expect(report.getByRole("note")).toContainText("Replace drops");
    await capture(page, "reader-import-collisions");

    // Close, decide later; View report brings back the same choice.
    await tabTo(page, report.getByRole("button", { name: "Close, decide later" }), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(report).toBeHidden();
    const reopened = await openImportReport(page);
    await expect(
      reopened
        .getByRole("radiogroup", { name: /^Choice for / })
        .getByRole("radio", { name: "Replace", checked: true })
    ).toBeVisible();

    // Narrow draws the same report as a full-height sheet.
    const wideSize = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(reopened.getByRole("button", { name: "Close, decide later" })).toBeVisible();
    await capture(page, "reader-import-collisions-narrow");
    if (wideSize !== null) await page.setViewportSize(wideSize);
    await expect(reopened.getByRole("button", { name: "Close, decide later" })).toBeVisible();

    // Apply to all: Keep both, then Apply adds the second edition as its own Document.
    const all = reopened.getByRole("radiogroup", { name: "Apply to all collisions" });
    await tabTo(page, all.getByRole("radio", { name: "Keep both" }), { max: 40 });
    await page.keyboard.press("Space");
    await expect(reopened).toContainText("1 of 1");
    await tabTo(page, reopened.getByRole("button", { name: "Apply choices" }), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(reopened.getByRole("radiogroup", { name: /^Choice for / })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(pageFrame(page).getByText("2 Documents", { exact: true })).toBeVisible();
  });
});
