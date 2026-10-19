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

import {
  type FrameLocator,
  type FramePage,
  boundingBox,
  isFocused,
  isFocusWithin,
  pressUntilFocused,
  tabTo,
  waitAttribute,
  waitCount,
  waitFocusWithin,
  waitFocused,
  waitHidden,
  waitVisible,
} from "./frame-page";
import { PERF_BOOK, PERF_CANVAS, PERF_MANY_CHAPTERS_BOOK } from "../support/seed/names";

export interface FrameDriverContext {
  page: FramePage;
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
export async function nextFrame(page: FramePage): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A mouse's report rate: 125 Hz, one event every 8 ms. */
const MOUSE_EVENT_MS = 8;

/** A point inside the viewport, as a fraction of its width and height. */
async function viewportPoint(
  page: FramePage,
  fx: number,
  fy: number
): Promise<{ x: number; y: number }> {
  // An attached WebView has no Playwright viewport; the page knows its size.
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  return { x: size.width * fx, y: size.height * fy };
}

async function center(target: FrameLocator): Promise<{ x: number; y: number }> {
  const box = await boundingBox(target);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Moves the pressed mouse by (dx, dy) in `steps` events at the mouse's rate. */
async function dragBy(
  page: FramePage,
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

const editorText = (page: FramePage) =>
  page.getByRole("textbox", { name: `Text of ${PERF_BOOK.longChapter}` });

/**
 * The measured typing burst: 120 characters, the pace of a fast typist. The
 * `typing` and `typing-with-highlights` scenarios type the
 * same text so their keystroke-to-next-frame numbers compare.
 */
const TYPING_BURST =
  " Rain struck the glass in long grey sheets while the lamp turned and the keeper wrote on.";
const TYPING_TEXT = (TYPING_BURST + TYPING_BURST).slice(0, 120);
/** The sentence the typing scenarios type before measuring, deep in the Chapter. */
const TYPING_WARMUP = " The keeper wrote by lamplight.";

/** Opens the seeded Book already focused in the Books gallery, without a reload. */
async function openBookInGallery(
  { page }: FrameDriverContext,
  title: string,
  text: FrameLocator
): Promise<void> {
  const card = page.getByRole("grid", { name: "Books" }).getByRole("row", { name: title });
  await waitVisible(card);
  await page.keyboard.press("1");
  await waitFocused(card);
  await page.keyboard.press("Enter");
  await waitFocused(text, 30_000);
}

/** Opens a seeded Book from the Books gallery; the editor opens its last Chapter. */
async function openBook(ctx: FrameDriverContext, title: string, text: FrameLocator): Promise<void> {
  await ctx.open("/");
  await openBookInGallery(ctx, title, text);
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
    await page.keyboard.type(TYPING_WARMUP, { delay: 60 });
    await sleep(500);
  },
  async arrange() {
    // Let the previous repetition's coalesced save and its SQLite write land
    // outside this one: the budget is the typing interaction, not persistence.
    await sleep(1500);
  },
  async measure({ page }) {
    await page.keyboard.type(TYPING_TEXT, { delay: 1000 / 12 });
    await sleep(300);
  },
};

async function wheelTicks(page: FramePage, dx: number, dy: number, ticks: number): Promise<void> {
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

const canvasPane = (page: FramePage) => page.locator(".react-flow__pane");

const canvas: FrameDriver = {
  async prepare({ page, open }) {
    await open("/canvas");
    const grid = page.getByRole("grid", { name: "Canvases" });
    const row = grid.getByRole("row", { name: new RegExp(PERF_CANVAS.title) });
    await tabTo(page, grid.getByRole("row").first(), { max: 40 });
    await page.keyboard.press("Home");
    await pressUntilFocused(page, "ArrowRight", row, { max: 12 });
    await page.keyboard.press("Enter");
    await waitVisible(page.getByRole("toolbar", { name: "Tools" }), 30_000);
    await waitVisible(page.getByText(`${PERF_CANVAS.nodePrefix} 1`, { exact: true }));
    await sleep(500);
  },
  async measure({ page }) {
    // Pan: drag the empty pane (the toolbar sits on the right edge).
    const box = await boundingBox(canvasPane(page));
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

const outlineTree = (page: FramePage) =>
  page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("treegrid", { name: "Settings sections" });
const outlineEntry = (page: FramePage, name: string) =>
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
    await waitVisible(page.getByRole("heading", { name: "Settings", level: 1 }));
    await waitAttribute(outlineEntry(page, "Appearance"), "aria-label", "Appearance, current");
    // Warm-up: one keyboard jump through the outline.
    await tabTo(page, outlineEntry(page, "Appearance"), { backwards: true, max: 4 });
    await pressUntilFocused(page, "ArrowDown", outlineEntry(page, "General"), { max: 30 });
    await page.keyboard.press("Enter");
    await waitFocused(page.getByRole("heading", { name: "General", level: 2 }));
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
        (await appearance.evaluate((el) => el.getAttribute("aria-label")).catch(() => null)) ===
        "Appearance, current"
      ) {
        break;
      }
    }
    await waitAttribute(appearance, "aria-label", "Appearance, current");
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
const sidebarEdge = (page: FramePage) => page.locator('[data-tutorial~="books.remember"]');

const sidebarResize: FrameDriver = {
  async prepare({ page, open }) {
    await open("/");
    await waitVisible(page.getByRole("grid", { name: "Books" }).getByRole("row").first());
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

const chapterListEdge = (page: FramePage) =>
  page.getByRole("separator", { name: "Resize chapter list" });

const chapterListResize: FrameDriver = {
  async prepare(ctx) {
    await openPerfBook(ctx);
    const { page } = ctx;
    const at = await center(chapterListEdge(page));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await dragBy(page, at, 40, 0, 10);
    await dragBy(page, { x: at.x + 40, y: at.y }, -40, 0, 10);
    await page.mouse.up();
    await sleep(300);
  },
  async measure({ page }) {
    const at = await center(chapterListEdge(page));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await dragBy(page, at, 200, 0, 100);
    await dragBy(page, { x: at.x + 200, y: at.y }, -200, 0, 100);
    await page.mouse.up();
    await sleep(200);
  },
};

// The phone drawer renders a second, hidden Chapter list.
const chapterGrid = (page: FramePage) =>
  page
    .locator('[data-focus-pane="chapter-list"]')
    .visible()
    .getByRole("grid", { name: "Chapters" });
const chapterRow = (page: FramePage, title: string) =>
  chapterGrid(page).getByRole("row", { name: new RegExp(`^${title}\\b`) });

/** Focuses Log 1's Reorder button from the Chapter list. */
async function focusFirstReorder(page: FramePage): Promise<FrameLocator> {
  // Tab from the editor (Indent) and from the pane (WebKit, which lands on the
  // Chapter list pane itself) never reaches the grid's one Tab stop in this
  // probe, so a row is focused directly. The selected row can be virtualized
  // out by a previous run, so any mounted row is focused and Control+Home
  // moves to the first (#551).
  await chapterGrid(page).evaluate((grid) =>
    (grid.querySelector('[role="row"]') as HTMLElement | null)?.focus()
  );
  await page.keyboard.press("Control+Home");
  await waitFocused(chapterRow(page, "Log 1"));
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
    if (!(await isFocused(handle))) {
      await focusFirstReorder(page);
    }
    await sleep(300);
  },
  async measure({ page }) {
    const handle = chapterRow(page, "Log 1").getByRole("button", { name: "Reorder" });
    await waitFocused(handle);
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
    await waitFocused(handle);
    await sleep(200);
  },
};

const paletteInput = (page: FramePage) =>
  page.getByRole("dialog").getByRole("searchbox", { name: "Find by name" });

const palette: FrameDriver = {
  async prepare(ctx) {
    await openPerfBook(ctx);
    const { page } = ctx;
    await page.keyboard.press("F1");
    await waitVisible(page.getByRole("dialog"));
    await page.keyboard.press("Escape");
    await waitHidden(page.getByRole("dialog"));
    await sleep(300);
  },
  async measure({ page }) {
    await page.keyboard.press("F1");
    await waitVisible(page.getByRole("dialog"));
    await waitFocused(paletteInput(page));
    const query = "long night log";
    await page.keyboard.type(query, { delay: 120 });
    await sleep(300);
    for (let i = 0; i < query.length; i++) {
      await page.keyboard.press("Backspace");
      await sleep(80);
    }
    await page.keyboard.press("Escape");
    await waitHidden(page.getByRole("dialog"));
    await sleep(200);
  },
};

/** Presses `key` (F6 or Shift+F6) until focus is inside `pane`. */
async function cycleTo(page: FramePage, key: string, pane: FrameLocator): Promise<void> {
  for (let i = 0; i < 6 && !(await isFocusWithin(pane)); i++) {
    await page.keyboard.press(key);
  }
  await waitFocusWithin(pane);
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
  list: (page: FramePage) => FrameLocator,
  text: (page: FramePage) => FrameLocator
): FrameDriver {
  async function round(page: FramePage) {
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
      await waitFocused(text(page));
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

const notesGallery = (page: FramePage) => page.getByRole("grid", { name: "Notes" });
const noteText = (page: FramePage) => page.locator('.ProseMirror[aria-label="Text"]');

/** Opens the first Note in the Notes Gallery. */
async function openFirstNote({ page, open }: FrameDriverContext): Promise<void> {
  await open("/notes");
  const first = notesGallery(page).getByRole("row").first();
  await waitVisible(first, 30_000);
  await tabTo(page, first, { max: 40 });
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await waitVisible(noteText(page), 30_000);
}

const manyChaptersText = (page: FramePage) => page.locator('.ProseMirror[aria-label^="Text of "]');
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

/** The fixture-bench echo page's route (its only page). */
const BENCH_ECHO_PATH = "/plugin/fixture-bench/echo";
const echoInput = (page: FramePage) => page.getByRole("textbox", { name: "Echo input" });
const benchTableRowCount = (page: FramePage) =>
  page.getByRole("table", { name: "Bench rows" }).locator("tbody tr");
const pluginHighlight = (page: FramePage) => page.locator(".plugin-highlight");

const navOption = (page: FramePage, name: string) =>
  page
    .getByRole("listbox", { name: "Primary navigation" })
    .getByRole("option", { name: new RegExp(`^${name}`) });

/**
 * Opens the fixture-bench echo page and waits for its Worker's Remote UI tree
 * (the echo field and the full 1,000-row table). CSS row count, not a role
 * query: the table is a plain `<table>` with no scroll container of its own.
 */
async function openBenchEcho(page: FramePage): Promise<void> {
  await page.goto(BENCH_ECHO_PATH);
  await waitVisible(echoInput(page), 30_000);
  await waitCount(benchTableRowCount(page), 1000, 30_000);
}

/** Wheel ticks of 100 px that cross the whole echo page, from the table's height. */
async function tableWheelTicks(page: FramePage): Promise<number> {
  const distance = await page.evaluate(() => {
    let node: HTMLElement | null = document.querySelector("table");
    while (node !== null) {
      const scrollable = node.scrollHeight - node.clientHeight;
      if (scrollable > 8) return scrollable;
      node = node.parentElement;
    }
    return 0;
  });
  return Math.max(1, Math.ceil(distance / 100));
}

/** Leaves the echo page by keyboard, so the Worker keeps running (on-demand). */
async function leaveBenchEcho(page: FramePage): Promise<void> {
  await tabTo(page, navOption(page, "Books"));
  await page.keyboard.press("Enter");
}

/**
 * Opens the echo page from the sidebar, then waits for its full Remote UI tree
 * (the 1,000-row table). The Worker is already running (`prepare`), so this
 * measures rendering the transplanted Remote UI, not starting the Plugin.
 */
async function openBenchEchoFromSidebar(page: FramePage): Promise<void> {
  await tabTo(
    page,
    page
      .getByRole("listbox", { name: "Primary navigation" })
      .getByRole("option", { name: /^Books/ })
  );
  await pressUntilFocused(page, "ArrowDown", navOption(page, "Bench echo"));
  await page.keyboard.press("Enter");
  await waitVisible(echoInput(page), 30_000);
  await waitCount(benchTableRowCount(page), 1000, 30_000);
}

const pluginRemoteUi: FrameDriver = {
  async prepare({ page }) {
    // Start the Plugin's Worker by opening its page once, then leave it by
    // keyboard so the measured window opens the page fresh (its Remote UI tree
    // is transplanted into the app, not a bare reload). Keystroke echo is
    // bench:plugins' job (remoteUiEcho); this scenario measures rendering only.
    await openBenchEcho(page);
    await leaveBenchEcho(page);
    await sleep(300);
  },
  async arrange({ page }) {
    // Each repetition opens the echo page itself, so bring the app back to the
    // Books gallery first; the Worker stays alive.
    await leaveBenchEcho(page);
    await sleep(200);
  },
  async measure({ page }) {
    // The measured span: open the echo page from the sidebar, wait for its
    // 1,000 rows, then wheel the table top to bottom and back.
    await openBenchEchoFromSidebar(page);
    const at = await viewportPoint(page, 0.5, 0.5);
    await page.mouse.move(at.x, at.y);
    // The table's whole height in 100 px ticks, top to bottom, then back up.
    const ticks = await tableWheelTicks(page);
    await wheelTicks(page, 0, 100, ticks);
    await wheelTicks(page, 0, -100, ticks);
    await sleep(300);
  },
};

const typingWithHighlights: FrameDriver = {
  async prepare(ctx) {
    const { page } = ctx;
    // Start the Plugin's Worker before the Chapter editor focuses: it paints
    // highlights only in response to focus and content changes, never replayed.
    await openBenchEcho(page);
    // Leave the echo page by keyboard, not a reload, so the Worker keeps running.
    await tabTo(page, navOption(page, "Books"));
    await page.keyboard.press("Enter");
    await openBookInGallery(ctx, PERF_BOOK.title, editorText(page));
    // The host renders each highlight as a `plugin-highlight` span.
    await waitVisible(pluginHighlight(page).first(), 15_000);
    // Deep in the Chapter, like `typing`.
    await page.keyboard.press("ControlOrMeta+End");
    for (let i = 0; i < 12; i++) await page.keyboard.press("PageUp");
    await page.keyboard.press("End");
    await page.keyboard.type(TYPING_WARMUP, { delay: 60 });
    await sleep(500);
  },
  async measure({ page }) {
    // Typing changes the Chapter content; the Plugin re-sends highlights 300 ms
    // after the last edit, so the burst maps highlights on every keystroke.
    await page.keyboard.type(TYPING_TEXT, { delay: 1000 / 12 });
    await sleep(300);
  },
};

/**
 * The `typing-with-echoes` scenario (#451): spell check and the real Echoes
 * Plugin's nearby highlights are both on while the same 120-character burst is
 * typed, judged like `typing`. Echoes' Default Shortcut toggles its highlights
 * on the focused editor; its Commands are live once its sidebar entry shows.
 */
const typingWithEchoes: FrameDriver = {
  async prepare(ctx) {
    const { page } = ctx;
    await ctx.open("/");
    // The on-demand Echoes Plugin warm-starts at launch (its Open Echoes Command
    // is global); its sidebar entry appearing means its Commands are live.
    await waitVisible(navOption(page, "Echoes"), 60_000);
    await openBookInGallery(ctx, PERF_BOOK.title, editorText(page));
    // Toggle nearby-echo highlights on with the Command's Default Shortcut. The
    // first press can land before the Plugin's Commands are available (the
    // sidebar entry shows at scan, before the Worker is ready), and a press
    // while unavailable is a no-op, so retry until the highlights appear.
    const marks = pluginHighlight(page);
    let on = false;
    for (let attempt = 0; attempt < 12 && !on; attempt++) {
      await page.keyboard.press("Alt+F7");
      on = await waitVisible(marks.first(), 5_000)
        .then(() => true)
        .catch(() => false);
    }
    if (!on) throw new Error("Echoes' highlights never turned on");
    // Deep in the Chapter, like `typing`.
    await page.keyboard.press("ControlOrMeta+End");
    for (let i = 0; i < 12; i++) await page.keyboard.press("PageUp");
    await page.keyboard.press("End");
    await page.keyboard.type(TYPING_WARMUP, { delay: 60 });
    await sleep(500);
  },
  async measure({ page }) {
    // Spell check and Echoes' highlights both refresh 300 ms after the last edit;
    // the burst is judged keystroke to next frame, like `typing`.
    await page.keyboard.type(TYPING_TEXT, { delay: 1000 / 12 });
    await sleep(300);
  },
};

export const FRAME_DRIVERS: Record<string, FrameDriver> = {
  typing,
  scroll,
  canvas,
  "settings-outline": settingsOutline,
  "sidebar-resize": sidebarResize,
  "chapter-list-resize": chapterListResize,
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
    (page) => page.locator('[data-focus-pane="chapter-list"]').visible(),
    manyChaptersText
  ),
  "pane-slide": paneSlide,
  "plugin-remote-ui": pluginRemoteUi,
  "typing-with-highlights": typingWithHighlights,
  "typing-with-echoes": typingWithEchoes,
};
