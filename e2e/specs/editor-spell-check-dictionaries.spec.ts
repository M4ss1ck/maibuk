import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { expectFocusWithin, isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

// Spell Check Dictionaries (issue #708): a language outside English and
// Spanish gets its dictionary from Settings or from the Spell Check menu, and
// never marks anything until the pinned files are on this device.
//
// The suite is hermetic, so this spec alone lets the pinned wooorm files
// through with route.fetch(), and tampers with them in the failure test.
test.use({ library: "oneBookThreeChapters" });

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Toolbar" });
const chapterList = (page: Page) => page.getByRole("complementary", { name: "Chapter list" });
const spellCheckLanguage = (page: Page) =>
  toolbar(page).getByRole("button", { name: /^Spell check language/ });

async function openEditor(page: Page) {
  await seedSettings(page, { toolbarExpanded: true });
  await page.goto("/");
  await page.getByRole("grid", { name: "Books" }).getByRole("row").waitFor();
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(editorText(page)).toContainText("The storm came in from the west without warning.");
  await expect(editorText(page)).toBeFocused();
}

/** Escape until focus rests in the Chapter list, from the text or the toolbar. */
async function leaveToChapterList(page: Page) {
  for (let i = 0; i < 6; i++) {
    if (await isFocusWithin(chapterList(page))) return;
    await page.keyboard.press("Escape");
  }
  await expectFocusWithin(chapterList(page));
}

/** Tabs from the Chapter list until focus is inside the toolbar, then arrows to a control. */
async function focusToolbarControl(page: Page, target: Locator) {
  await leaveToChapterList(page);
  for (let i = 0; i < 40; i++) {
    if (await isFocusWithin(toolbar(page))) break;
    await page.keyboard.press("Tab");
  }
  if (!(await isFocusWithin(toolbar(page)))) throw new Error("Tab never reached the toolbar");
  await pressUntilFocused(page, "ArrowRight", target, { max: 120 });
}

async function pickItalian(page: Page) {
  const trigger = spellCheckLanguage(page);
  await focusToolbarControl(page, trigger);
  await page.keyboard.press("Enter");
  const picker = page.getByRole("menu", { name: /Spell check language/ });
  await pressUntilFocused(
    page,
    "ArrowDown",
    picker.getByRole("menuitemradio", { name: /italiano/i }),
    { max: 30 }
  );
  await page.keyboard.press("Enter");
  await expect(picker).toBeHidden();
}

async function openDictionaryMenu(page: Page) {
  await focusToolbarControl(page, spellCheckLanguage(page));
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: /Spell check language/ });
  await expect(menu).toBeVisible();
  return menu;
}

/**
 * Replaces the Chapter text with `text`, ready for the debounced check. It
 * starts from the Chapter list and cycle-panes into the editor, so the menu,
 * toolbar, or a closed popover cannot leave focus somewhere unexpected.
 */
async function typeText(page: Page, text: string) {
  await leaveToChapterList(page);
  for (let i = 0; i < 6 && !(await isFocusWithin(editorText(page))); i++) {
    await page.keyboard.press("F6");
  }
  await expect(editorText(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
}

/**
 * Pass the pinned wooorm files through untouched. The suite's hermetic network
 * aborts every other origin, so this spec registers its own route and fetches
 * the real bytes. `tamperDic` flips the final byte of the .dic, keeping its
 * length and breaking only its checksum.
 */
async function passThroughDictionaries(page: Page, { tamperDic = false } = {}) {
  await page.route("https://raw.githubusercontent.com/wooorm/dictionaries/**", async (route) => {
    const response = await route.fetch();
    if (tamperDic && route.request().url().endsWith("/index.dic")) {
      const body = await response.body();
      body[body.length - 1] ^= 0xff;
      await route.fulfill({ response, body });
      return;
    }
    await route.fulfill({ response });
  });
}

test.describe("Spell Check Dictionaries @wf:editor-spell-check-dictionaries @sc:editor.downloadSpellCheckDictionary", () => {
  test("download marks, Remove unmarks, and the menu says when there is none", async ({ page }) => {
    await passThroughDictionaries(page);
    await openEditor(page);
    await pickItalian(page);

    // No dictionary yet: the menu says so and nothing is marked.
    let menu = await openDictionaryMenu(page);
    await expect(
      menu.getByRole("menuitemradio", { name: /^No dictionary for italiano$/i })
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitemradio", { name: /Download dictionary for italiano \(1 MB\)/i })
    ).toBeVisible();
    await capture(page, "spell-check-dictionary-menu", { around: [menu] });

    await typeText(page, "casa qqqxz");
    await page.waitForTimeout(900);
    await expect(editorText(page).locator(".spellcheck-error")).toHaveCount(0);

    // Download from the menu, then the installed dictionary marks the word.
    menu = await openDictionaryMenu(page);
    await pressUntilFocused(
      page,
      "ArrowDown",
      menu.getByRole("menuitemradio", { name: /Download dictionary for italiano/i }),
      { max: 30 }
    );
    await page.keyboard.press("Enter");

    const errors = editorText(page).locator(".spellcheck-error");
    await expect(errors).toHaveCount(1, { timeout: 20_000 });
    await expect(errors.first()).toHaveText("qqqxz");

    // Settings lists it as installed; Remove deletes it.
    await leaveToChapterList(page);
    await page.keyboard.press("g");
    await page.keyboard.press("s");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

    const outline = page.getByRole("navigation", { name: "Settings sections" });
    const search = outline.getByRole("searchbox", { name: "Search settings" });
    await tabTo(page, search, { max: 150 });
    await page.keyboard.type("spell check dictionaries");
    const tree = outline.getByRole("treegrid", { name: "Settings sections" });
    await page.keyboard.press("Tab");
    await pressUntilFocused(
      page,
      "ArrowDown",
      tree.getByRole("row", { name: "Spell Check dictionaries" })
    );
    await page.keyboard.press("Enter");

    const italianRow = page.getByRole("group", { name: /^italiano$/i });
    const remove = italianRow.getByRole("button", { name: "Remove" });
    await tabTo(page, remove, { max: 30 });
    await expect(remove).toBeFocused();
    await capture(page, "spell-check-dictionaries-settings", { around: [italianRow] });
    await page.keyboard.press("Enter");
    await expect(italianRow.getByRole("button", { name: "Download" })).toBeVisible();

    // Back in the editor nothing is marked and the state says there is none.
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page.getByRole("grid", { name: "Books" }).getByRole("row").first()).toBeVisible();
    await page.keyboard.press("1");
    await page.keyboard.press("Enter");
    await expect(editorText(page)).toContainText("casa qqqxz");
    await page.waitForTimeout(900);
    await expect(editorText(page).locator(".spellcheck-error")).toHaveCount(0);
    await expect(spellCheckLanguage(page)).toHaveAccessibleName(
      /Spell check language: Dictionary not downloaded/
    );
  });

  test("a tampered dictionary fails and installs nothing", async ({ page }) => {
    await passThroughDictionaries(page, { tamperDic: true });
    await openEditor(page);
    await pickItalian(page);
    await typeText(page, "casa qqqxz");

    const menu = await openDictionaryMenu(page);
    await pressUntilFocused(
      page,
      "ArrowDown",
      menu.getByRole("menuitemradio", { name: /Download dictionary for italiano/i }),
      { max: 30 }
    );
    await page.keyboard.press("Enter");

    // The menu closes on the action; reopening shows the failure and no install.
    await page.waitForTimeout(1200);
    await page.keyboard.press("Enter");
    const reopened = page.getByRole("menu", { name: /Spell check language/ });
    await expect(
      reopened.getByRole("menuitemradio", { name: "Download failed. Try again." })
    ).toBeVisible();
    await expect(
      reopened.getByRole("menuitemradio", { name: /^No dictionary for italiano$/i })
    ).toHaveCount(0);

    await typeText(page, "casa qqqxz");
    await page.waitForTimeout(900);
    await expect(editorText(page).locator(".spellcheck-error")).toHaveCount(0);
  });
});
