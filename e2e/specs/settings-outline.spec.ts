// Settings outline: the search field and tree of sections beside the
// Settings sections, and the section menu bar that replaces it on a narrow
// panel. Driven by keyboard alone.

import type { Page } from "@playwright/test";
import { expectFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { capture } from "../support/capture";
import {
  recordOutlineFrames,
  recordOutlineOverflow,
  recordOutlineSections,
  type OutlineFrame,
  type OutlineMotionFrame,
  type OutlineSectionFrame,
} from "../support/settings-outline";
import { expect, test } from "../support/test";

test.use({ library: "oneBookThreeChapters" });

async function openSettings(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

/** Presses per direction that carry 1280x600 from the first section to the last. */
const TRAVERSAL = 14;

// How far a header has to travel in a series before its worst single frame is
// worth judging: a fold of one section's rows is a few hundred pixels, and a
// header that moves a pixel has nothing to jump over. A header that travels
// real distance must not spend a third of it in one frame: a fold eases over
// about twenty, and a snap spends all of it at once.
const TRAVELLED_PX = 60;
const CONTINUOUS_SHARE = 3;

// A whole section change is two 320 ms phases. Sampling this many frames
// after each press lets it finish before the next press retargets it, so
// the section whose rows overflow the outline really grows to full height.
const FULL_CHANGE_FRAMES = 45;

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

  // A section change runs one phase at a time: the old section's rows fold away
  // while its header is still the highlighted one, then the new section's rows
  // grow into the space they left. An overlapping model would show two sections'
  // rows at once, which is what the sampled frames below rule out.
  test("A section change folds the old rows away before the new ones appear", async ({ page }) => {
    await openSettings(page);
    await tabTo(page, entry(page, "Appearance"), { backwards: true, max: 4 });
    await pressUntilFocused(page, "ArrowDown", entry(page, "General"));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "General", level: 2 })).toBeFocused();
    // Let the jump settle so the one press moves the scroll spy once.
    await page.waitForTimeout(700);

    const frames = await recordOutlineFrames(page, () => page.keyboard.press("PageDown"), 1);
    expect(frames.length, "outline sampled per painted frame").toBeGreaterThan(30);
    const sectionsOf = (frame: OutlineMotionFrame) =>
      new Set(
        frame.rows
          .filter((row) => row.key.startsWith("row:"))
          .map((row) => row.key.slice("row:".length).split(":")[0])
      );
    expect(
      frames.filter((frame) => sectionsOf(frame).size > 1),
      `no frame may hold two sections' rows at once: ${JSON.stringify(
        frames.filter((frame) => sectionsOf(frame).size > 0).slice(0, 12)
      )}`
    ).toEqual([]);
    // The change really did reach a new section, and the old rows gave up their
    // space over frames: while the old section is still the highlighted one,
    // some of its rows are there at a height between nothing and full. A snap,
    // which removes them in one commit, can never show that.
    expect(new Set(frames.map((frame) => frame.current)).size).toBeGreaterThan(1);
    const folding = frames.filter((frame) => {
      const section = frame.current?.replace(/^section:/, "");
      return (
        section !== undefined &&
        frame.rows.some(
          (row) =>
            row.key.startsWith(`row:${section}:`) &&
            row.height > 1 &&
            row.height < row.settledHeight - 1
        )
      );
    });
    expect(
      folding,
      `the old rows folded away over frames: ${JSON.stringify(
        frames.map(
          (frame) =>
            `${frame.current}/${[...sectionsOf(frame)]}=${frame.rows
              .filter((row) => row.key.startsWith("row:"))
              .map((row) => row.height.toFixed(1))
              .join(",")}`
        )
      )}`
    ).not.toEqual([]);
    // And the new section's rows end at their natural size.
    const last = frames.at(-1)!;
    const lastSection = last.current?.replace(/^section:/, "") ?? "";
    const lastRows = last.rows.filter((row) => row.key.startsWith(`row:${lastSection}:`));
    expect(lastRows.length).toBeGreaterThan(0);
    expect(lastRows.every((row) => Math.abs(row.height - row.settledHeight) <= 1)).toBe(true);
  });

  // A change that arrives mid-phase cancels the motion and shows the current
  // section at once: what is left on screen is that section's rows, still.
  test("Fast scrolling shows the current section without leftover motion", async ({ page }) => {
    await openSettings(page);
    await tabTo(page, entry(page, "Appearance"), { backwards: true, max: 4 });
    await pressUntilFocused(page, "ArrowDown", entry(page, "General"));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "General", level: 2 })).toBeFocused();
    await page.waitForTimeout(700);

    const frames = await recordOutlineSections(page, () => page.keyboard.press("PageDown"), 6);
    expect(frames.length, "outline sampled per painted frame").toBeGreaterThan(30);
    expect(
      new Set(frames.map((frame) => frame.current)).size,
      "the presses moved the scroll spy"
    ).toBeGreaterThan(1);
    // An interrupted change leaves no trace either: two sections' rows are never
    // both on screen, because the new section's rows arrive with the snap that
    // cancels the old ones.
    expect(
      frames.filter((frame) => frame.sections.length > 1),
      `no frame may hold two sections' rows at once: ${JSON.stringify(frames.slice(-8))}`
    ).toEqual([]);

    // The series converges: the outline comes to rest and stays there, holding the
    // current section's rows with nothing running. A change may still animate
    // when the spy moves on its own; what may not survive it is leftover motion
    // stacked on motion, which is what left rows flickering before.
    const atRest = (frame: OutlineSectionFrame) =>
      frame.animating === 0 && frame.sections.length === 1 && frame.sections[0] === frame.current;
    let lastMoving = -1;
    for (let index = frames.length - 1; index >= 0; index--) {
      if (atRest(frames[index])) continue;
      lastMoving = index;
      break;
    }
    expect(lastMoving, "the series animated at all").toBeGreaterThanOrEqual(0);
    const settled = frames.slice(lastMoving + 1);
    expect(
      settled.length,
      `the outline came to rest within 3 frames of its last change: ${JSON.stringify(frames.slice(-10))}`
    ).toBeGreaterThanOrEqual(3);
    expect(
      settled.filter((frame) => !atRest(frame)),
      `the outline stayed at rest: ${JSON.stringify(settled.slice(0, 6))}`
    ).toEqual([]);
  });

  // The motion moves the space a row takes, never the row's own content: the
  // label inside keeps its size on every frame, because the row clips it instead
  // of squeezing it and nothing is scaled to make room. The boxes' heights are
  // meant to change, so what is checked is the text.
  test("Outline rows never squash their label during a section change @wf:settings-outline", async ({
    page,
  }) => {
    const frames = await traverseOutline(page);

    const squashed: string[] = [];
    frames.forEach((frame, index) => {
      for (const row of frame.rows) {
        if (!row.key.startsWith("row:") || row.textHeight <= 0) continue;
        // Both axes: a scale on the row would shrink the label in width and
        // height, a squeezed box would only flatten it.
        if (
          Math.abs(row.textHeight - row.settledTextHeight) > 0.5 ||
          Math.abs(row.textWidth - row.settledTextWidth) > 0.5
        )
          squashed.push(
            `f${index} ${row.key} label=${row.textWidth.toFixed(2)}x${row.textHeight.toFixed(2)} settled=${row.settledTextWidth.toFixed(2)}x${row.settledTextHeight.toFixed(2)}`
          );
      }
    });
    expect(
      squashed.slice(0, 8),
      `${squashed.length} frames where a label was not its own size: ${JSON.stringify(
        squashed.slice(0, 8)
      )}`
    ).toEqual([]);
  });

  // The only thing the section-change motion may move is a row's height. A scale
  // or a fade would stretch the label or leave a hole where the rows should be.
  test("The section change animates nothing but row heights @wf:settings-outline", async ({
    page,
  }) => {
    const frames = await traverseOutline(page);

    const animated = new Set(
      frames.flatMap((frame) => frame.rows.flatMap((row) => row.properties))
    );
    expect(
      [...animated].sort(),
      `the motion animated more than a row's height: ${JSON.stringify([...animated])}`
    ).toEqual(["height"]);
    // And no row is left reserving space nothing painted in: a row whose box is
    // more than a pixel tall is showing part of its label.
    const holes = frames.flatMap((frame, index) =>
      frame.rows
        .filter((row) => row.height > 1 && row.opacity <= 0.05)
        .map((row) => `f${index} ${row.key} reserves ${row.height.toFixed(1)}px of nothing`)
    );
    expect(
      holes.slice(0, 8),
      `${holes.length} frames left an empty hole: ${JSON.stringify(holes.slice(0, 8))}`
    ).toEqual([]);
  });

  // Rows that each shrink at once each clip their own label and show stacked
  // slivers of text; one edge means at most one row is cut. A row key is
  // `row:<section>:<id>`, so the section is the middle part.
  test("A section folds and grows behind one edge @wf:settings-outline", async ({ page }) => {
    const frames = await traverseOutline(page);

    const shredded: string[] = [];
    frames.forEach((frame, index) => {
      const bySection = new Map<string, string[]>();
      for (const row of frame.rows) {
        if (!row.key.startsWith("row:")) continue;
        const section = row.key.slice("row:".length).split(":")[0];
        if (row.height <= 1 || row.height >= row.settledHeight - 1) continue;
        const keys = bySection.get(section) ?? [];
        keys.push(row.key);
        bySection.set(section, keys);
      }
      for (const [section, keys] of bySection) {
        if (keys.length > 1) shredded.push(`f${index} ${section}: ${keys.join(",")}`);
      }
    });
    expect(
      shredded.slice(0, 8),
      `${shredded.length} frames cut more than one row of a section: ${JSON.stringify(
        shredded.slice(0, 8)
      )}`
    ).toEqual([]);
  });

  // A target that arrives while the outline is still moving must not turn into a
  // jump. The fold keeps the space it has and the headers below it travel with
  // it, so no header crosses a whole section's worth of rows in one frame, and
  // the series converges on one section at rest.
  test("Rapid retargeting moves the outline continuously @wf:settings-outline", async ({
    page,
  }) => {
    await openSettings(page);
    await tabTo(page, entry(page, "Appearance"), { backwards: true, max: 4 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Appearance", level: 2 })).toBeFocused();
    await page.waitForTimeout(700);

    // Six presses, none of them waiting: every one arrives while the change
    // before it is still moving, which is what retargets a phase.
    const frames = await recordOutlineFrames(page, () => page.keyboard.press("PageDown"), 6);
    expect(frames.length, "outline sampled per painted frame").toBeGreaterThan(30);
    expect(
      new Set(frames.map((frame) => frame.current)).size,
      "the presses moved the scroll spy"
    ).toBeGreaterThan(1);

    // Each header's offset inside the box, frame by frame. The box's own scroll
    // does not move these, so what is left is the fold travelling through them.
    const offsets = new Map<string, number[]>();
    for (const frame of frames)
      for (const row of frame.rows) {
        if (!row.key.startsWith("section:")) continue;
        const seen = offsets.get(row.key) ?? [];
        seen.push(row.layoutTop);
        offsets.set(row.key, seen);
      }
    const jumps: string[] = [];
    for (const [key, tops] of offsets) {
      const deltas = tops.slice(1).map((top, index) => Math.abs(top - tops[index]));
      const travelled = deltas.reduce((total, delta) => total + delta, 0);
      // A header that barely moves has nothing to jump over; one that travels
      // real distance must do it over more than a frame or two.
      if (travelled < TRAVELLED_PX) continue;
      const worst = Math.max(...deltas);
      if (worst > travelled / CONTINUOUS_SHARE)
        jumps.push(
          `${key} moved ${worst.toFixed(1)}px of the ${travelled.toFixed(1)}px it travelled in one frame`
        );
    }
    expect(
      jumps.slice(0, 8),
      `${jumps.length} headers jumped instead of travelling: ${JSON.stringify(jumps.slice(0, 8))}`
    ).toEqual([]);

    // And the series converges: the last change runs to the end rather than
    // being cut short, and what is left is one section at rest.
    const moving = (frame: OutlineMotionFrame) =>
      frame.rows.some((row) => row.properties.length > 0) ||
      frame.rows.some((row) => row.height < row.settledHeight - 1);
    let lastMoving = -1;
    for (let index = frames.length - 1; index >= 0; index--) {
      if (!moving(frames[index])) continue;
      lastMoving = index;
      break;
    }
    const settledFrames = frames.length - 1 - lastMoving;
    expect(
      settledFrames,
      `the outline came to rest within 4 frames of its last motion: ${JSON.stringify(
        frames.slice(-8).map((frame) => `${frame.current}/${moving(frame)}`)
      )}`
    ).toBeGreaterThanOrEqual(4);
    const lastSection = frames.at(-1)?.current?.replace(/^section:/, "") ?? "";
    expect(
      frames
        .at(-1)!
        .rows.some((row) => row.key.startsWith(`row:${lastSection}:`) && row.height > 1),
      "the section the outline came to rest on is the one whose rows it holds"
    ).toBe(true);
  });

  // (2) The highlight follows the rows, not the spy: once a section is named
  // current its own rows must be on screen, so the outline is never left
  // highlighted with an empty gap where its rows belong.
  test("The highlighted section is never shown without its rows @wf:settings-outline", async ({
    page,
  }) => {
    const frames = await traverseOutline(page);

    const rowSections = new Set(
      frames
        .flatMap((frame) => frame.rows)
        .filter((row) => row.key.startsWith("row:"))
        .map((row) => row.key.slice("row:".length).split(":")[0])
    );
    let longest = 0;
    let run = 0;
    let previous: string | null = null;
    for (const frame of frames) {
      const section = frame.current?.replace(/^section:/, "") ?? null;
      // A target that arrives just as a fold ends names one section for a frame
      // and moves on; what must hold is that the section the outline settles on
      // as current shows its rows within the handoff below, not that a chain of
      // retargets does.
      if (section !== previous) {
        run = 0;
        previous = section;
      }
      if (!section || !rowSections.has(section)) {
        run = 0;
        continue;
      }
      // A row is on screen while it occupies any space at all: a row half way
      // through folding away is still there, and the section it belongs to is
      // the one the outline has named current.
      const visible = frame.rows.some(
        (row) => row.key.startsWith(`row:${section}:`) && row.height > 1
      );
      run = visible ? 0 : run + 1;
      longest = Math.max(longest, run);
    }
    // The handoff between phases costs up to three frames: the fold's last
    // sub-pixel frame, the frame its finish is delivered in, and the commit
    // that names the next section, whose rows enter at 0px and grow from the
    // next frame. A stall the length of a phase is ten frames or more.
    expect(
      longest,
      `the current section showed no visible row for ${longest} frames: ${JSON.stringify(
        frames.map(
          (frame) =>
            `${frame.current}/${frame.rows
              .filter((row) => row.key.startsWith("row:") && row.height > 1)
              .map((row) => row.key)
              .join("+")}`
        )
      )}`
    ).toBeLessThanOrEqual(3);
  });

  // Nothing the section-change motion does may put one entry's box on top of
  // another: the header that FLIP-slides to its new top must never travel over
  // the rows underneath it.
  test("Outline rows never draw over each other @wf:settings-outline", async ({ page }) => {
    const frames = await traverseOutline(page);

    const overlaps: string[] = [];
    frames.forEach((frame, index) => {
      // Only an entry that occupies space can be seen covering another.
      const visible = frame.rows.filter((row) => row.height > 1);
      for (let i = 0; i < visible.length; i++)
        for (let j = i + 1; j < visible.length; j++) {
          const overlap =
            Math.min(visible[i].bottom, visible[j].bottom) -
            Math.max(visible[i].top, visible[j].top);
          if (overlap > 2)
            overlaps.push(
              `f${index} ${visible[i].key} over ${visible[j].key} by ${overlap.toFixed(1)}px`
            );
        }
    });
    expect(
      overlaps.slice(0, 12),
      `${overlaps.length} overlapping frames, first: ${JSON.stringify(overlaps.slice(0, 12))}`
    ).toEqual([]);
  });

  // A full keyboard traversal of every section and back, sampled per painted
  // frame. The tests above assert on the same series. Each press waits long
  // enough that a section change is most of the way through before the next
  // arrives, so the series holds folds, grows and reversals alike.
  async function traverseOutline(page: Page): Promise<OutlineMotionFrame[]> {
    await openSettings(page);
    await tabTo(page, entry(page, "Appearance"), { backwards: true, max: 4 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Appearance", level: 2 })).toBeFocused();
    // Let the initial jump settle so the first press moves the scroll spy once.
    await page.waitForTimeout(700);
    let index = 0;
    return recordOutlineFrames(
      page,
      async () => {
        await page.keyboard.press(index++ < TRAVERSAL ? "PageDown" : "PageUp");
        await page.waitForTimeout(260);
      },
      TRAVERSAL * 2
    );
  }

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
        ...(await recordOutlineOverflow(
          page,
          () => page.keyboard.press("PageDown"),
          TRAVERSAL,
          FULL_CHANGE_FRAMES
        )),
        ...(await recordOutlineOverflow(
          page,
          () => page.keyboard.press("PageUp"),
          TRAVERSAL,
          FULL_CHANGE_FRAMES
        )),
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
