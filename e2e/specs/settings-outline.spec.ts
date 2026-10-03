// Settings outline: the search field and tree of sections beside the
// Settings sections, and the section menu bar that replaces it on a narrow
// panel. Driven by keyboard alone.

import type { Page } from "@playwright/test";
import { expectFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { capture } from "../support/capture";
import { recordOutlineOverflow, type OutlineFrame } from "../support/settings-outline";
import { expect, test } from "../support/test";

test.use({ library: "oneBookThreeChapters" });

async function openSettings(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

/** Presses per direction that carry 1280x600 from the first section to the last. */
const TRAVERSAL = 14;

const outline = (page: Page) => page.getByRole("navigation", { name: "Settings sections" });
const tree = (page: Page) => outline(page).getByRole("treegrid", { name: "Settings sections" });
const search = (page: Page) => outline(page).getByRole("searchbox", { name: "Search settings" });
const entry = (page: Page, name: string) =>
  tree(page).getByRole("row", { name: new RegExp(`^${name}(, current)?$`) });

test.describe("Settings outline @wf:settings-outline", () => {
  test("arrows move through the sections and Enter jumps to one", async ({ page }) => {
    await openSettings(page);
    await expect(outline(page)).toBeVisible();
    await expect(entry(page, "Appearance")).toHaveAccessibleName("Appearance, current");
    await capture(page, "settings-outline");

    // The outline comes last in the page: Shift+Tab from the top reaches it.
    await tabTo(page, entry(page, "Appearance"), { backwards: true, max: 4 });
    // The current section is open: ArrowDown walks through its rows first.
    await page.keyboard.press("ArrowDown");
    await expect(tree(page).getByRole("row", { name: "Theme" })).toBeFocused();
    await pressUntilFocused(page, "ArrowDown", entry(page, "General"));
    await pressUntilFocused(page, "ArrowDown", entry(page, "Editor"));

    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Editor", level: 2 })).toBeFocused();
    await expect(entry(page, "Editor")).toHaveAccessibleName("Editor, current");
    // The current section lists its rows.
    await expect(tree(page).getByRole("row", { name: "Auto-close pairs" })).toBeVisible();
    await capture(page, "settings-outline-editor");
  });

  test("Search narrows to matching rows; Escape clears", async ({ page }) => {
    await openSettings(page);
    await tabTo(page, search(page), { backwards: true, max: 6 });
    await expect(search(page)).toHaveAttribute("placeholder", "Search");
    await page.keyboard.type("markdown");

    await expect(tree(page).getByRole("row")).toHaveText([
      "Editor",
      "Prompt to convert pasted Markdown",
    ]);
    await capture(page, "settings-outline-search", { around: [outline(page)] });

    await page.keyboard.type("zzz");
    await expect(outline(page).getByText("No matches")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(search(page)).toHaveValue("");
    await expect(entry(page, "About")).toBeVisible();
  });

  test("Enter on a row focuses its control", async ({ page }) => {
    await openSettings(page);
    await tabTo(page, search(page), { backwards: true, max: 6 });
    await page.keyboard.type("auto-save");
    await page.keyboard.press("Tab");
    await pressUntilFocused(page, "ArrowDown", tree(page).getByRole("row", { name: "Auto-save" }));

    await page.keyboard.press("Enter");
    await expect(page.getByRole("switch", { name: "Auto-save" })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByRole("switch", { name: "Auto-save" })).not.toBeChecked();
  });

  // The scrollbar repro needs the motion the outline normally animates with, so
  // it must not be suppressed by the OS preference the rest of the suite reads.
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("Scrolling by keyboard never overflows the outline @wf:settings-outline", async ({
    page,
  }) => {
    await openSettings(page);
    await expect(outline(page)).toBeVisible();

    // Enter on a section focuses its heading in main; PageDown from there
    // scrolls the same content a wheel would, moving the scroll spy so the
    // outline re-expands the arriving section mid-motion.
    await tabTo(page, entry(page, "Appearance"), { backwards: true, max: 4 });
    await pressUntilFocused(page, "ArrowDown", entry(page, "General"));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "General", level: 2 })).toBeFocused();
    // Let the initial jump settle so PageDown releases its selection pin.
    await page.waitForTimeout(700);

    const frames = await recordOutlineOverflow(page, () => page.keyboard.press("PageDown"));
    expect(frames.length, "outline scroll box sampled while scrolling").toBeGreaterThan(1);
    expect(
      new Set(frames.map((f) => f.mainScrollTop)).size,
      "PageDown moved the Settings scroller"
    ).toBeGreaterThan(1);
    await capture(page, "settings-outline-keyboard-scroll");

    // At 1280x800 the whole tree fits, so no painted frame of its motion may
    // report content past the box: a transient overflow is the scrollbar flash
    // the entry slide and the fading ghosts used to cause. The two maxima can
    // land on different frames, so each is picked on its own axis.
    const worstOf = (axis: (f: OutlineFrame) => number): OutlineFrame =>
      frames.reduce((a, b) => (axis(b) > axis(a) ? b : a));
    const worstVertical = worstOf((f) => f.vOverflow);
    const worstHorizontal = worstOf((f) => f.hOverflow);
    expect(
      worstVertical.vOverflow,
      `no vertical overflow while the outline moves: ${JSON.stringify(worstVertical)}`
    ).toBe(0);
    expect(
      worstHorizontal.hOverflow,
      `no horizontal overflow while the outline moves: ${JSON.stringify(worstHorizontal)}`
    ).toBeLessThanOrEqual(0);
  });

  // At 1280x600 the outline really does overflow: expanding Editor lists more
  // rows than the box is tall, so its scrollbar legitimately comes and goes as
  // the current section changes. That overflow is the point of this test, not
  // a fault; what must not change is the width the box keeps for its entries.
  test.describe("short window", () => {
    test.use({ viewport: { width: 1280, height: 600 } });

    test("Keyboard scrolling keeps the scrollbar width steady at 1280x600", async ({ page }) => {
      await openSettings(page);
      await expect(outline(page)).toBeVisible();

      await tabTo(page, entry(page, "Appearance"), { backwards: true, max: 4 });
      await pressUntilFocused(page, "ArrowDown", entry(page, "General"));
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "General", level: 2 })).toBeFocused();
      await page.waitForTimeout(700);

      // The whole traversal, down through every section to the last one and back
      // to the first, so the series covers both the sections that fit and the one
      // that overflows rather than stopping at the first of each.
      const frames = [
        ...(await recordOutlineOverflow(page, () => page.keyboard.press("PageDown"), TRAVERSAL)),
        ...(await recordOutlineOverflow(page, () => page.keyboard.press("PageUp"), TRAVERSAL)),
      ];
      expect(frames.length, "outline scroll box sampled while scrolling").toBeGreaterThan(1);
      expect(
        new Set(frames.map((f) => f.mainScrollTop)).size,
        "PageDown and PageUp moved the Settings scroller"
      ).toBeGreaterThan(1);
      await capture(page, "settings-outline-scrollbar-width");

      // Both states have to be in the series, or the widths below prove nothing:
      // a box that always fits never shows what its scrollbar costs.
      const fitted = frames.filter((f) => f.vOverflow <= 0);
      const overflowing = frames.filter((f) => f.vOverflow > 0);
      expect(
        overflowing.map((f) => `${f.sectionLabel}=${f.vOverflow}`),
        "sections whose expanded rows really overflow the outline"
      ).not.toEqual([]);
      expect(fitted.length, "frames where the whole outline fits").toBeGreaterThan(0);

      // The box itself never resizes, and the space it gives up for a scrollbar
      // is the same in both states: the entries stay where they are while the
      // bar appears and disappears.
      const widths = [...new Set(frames.map((f) => f.clientWidth))].sort((a, b) => a - b);
      expect(
        widths,
        `outline scroll box client width per painted frame: ${JSON.stringify(
          frames.map((f) => `${f.sectionLabel ?? "-"}:${f.clientWidth}/${f.gutterWidth}`)
        )}`
      ).toHaveLength(1);
      const gutters = [...new Set(frames.map((f) => f.gutterWidth))].sort((a, b) => a - b);
      expect(
        gutters,
        "the reserved scrollbar gutter must be the same whether or not the bar shows"
      ).toHaveLength(1);
    });
  });
});

test.describe("Settings section menu @wf:settings-outline", () => {
  test.use({ viewport: { width: 700, height: 900 } });

  test("Narrow panel: section menu, Escape returns focus to its button", async ({ page }) => {
    await openSettings(page);
    await expect(outline(page)).toBeHidden();
    const trigger = page.getByRole("button", { name: "Jump to section, current: Appearance" });

    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expectFocusWithin(menu);
    await expect(menu.getByRole("menuitem", { name: "Appearance" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "General" })).toBeFocused();
    await capture(page, "settings-section-menu");

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press("Enter");
    await pressUntilFocused(page, "ArrowDown", menu.getByRole("menuitem", { name: "Sync" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Sync", level: 2 })).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Jump to section, current: Sync" })
    ).toBeVisible();
  });
});
