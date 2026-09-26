import type { Locator, Page } from "@playwright/test";
import {
  expectFocusWithin,
  expectTabContained,
  pressUntilFocused,
  tabTo,
} from "../support/keyboard";
import { readLibraryBytes, readStorageValue, countBackups } from "../support/storage";
import { SEED_BOOK } from "../support/seed/names";
import { expect, test } from "../support/test";

// The Tutorial (issue #215, ADR 0008/0009): the first-launch offer, a full
// keyboard run, Esc skips, the desktop shortcut, the Settings launch points,
// a reload mid-run, and the Tutorial Library's isolation from the author's
// Library — all by keyboard alone. Every Settings launch and the reload case
// compare the author's IndexedDB bytes before and after.

const CARD = "[data-tutorial-card]";
const BOUNDARY = "[data-tutorial-boundary]";
const READING_POSITION_KEY = "maibuk-reading-position";
const OFFER = "Take the Tutorial?";

function card(page: Page): Locator {
  return page.locator(CARD);
}

function sectionRow(page: Page, name: string): Locator {
  return page
    .getByRole("listbox", { name: "Tutorial sections" })
    .getByRole("option", { name: new RegExp(`^${name} ·`) });
}

/** Opens Settings and returns its Tutorial controls, reached by Tab alone. */
async function openSettingsTutorial(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  const startAll = page.getByRole("button", { name: "Start from the beginning" });
  await tabTo(page, startAll, { max: 60 });
  return startAll;
}

/**
 * Walks the run with Enter alone, asserting on every step that the card's
 * advance button holds focus, that the app outside the card is inert, and
 * that the card is not inside that inert region. Ends by pressing Finish.
 */
async function walkTutorial(page: Page): Promise<number> {
  let steps = 0;
  await card(page).waitFor({ state: "visible", timeout: 20_000 });
  for (;;) {
    await expect(card(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(BOUNDARY)).toHaveAttribute("inert", "");
    await expect(page.locator(`${BOUNDARY} ${CARD}`)).toHaveCount(0);
    const before = await card(page).innerText();
    const finish = card(page).getByRole("button", { name: "Finish" });
    const next = card(page).getByRole("button", { name: "Next" });
    const isLast = (await finish.count()) > 0;
    const advance = isLast ? finish : next;
    await expect(advance).toBeFocused();

    await page.keyboard.press("Enter");
    steps += 1;
    if (isLast) break;

    // The next card may carry the same section or a new screen; wait for the
    // visible step to actually change before moving on.
    await expect
      .poll(
        async () => {
          const nextCard = card(page);
          if ((await nextCard.count()) === 0) return before;
          return nextCard.innerText();
        },
        { timeout: 20_000 }
      )
      .not.toBe(before);
  }
  return steps;
}

/** Tabs into the section list and arrow-keys to a row, as a keyboard author would. */
async function startSection(page: Page, name: string) {
  const list = page.getByRole("listbox", { name: "Tutorial sections" });
  await tabTo(page, list.getByRole("option").first(), { max: 10 });
  const row = sectionRow(page, name);
  await pressUntilFocused(page, "ArrowDown", row, { max: 10 });
  await page.keyboard.press("Enter");
}

test.describe("Tutorial offer @wf:tutorial-offer", () => {
  test.use({ tutorialProgress: "clean" });

  test("an empty Library is offered the Tutorial, which takes focus and starts by keyboard", async ({
    page,
  }) => {
    await page.goto("/");
    const offer = page.getByRole("dialog", { name: OFFER });
    await expect(offer).toBeVisible({ timeout: 15_000 });
    await expect(offer).toContainText("5 minutes");
    await expectFocusWithin(offer);
    await expectTabContained(page, offer);

    await tabTo(page, offer.getByRole("button", { name: "Start", exact: true }));
    await page.keyboard.press("Enter");

    await expect(card(page)).toBeVisible({ timeout: 20_000 });
    await expect(card(page).getByRole("button", { name: "Next" })).toBeFocused();
  });

  test("Not now dismisses the offer for good and says where to start it again", async ({
    page,
  }) => {
    await page.goto("/");
    const offer = page.getByRole("dialog", { name: OFFER });
    await expect(offer).toBeVisible({ timeout: 15_000 });

    await tabTo(page, offer.getByRole("button", { name: "Not now" }));
    await page.keyboard.press("Enter");

    await expect(offer).toBeHidden();
    await expect(
      page.getByText("You can start the Tutorial again from Settings → Tutorial", { exact: false })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeFocused();
  });

  test("a dismissed offer is not shown again after a reload", async ({ page }) => {
    await page.goto("/");
    const offer = page.getByRole("dialog", { name: OFFER });
    await expect(offer).toBeVisible({ timeout: 15_000 });
    await tabTo(page, offer.getByRole("button", { name: "Not now" }));
    await page.keyboard.press("Enter");
    await expect(offer).toBeHidden();

    await page.reload();

    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
    await expect(page.getByRole("dialog", { name: OFFER })).toHaveCount(0);
  });
});

test.describe("Tutorial full run @wf:tutorial-full-run", () => {
  test.use({ tutorialProgress: "clean" });

  test("Enter and Space walk every step from the offer to Finish, then the author is back", async ({
    page,
  }) => {
    await page.goto("/");
    const offer = page.getByRole("dialog", { name: OFFER });
    await expect(offer).toBeVisible({ timeout: 15_000 });
    await tabTo(page, offer.getByRole("button", { name: "Start", exact: true }));
    await page.keyboard.press("Enter");

    const firstStep = card(page);
    await expect(firstStep).toBeVisible({ timeout: 20_000 });
    await expect(firstStep).toHaveAccessibleName("Your Books");
    await expect(firstStep.getByRole("button", { name: "Next" })).toBeFocused();

    // Space advances from the second step on, proving the card's own button.
    await page.keyboard.press("Space");
    await expect(card(page).getByRole("button", { name: "Next" })).toBeFocused();

    // One step was walked with Space above; walkTutorial carries the rest.
    const rest = await walkTutorial(page);
    expect(rest + 1).toBe(47);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeFocused();
    await expect(card(page)).toHaveCount(0);
  });
});

test.describe("Tutorial skip @wf:tutorial-skip-esc @sc:tutorial.skip", () => {
  test("Esc at any step skips, returns to the author's Library, and restores focus", async ({
    page,
  }) => {
    const startAll = await openSettingsTutorial(page);
    await page.keyboard.press("Enter");
    await card(page).waitFor({ state: "visible", timeout: 20_000 });
    await page.keyboard.press("Enter");

    await page.keyboard.press("Escape");

    await expect(card(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings$/);
    await expect(startAll).toBeFocused();
    await expect(
      page.getByText("You can start the Tutorial again from Settings → Tutorial", { exact: false })
    ).toBeVisible();
    // The author's (empty) Library is back: no sample content remains.
    await expect(page.getByRole("row", { name: "The Lighthouse Keeper" })).toHaveCount(0);
  });
});

test.describe("Tutorial shortcut @wf:tutorial-shortcut @sc:global.startTutorial", () => {
  test.use({ library: "oneBookThreeChapters" });

  test.fail(
    "Mod+Shift+T starts the Tutorial",
    {
      annotation: {
        type: "issue",
        description: "https://github.com/M4ss1ck/maibuk/issues/221",
      },
    },
    async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();

      await page.keyboard.press("ControlOrMeta+Shift+T");

      await expect(card(page)).toBeVisible({ timeout: 3_000 });
    }
  );
});

test.describe("Tutorial from Settings @wf:tutorial-settings-start-all", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("Start from the beginning runs the whole Tutorial and leaves the Library byte-identical", async ({
    page,
  }) => {
    const startAll = await openSettingsTutorial(page);
    const before = await readLibraryBytes(page);

    await page.keyboard.press("Enter");
    const steps = await walkTutorial(page);

    await expect(page).toHaveURL(/\/settings$/);
    await expect(startAll).toBeFocused();
    expect(steps).toBe(47);
    expect(await readLibraryBytes(page)).toBe(before);

    // Persisted: every section reads Done after a reload.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    const rows = page.getByRole("listbox", { name: "Tutorial sections" }).getByRole("option");
    await expect(rows).toHaveCount(8);
    for (const row of await rows.all()) {
      await expect(row).toContainText("Done");
    }
  });
});

test.describe("Tutorial single section @wf:tutorial-settings-section", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("one section runs alone, is marked Done, and stays Done after a reload", async ({
    page,
  }) => {
    await openSettingsTutorial(page);
    const before = await readLibraryBytes(page);

    await startSection(page, "Cover Designer");
    await card(page).waitFor({ state: "visible", timeout: 20_000 });
    await expect(card(page)).toHaveAccessibleName("Cover Templates");
    await expect(card(page)).toContainText("Step 1 of 3");

    const steps = await walkTutorial(page);
    expect(steps).toBe(3);

    await expect(page).toHaveURL(/\/settings$/);
    await expect(sectionRow(page, "Cover Designer")).toContainText("Done");
    await expect(sectionRow(page, "Books Gallery")).not.toContainText("Done");
    expect(await readLibraryBytes(page)).toBe(before);

    await page.reload();
    await expect(sectionRow(page, "Cover Designer")).toContainText("Done");
    await expect(sectionRow(page, "Books Gallery")).not.toContainText("Done");
  });
});

test.describe("Tutorial section Esc @wf:tutorial-settings-esc", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("Esc mid-run returns to Settings with focus on the launching row, section not Done", async ({
    page,
  }) => {
    await openSettingsTutorial(page);
    const before = await readLibraryBytes(page);

    await startSection(page, "Canvas Gallery");
    await card(page).waitFor({ state: "visible", timeout: 20_000 });
    await expect(card(page)).toHaveAccessibleName("Canvases");
    await page.keyboard.press("Enter");
    await expect(card(page)).toHaveAccessibleName("New Canvas");

    await page.keyboard.press("Escape");

    await expect(card(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings$/);
    await expect(sectionRow(page, "Canvas Gallery")).toBeFocused();
    await expect(sectionRow(page, "Canvas Gallery")).not.toContainText("Done");
    expect(await readLibraryBytes(page)).toBe(before);
  });
});

test.describe("Tutorial restart a done section @wf:tutorial-settings-restart-done", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("a Done section runs again from its focused row", async ({ page }) => {
    await openSettingsTutorial(page);
    const before = await readLibraryBytes(page);

    await startSection(page, "Cover Designer");
    await walkTutorial(page);
    const row = sectionRow(page, "Cover Designer");
    await expect(row).toContainText("Done");
    await expect(row).toBeFocused();

    await page.keyboard.press("Enter");
    await card(page).waitFor({ state: "visible", timeout: 20_000 });
    await expect(card(page)).toHaveAccessibleName("Cover Templates");
    await expect(card(page)).toContainText("Step 1 of 3");

    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
    await expect(row).toContainText("Done");
    expect(await readLibraryBytes(page)).toBe(before);
  });
});

test.describe("Tutorial reload mid-run @wf:tutorial-reload-mid-run", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("reloading during a run returns to the author's Library, bytes unchanged", async ({
    page,
  }) => {
    await openSettingsTutorial(page);
    const before = await readLibraryBytes(page);
    await startSection(page, "Books Gallery");
    await card(page).waitFor({ state: "visible", timeout: 20_000 });
    await expect(card(page)).toHaveAccessibleName("Your Books");
    await page.keyboard.press("Enter");
    await expect(card(page)).toHaveAccessibleName("New Book");

    await page.reload();

    await expect(card(page)).toHaveCount(0);
    // The author's own Library boots, not the sample one. Wait for the shell,
    // then go Home with the keyboard.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
    const seeded = page.getByRole("row", { name: SEED_BOOK.title });
    await expect(seeded).toContainText(SEED_BOOK.authorName);
    expect(await readLibraryBytes(page)).toBe(before);
  });
});

test.describe("Tutorial isolation @wf:tutorial-isolation", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("a run records no Backup, metric, or Reading Position, and the Library is unchanged", async ({
    page,
  }) => {
    await openSettingsTutorial(page);
    // The launch daily Backup has settled; the run must add none.
    await expect.poll(() => countBackups(page), { timeout: 15_000 }).toBeGreaterThan(0);
    const backupsBefore = await countBackups(page);
    const bytesBefore = await readLibraryBytes(page);

    await startSection(page, "Book Editor");
    await card(page).waitFor({ state: "visible", timeout: 20_000 });
    const steps = await walkTutorial(page);
    expect(steps).toBe(11);

    expect(await readLibraryBytes(page)).toBe(bytesBefore);
    expect(await countBackups(page)).toBe(backupsBefore);
    // Reading Position never stores a sample place.
    expect((await readStorageValue(page, READING_POSITION_KEY)) ?? "").not.toContain("tutorial-");
  });
});
