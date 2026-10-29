// Reader, the Built-in Plugin that opens the author's own files (#653): the
// Shelf lists Documents it remembers, opening one hands the frame to the
// Document's Reading Position, a Missing Document can be located again without
// losing that Position, and Remove forgets it. The file dialog is the E2E
// lane's File System Access double (`support/file-picker.ts`): a real `File`
// stands in for the browser's handle, so the grant persists in IndexedDB and
// the reload proves the Reading Position survives a restart. Tagged @sandbox
// because Reader is a Frame and a Worker plugin: the lane runs it on Chromium,
// WebKit, and Firefox.
//
// Every pick is opened by a key press (the "Open file…" button, or the Command
// of the same name); the double only answers the dialog the browser would have
// shown.

import type { FrameLocator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { chooseNextFile, installFilePicker, setFileMissing } from "../support/file-picker";
import { leaveFrame, pressUntilFocused, tabTo } from "../support/keyboard";
import { runPaletteCommand } from "../support/palette";
import { expect, test } from "../support/test";

const PDF = "twelve-pages.pdf";
const EPUB = "flowing.epub";

/** The fixtures Reader opens: a twelve-page PDF and a reflowable EPUB. */
const FIXTURES = [
  { name: PDF, path: "plugins/maibuk-reader/fixtures/twelve-pages.pdf", type: "application/pdf" },
  {
    name: EPUB,
    path: "plugins/maibuk-reader/fixtures/flowing.epub",
    type: "application/epub+zip",
  },
];

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** The whole-page Frame the Document page renders. */
const documentFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-plugin-frame="page"] iframe');
const frameElement = (page: Page) => page.locator('[data-plugin-frame="page"] iframe');

/** The Frame's own page indicator, e.g. "2 (4 of 12)". */
const pageIndicator = (page: Page) => documentFrame(page).locator("#page-indicator");

/** Opens Reader from the sidebar, waiting for the Plugin's launch scan. */
async function openReader(page: Page): Promise<void> {
  await expect(navOption(page, "Reader")).toBeVisible({ timeout: 60_000 });
  await tabTo(page, navOption(page, "Books"), { max: 60 });
  await pressUntilFocused(page, "ArrowDown", navOption(page, "Reader"), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/reader$/);
  await expect(page.getByRole("heading", { name: "Shelf", level: 2 })).toBeVisible();
}

/** Leaves the Plugin page for the Library, so the next mount starts fresh. */
async function goHome(page: Page): Promise<void> {
  // The Primary navigation is a roving-focus listbox: only its active option is
  // in the tab order, so move from wherever focus is to Books with the arrow.
  await tabTo(page, navOption(page, "Reader"), { max: 60 });
  await pressUntilFocused(page, "ArrowUp", navOption(page, "Books"), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
}

/** Opens the Document whose row is on the Shelf. */
async function openFromShelf(page: Page): Promise<void> {
  await tabTo(page, page.getByRole("button", { name: "Open", exact: true }), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/document$/);
}

/** Tabs from the host page into the Frame, so the reading keys reach it. */
async function focusDocument(page: Page): Promise<FrameLocator> {
  const frame = documentFrame(page);
  await expect(pageIndicator(page)).toBeVisible({ timeout: 30_000 });
  await tabTo(page, frameElement(page), { max: 60 });
  return frame;
}

/** Pages forward `count` times inside the Frame. */
async function pageForward(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await page.keyboard.press("ArrowRight");
}

/**
 * Runs a palette Command from the host. The Frame keeps keyboard focus while it
 * is mounted, so focus leaves it first or F1 would open nothing.
 */
async function runHostCommand(page: Page, label: string): Promise<void> {
  await leaveFrame(page, frameElement(page));
  await runPaletteCommand(page, label);
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
  test(
    "page forward to page 4, back to the Shelf, reload, and reopen at page 4 @wf:reader-open-reopen @sc:plugin.maibuk-reader.openFile @sc:plugin.maibuk-reader.nextPage @sc:plugin.maibuk-reader.previousPage @sc:plugin.maibuk-reader.lastPage @sc:plugin.maibuk-reader.firstPage @sc:plugin.maibuk-reader.findInDocument @sc:plugin.maibuk-reader.toggleContents @sc:plugin.maibuk-reader.zoomIn @sc:plugin.maibuk-reader.zoomOut @sc:plugin.maibuk-reader.fitWidth @sc:plugin.maibuk-reader.fitPage @sc:plugin.maibuk-reader.backToShelf @sc:plugin.maibuk-reader.toggleContinuousScroll @sandbox",
    async ({ page }) => {
      await page.goto("/");
      await openReader(page);
      await expect(page.getByText("Your Shelf is empty", { exact: true })).toBeVisible();
      await capture(page, "reader-shelf-empty");

      await tabTo(page, page.getByRole("button", { name: "Open file…", exact: true }), {
        max: 60,
      });
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/document$/);

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
      await page.keyboard.press("Escape");

      await runHostCommand(page, "Toggle contents");
      await expect(frame.getByRole("tree")).toBeVisible();
      await page.keyboard.press("Escape");

      // The zoom Commands are keyboard-reachable through the palette even
      // though Reader ships them unbound; the Frame's own zoom readout moves.
      const zoom = frame.locator("#zoom-level");
      const before = await zoom.textContent();
      await runHostCommand(page, "Zoom in");
      await expect(zoom).not.toHaveText(before ?? "");
      await runHostCommand(page, "Zoom out");
      await runHostCommand(page, "Fit width");
      await runHostCommand(page, "Fit page");

      await runHostCommand(page, "Back to Shelf");
      await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/reader$/);
      await expect(page.getByText("p. 4 of 12", { exact: true })).toBeVisible();
      await expect(page.getByText("twelve-pages", { exact: true })).toBeVisible();
      await capture(page, "reader-shelf-filled");

      await page.reload();
      await openReader(page);
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
    }
  );

  test(
    "open the reflowable EPUB by Command, page forward twice, and reopen at the same spot @wf:reader-open-reopen @sc:plugin.maibuk-reader.openReader @sc:plugin.maibuk-reader.openFile @sandbox",
    async ({ page }) => {
      await page.goto("/");
      await expect(navOption(page, "Reader")).toBeVisible({ timeout: 60_000 });
      await runPaletteCommand(page, "Open Reader");
      await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/reader$/);

      await chooseNextFile(page, EPUB);
      await runPaletteCommand(page, "Open file…");
      await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/document$/);

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

      await page.keyboard.press("Escape");
      await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/reader$/);

      await openFromShelf(page);
      await expect(pageIndicator(page)).toHaveText(spot ?? "", { timeout: 30_000 });
      await expect(
        documentFrame(page).getByText(
          /The spice must flow across Arrakis\.|The journey continues past the desert\./
        )
      ).toBeVisible();

      // Contents is the EPUB's nav (One, Two). It opens by the Command, so it
      // runs before the search and no palette step follows the capture.
      await focusDocument(page);
      await runHostCommand(page, "Toggle contents");
      await expect(frame.getByRole("tree").getByText("One", { exact: true })).toBeVisible();
      await capture(page, "reader-contents");
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
    }
  );

  test("a Missing Document shows its state, and Locate again keeps the Reading Position @wf:reader-missing-locate @sc:plugin.maibuk-reader.openFile @sandbox", async ({
    page,
  }) => {
    await page.goto("/");
    await openReader(page);
    await tabTo(page, page.getByRole("button", { name: "Open file…", exact: true }), { max: 60 });
    await page.keyboard.press("Enter");
    await focusDocument(page);
    await pageForward(page, 3);
    await expect(pageIndicator(page)).toContainText("4 of 12");
    await page.keyboard.press("Escape");
    await expect(page.getByText("p. 4 of 12", { exact: true })).toBeVisible();

    // The device can no longer read the file: the next mount marks the row.
    await setFileMissing(page, PDF, true);
    await goHome(page);
    await openReader(page);
    await expect(page.getByText("Missing Document", { exact: true })).toBeVisible();
    await capture(page, "reader-missing-document");

    // Locate again… with the same bytes reattaches the Document.
    await setFileMissing(page, PDF, false);
    await chooseNextFile(page, PDF);
    await tabTo(page, page.getByRole("button", { name: "Locate again…", exact: true }), {
      max: 60,
    });
    await page.keyboard.press("Enter");
    await expect(page.getByText("Missing Document", { exact: true })).toHaveCount(0);
    await expect(page.getByText("p. 4 of 12", { exact: true })).toBeVisible();

    await openFromShelf(page);
    await expect(pageIndicator(page)).toContainText("4 of 12", { timeout: 30_000 });
  });

  test("Remove from Shelf forgets the Document and leaves its file alone @wf:reader-remove @sandbox", async ({
    page,
  }) => {
    await page.goto("/");
    await openReader(page);
    await tabTo(page, page.getByRole("button", { name: "Open file…", exact: true }), { max: 60 });
    await page.keyboard.press("Enter");
    await focusDocument(page);
    await page.keyboard.press("Escape");
    await expect(page.getByText("twelve-pages", { exact: true })).toBeVisible();

    await tabTo(page, page.getByRole("button", { name: "Remove from Shelf", exact: true }), {
      max: 60,
    });
    await page.keyboard.press("Enter");
    await expect(page.getByText("twelve-pages", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Your Shelf is empty", { exact: true })).toBeVisible();
  });
});
