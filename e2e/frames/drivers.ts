// What each frame-rate scenario does (issue #372). The scenario list, seeds
// and repetitions are data in src/test/support/frames/scenarios.ts; this file
// performs them. Every driver reaches its screen the way the E2E specs do,
// by keyboard and registered Commands, then drives the measured interaction
// with the real input it is about: keys for typing, reordering and the
// palette; wheel and mouse drags for scrolling, panning, zooming and the
// sidebar edge, which are pointer gestures by nature.
//
// Repetitions run back to back on one page: `arrange` (outside the measured
// window) brings the screen back to where `measure` starts.

import { expect, type Locator, type Page } from "@playwright/test";
import { expectFocusWithin, isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { PERF_BOOK, PERF_CANVAS, PERF_MANY_CHAPTERS_BOOK } from "../support/seed/names";

export interface FrameDriverContext {
  page: Page;
  /** Navigates to an app path on whatever origin serves the app. */
  open(path: string): Promise<void>;
}

export interface FrameDriver {
  /** Reach the screen and run the warm-up. */
  prepare(ctx: FrameDriverContext): Promise<void>;
  /** Before each repetition, unmeasured: reach the measured window's start. */
  arrange?(ctx: FrameDriverContext): Promise<void>;
  /** The measured window. */
  measure(ctx: FrameDriverContext): Promise<void>;
  /**
   * After the measured window: in-page handler durations, in ms, for the
   * budget's handler-time line. Only scenarios that budget it have one.
   */
  handlerSamples?(ctx: FrameDriverContext): Promise<number[]>;
}

/** Resolves on the page's next animation frame. */
export async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A mouse's report rate: 125 Hz, one event every 8 ms. */
const MOUSE_EVENT_MS = 8;

/** A point inside the viewport, as a fraction of its width and height. */
async function viewportPoint(
  page: Page,
  fx: number,
  fy: number
): Promise<{ x: number; y: number }> {
  // An attached WebView has no Playwright viewport; the page knows its size.
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  return { x: size.width * fx, y: size.height * fy };
}

async function center(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (!box) throw new Error(`${target} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Moves the pressed mouse by (dx, dy) in `steps` events at the mouse's rate. */
async function dragBy(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  steps: number
) {
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    await sleep(MOUSE_EVENT_MS);
  }
}

const editorText = (page: Page) =>
  page.getByRole("textbox", { name: `Text of ${PERF_BOOK.longChapter}` });

/** Opens a seeded Book from the Books gallery; the editor opens its last Chapter. */
async function openBook(
  { page, open }: FrameDriverContext,
  title: string,
  text: Locator
): Promise<void> {
  await open("/");
  const card = page.getByRole("grid", { name: "Books" }).getByRole("row", { name: title });
  await expect(card).toBeVisible();
  await page.keyboard.press("1");
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(text).toBeFocused({ timeout: 30_000 });
}

/** Opens the perf Book; the editor opens its last Chapter. */
const openPerfBook = (ctx: FrameDriverContext) =>
  openBook(ctx, PERF_BOOK.title, editorText(ctx.page));

const typing: FrameDriver = {
  async prepare(ctx) {
    await openPerfBook(ctx);
    const { page } = ctx;
    // Deep in the Chapter: the document end, then up a dozen screens.
    await page.keyboard.press("ControlOrMeta+End");
    for (let i = 0; i < 12; i++) await page.keyboard.press("PageUp");
    await page.keyboard.press("End");
    await page.keyboard.type(" The keeper wrote by lamplight.", { delay: 60 });
    await sleep(500);
  },
  async measure({ page }) {
    const burst =
      " Rain struck the glass in long grey sheets while the lamp turned and the keeper wrote on.";
    const text = (burst + burst).slice(0, 120);
    await page.keyboard.type(text, { delay: 1000 / 12 });
    await sleep(300);
  },
};

async function wheelTicks(page: Page, dx: number, dy: number, ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await page.mouse.wheel(dx, dy);
    await nextFrame(page);
  }
}

const scroll: FrameDriver = {
  async prepare(ctx) {
    await openPerfBook(ctx);
    const { page } = ctx;
    await page.keyboard.press("ControlOrMeta+Home");
    // The editor is centered; the document's own box runs far below the fold.
    const at = await viewportPoint(page, 0.5, 0.5);
    await page.mouse.move(at.x, at.y);
    await wheelTicks(page, 0, 100, 5);
    await wheelTicks(page, 0, -100, 5);
    await sleep(300);
  },
  async measure({ page }) {
    await wheelTicks(page, 0, 100, 40);
    await wheelTicks(page, 0, -100, 40);
    await sleep(200);
  },
};

const canvasPane = (page: Page) => page.locator(".react-flow__pane");

const canvas: FrameDriver = {
  async prepare({ page, open }) {
    await open("/canvas");
    const grid = page.getByRole("grid", { name: "Canvases" });
    const row = grid.getByRole("row", { name: new RegExp(PERF_CANVAS.title) });
    await tabTo(page, grid.getByRole("row").first(), { max: 40 });
    await page.keyboard.press("Home");
    await pressUntilFocused(page, "ArrowRight", row, { max: 12 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("toolbar", { name: "Tools" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(`${PERF_CANVAS.nodePrefix} 1`, { exact: true })).toBeVisible();
    await sleep(500);
  },
  async measure({ page }) {
    // Pan: drag the empty pane (the toolbar sits on the right edge).
    const box = await canvasPane(page).boundingBox();
    if (!box) throw new Error("no Canvas pane");
    const from = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.5 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await dragBy(page, from, -300, -150, 60);
    await dragBy(page, { x: from.x - 300, y: from.y - 150 }, 300, 150, 60);
    await page.mouse.up();
    // Zoom: React Flow zooms on the wheel.
    await wheelTicks(page, 0, 100, 15);
    await wheelTicks(page, 0, -100, 15);
    await sleep(200);
  },
};

const outlineTree = (page: Page) =>
  page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("treegrid", { name: "Settings sections" });
const outlineEntry = (page: Page, name: string) =>
  outlineTree(page).getByRole("row", { name: new RegExp(`^${name}(, current)?$`) });

/** Wheel ticks that cross the whole Settings page at 100 px a tick. */
const SETTINGS_TICKS = 120;

// Keyboard jumps move focus to the section heading, and the only keyboard way
// back to the outline is Tab through every control; so the measured window
// scrolls instead. Scroll-spy makes each section current in turn, and the
// outline moves (rows close and open, the marker slides) at every change.
const settingsOutline: FrameDriver = {
  async prepare({ page, open }) {
    await open("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(outlineEntry(page, "Appearance")).toHaveAccessibleName("Appearance, current");
    // Warm-up: one keyboard jump through the outline.
    await tabTo(page, outlineEntry(page, "Appearance"), { backwards: true, max: 4 });
    await pressUntilFocused(page, "ArrowDown", outlineEntry(page, "General"), { max: 30 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "General", level: 2 })).toBeFocused();
    await sleep(500);
  },
  async arrange({ page }) {
    // The content column sits left of the outline.
    const at = await viewportPoint(page, 0.35, 0.5);
    await page.mouse.move(at.x, at.y);
    // Wheel up until scroll-spy makes Appearance current; under load the
    // page can take more ticks to settle at the top than a fixed count.
    const appearance = outlineEntry(page, "Appearance");
    for (let i = 0; i < 40; i++) {
      await wheelTicks(page, 0, -400, 1);
      if (
        (await appearance.getAttribute("aria-label").catch(() => null)) === "Appearance, current"
      ) {
        break;
      }
    }
    await expect(appearance).toHaveAccessibleName("Appearance, current");
    await sleep(400);
  },
  async measure({ page }) {
    await wheelTicks(page, 0, 100, SETTINGS_TICKS);
    await wheelTicks(page, 0, -100, SETTINGS_TICKS);
    await sleep(400);
  },
};

/** The main sidebar's drag edge. It has no accessible name (it is mouse-only),
 * so the Tutorial anchor it carries is the stable hook. */
const sidebarEdge = (page: Page) => page.locator('[data-tutorial~="books.remember"]');

const sidebarResize: FrameDriver = {
  async prepare({ page, open }) {
    await open("/");
    await expect(page.getByRole("grid", { name: "Books" }).getByRole("row").first()).toBeVisible();
    const at = await center(sidebarEdge(page));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await dragBy(page, at, 40, 0, 10);
    await dragBy(page, { x: at.x + 40, y: at.y }, -40, 0, 10);
    await page.mouse.up();
    await sleep(300);
  },
  async measure({ page }) {
    const at = await center(sidebarEdge(page));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await dragBy(page, at, 240, 0, 120);
    await dragBy(page, { x: at.x + 240, y: at.y }, -240, 0, 120);
    await page.mouse.up();
    await sleep(200);
  },
};

const chapterGrid = (page: Page) => page.getByRole("grid", { name: "Chapters" });
const chapterRow = (page: Page, title: string) =>
  chapterGrid(page).getByRole("row", { name: new RegExp(`^${title}\\b`) });

/** Focuses Log 1's Reorder button from the Chapter list. */
async function focusFirstReorder(page: Page): Promise<Locator> {
  // The list is one Tab stop; its row buttons are reached by ArrowRight.
  await tabTo(page, chapterGrid(page).getByRole("row", { selected: true }), { max: 40 });
  await page.keyboard.press("Home");
  await expect(chapterRow(page, "Log 1")).toBeFocused();
  const handle = chapterRow(page, "Log 1").getByRole("button", { name: "Reorder" });
  await pressUntilFocused(page, "ArrowRight", handle, { max: 6 });
  return handle;
}

const chapterReorder: FrameDriver = {
  async prepare(ctx) {
    await openPerfBook(ctx);
    const { page } = ctx;
    await page.keyboard.press("Escape");
    await focusFirstReorder(page);
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await sleep(300);
  },
  async arrange({ page }) {
    // A cancelled reorder (the warm-up's, or the last run's) leaves focus on
    // the handle, where the measured window starts.
    const handle = chapterRow(page, "Log 1").getByRole("button", { name: "Reorder" });
    if (!(await handle.evaluate((el) => el === document.activeElement))) {
      await focusFirstReorder(page);
    }
    await sleep(300);
  },
  async measure({ page }) {
    const handle = chapterRow(page, "Log 1").getByRole("button", { name: "Reorder" });
    await expect(handle).toBeFocused();
    await page.keyboard.press("Enter");
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("ArrowDown");
      await sleep(120);
    }
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("ArrowUp");
      await sleep(120);
    }
    // Escape cancels: the order is unchanged for the next repetition.
    await page.keyboard.press("Escape");
    await expect(handle).toBeFocused();
    await sleep(200);
  },
};

const paletteInput = (page: Page) =>
  page.getByRole("dialog").getByRole("searchbox", { name: "Find by name" });

const palette: FrameDriver = {
  async prepare(ctx) {
    await openPerfBook(ctx);
    const { page } = ctx;
    await page.keyboard.press("F1");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await sleep(300);
  },
  async measure({ page }) {
    await page.keyboard.press("F1");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(paletteInput(page)).toBeFocused();
    const query = "long night log";
    await page.keyboard.type(query, { delay: 120 });
    await sleep(300);
    for (let i = 0; i < query.length; i++) {
      await page.keyboard.press("Backspace");
      await sleep(80);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await sleep(200);
  },
};

/** Presses `key` (F6 or Shift+F6) until focus is inside `pane`. */
async function cycleTo(page: Page, key: string, pane: Locator): Promise<void> {
  for (let i = 0; i < 6 && !(await isFocusWithin(pane)); i++) {
    await page.keyboard.press(key);
  }
  await expectFocusWithin(pane);
}

/** Arrow leaves per measured window. */
const ARROW_LEAVES = 20;

declare global {
  interface Window {
    /** Set here, filled by src/lib/arrow-navigation: one entry per arrow that moved focus. */
    __maibukArrowLeaveMs?: number[];
  }
}

/**
 * Shift+F6 to a long list, then ArrowRight out of its row into the text
 * beside it, timing each arrow that moves focus in the page. The first leave
 * walks the selected row's buttons; F6 then lands on the last-used button,
 * so later rounds leave with one arrow. `list` and `text` are CSS locators:
 * a role query walks the whole 21,000-element Notes list on every focus
 * check, and in the measured window that work would land in the frames.
 */
function arrowLeave(
  reach: (ctx: FrameDriverContext) => Promise<void>,
  list: (page: Page) => Locator,
  text: (page: Page) => Locator
): FrameDriver {
  async function round(page: Page) {
    await cycleTo(page, "Shift+F6", list(page));
    await sleep(150);
    await pressUntilFocused(page, "ArrowRight", text(page), { max: 8 });
    await sleep(150);
  }
  return {
    async prepare(ctx) {
      await reach(ctx);
      await round(ctx.page);
      await sleep(300);
    },
    async arrange({ page }) {
      await expect(text(page)).toBeFocused();
      await page.evaluate(() => {
        window.__maibukArrowLeaveMs = [];
      });
      await sleep(300);
    },
    async measure({ page }) {
      for (let i = 0; i < ARROW_LEAVES; i++) await round(page);
    },
    async handlerSamples({ page }) {
      return page.evaluate(() => window.__maibukArrowLeaveMs ?? []);
    },
  };
}

const notesGallery = (page: Page) => page.getByRole("grid", { name: "Notes" });
const noteText = (page: Page) => page.locator('.ProseMirror[aria-label="Text"]');

/** Opens the first Note in the Notes Gallery. */
async function openFirstNote({ page, open }: FrameDriverContext): Promise<void> {
  await open("/notes");
  const first = notesGallery(page).getByRole("row").first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await tabTo(page, first, { max: 40 });
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(noteText(page)).toBeVisible({ timeout: 30_000 });
}

const manyChaptersText = (page: Page) => page.locator('.ProseMirror[aria-label^="Text of "]');
const openManyChaptersBook = (ctx: FrameDriverContext) =>
  openBook(ctx, PERF_MANY_CHAPTERS_BOOK.title, manyChaptersText(ctx.page));

/** F6 presses per measured window, and the pause after each. */
const PANE_STEPS = 24;
const PANE_STEP_MS = 250;

const paneSlide: FrameDriver = {
  async prepare(ctx) {
    await openManyChaptersBook(ctx);
    for (let i = 0; i < 6; i++) {
      await ctx.page.keyboard.press("F6");
      await sleep(PANE_STEP_MS);
    }
    await sleep(300);
  },
  async measure({ page }) {
    for (let i = 0; i < PANE_STEPS; i++) {
      await page.keyboard.press("F6");
      await sleep(PANE_STEP_MS);
    }
    await sleep(200);
  },
};

export const FRAME_DRIVERS: Record<string, FrameDriver> = {
  typing,
  scroll,
  canvas,
  "settings-outline": settingsOutline,
  "sidebar-resize": sidebarResize,
  "chapter-reorder": chapterReorder,
  palette,
  "arrow-leave-notes": arrowLeave(
    openFirstNote,
    (page) => page.locator('[data-focus-pane="notes-sidebar"]'),
    noteText
  ),
  "arrow-leave-chapters": arrowLeave(
    openManyChaptersBook,
    // The phone drawer renders a second, hidden Chapter list.
    (page) => page.locator('[data-focus-pane="chapter-list"]').filter({ visible: true }),
    manyChaptersText
  ),
  "pane-slide": paneSlide,
};
