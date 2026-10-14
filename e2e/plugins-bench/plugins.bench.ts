// The Plugins bench as Playwright tests (issue #448): `pnpm bench:plugins` only
// (e2e/playwright.plugins-bench.config.ts; testDir ./plugins-bench, so the E2E
// suite and the frame-rate lane never pick this file up). Each test seeds its
// device once, then takes N samples of one measurement and writes them to
// PLUGINS_BENCH_OUT/<name>.json, which the runner assembles into the
// PluginsBenchReport. These are measurements, not specs: the keyboard contract
// does not apply, and a warm-up load (launch) or warm-up keystrokes (echo and
// burst) are discarded where the measurement needs one.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { ECHO_WARMUP_KEYS, echoWarmupText } from "@/features/plugins/bench/measure";
import { isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { SEED_BOOK } from "../support/seed/names";
import { REPO_ROOT } from "../support/seed/seeds";
import { clonePluginSeeds, seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

function benchOutDir(): string {
  const dir = process.env.PLUGINS_BENCH_OUT;
  if (!dir) {
    throw new Error("PLUGINS_BENCH_OUT is not set: run the lane with `pnpm bench:plugins`");
  }
  return dir;
}
const OUT = benchOutDir();
const SAMPLES = Number(process.env.PLUGINS_BENCH_SAMPLES ?? 20);
if (!Number.isInteger(SAMPLES) || SAMPLES < 1) {
  throw new Error(
    `PLUGINS_BENCH_SAMPLES must be a positive integer, got "${process.env.PLUGINS_BENCH_SAMPLES}"`
  );
}

/** Loads a measurement needs before it is stable; launch discards them. */
const WARMUPS = 2;
const GALLERY_MARK = "app.gallery.first-render";
const PLUGIN_READY_MARK = "plugin.start:fixture-everything";

/** The on-demand fixture the start-to-ready measurement warms up. */
const ON_DEMAND_FIXTURE = "fixture-everything-on-demand";

/** fixture-everything's required Plugin Permissions, in manifest order. */
const EVERYTHING_PERMISSIONS = [
  "library:read",
  "library:write",
  "editor:read",
  "editor:decorate",
  "secrets",
  "network:fixture.invalid",
];
/** fixture-bench's required Plugin Permissions. */
const BENCH_PERMISSIONS = ["editor:read", "editor:decorate"];

/**
 * fixture-everything's `stamp` default Shortcut, read from its built manifest
 * (`Mod` is Playwright's `ControlOrMeta`, the host's Mod key). The Command's
 * first visible effect is the notification its Worker shows; the text is the
 * fixture's own, not declared in the manifest.
 */
function stampShortcut(): string {
  const path = resolve(REPO_ROOT, "e2e/.output/plugins/fixture-everything/manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as {
    contributes?: { commands?: { id: string; defaults?: string[][] }[] };
  };
  const chord = manifest.contributes?.commands?.find((command) => command.id === "stamp")
    ?.defaults?.[0]?.[0];
  if (chord === undefined)
    throw new Error("fixture-everything declares no default Shortcut for stamp");
  return chord.replace(/Mod/g, "ControlOrMeta");
}
const STAMP_SHORTCUT = stampShortcut();
/** The first visible effect of `stamp`: the notification the Plugin shows. */
const STAMP_EFFECT = "Fixture stamped";
/** Echo/burst type this many characters; the pace is the only difference. */
const ECHO_TEXT = Array.from({ length: SAMPLES }, (_, i) =>
  String.fromCharCode(97 + (i % 26))
).join("");
const ECHO_DELAY_MS = 120;

const navList = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });

function write(name: string, data: unknown): void {
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(data));
}

/** The first Gallery render's start time for this load, waiting for the mark. */
async function galleryFirstRender(page: Page): Promise<number> {
  await page.waitForFunction(
    (mark) => performance.getEntriesByName(mark).length > 0,
    GALLERY_MARK,
    { timeout: 30_000 }
  );
  return page.evaluate((mark) => performance.getEntriesByName(mark)[0].startTime, GALLERY_MARK);
}

/** Seeds once (the `page` fixture), warms up, then samples N fresh Gallery loads. */
async function measureLaunch(page: Page): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < WARMUPS + SAMPLES; i++) {
    await page.goto("/");
    const start = await galleryFirstRender(page);
    if (i >= WARMUPS) samples.push(start);
  }
  return samples;
}

/** The page id and title a Plugin's sidebar entry opens, from its manifest. */
function pluginSurface(id: string): { pageId: string; title: string } {
  for (const dir of [
    resolve(REPO_ROOT, "e2e/.output/plugins", id),
    resolve(REPO_ROOT, "plugins", id),
  ]) {
    const manifestPath = resolve(dir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      contributes?: { pages?: { id: string; title: string }[] };
    };
    const page = manifest.contributes?.pages?.[0];
    if (page) return { pageId: page.id, title: page.title };
  }
  throw new Error(`no manifest with a page for Plugin "${id}"`);
}

/**
 * The on-demand ids the shipped Built-ins declare, read at run time
 * (`plugins/builtins.json`, empty today). Unit 4b extends this to seed them as
 * Built-ins; with none, only the on-demand fixture is measured.
 */
function onDemandBuiltinIds(): string[] {
  const path = resolve(REPO_ROOT, "plugins/builtins.json");
  if (!existsSync(path)) return [];
  const list = JSON.parse(readFileSync(path, "utf8")) as { plugins?: unknown[] };
  const ids: string[] = [];
  for (const entry of list.plugins ?? []) {
    const id = typeof entry === "string" ? entry : (entry as { id?: string }).id;
    if (id === undefined) continue;
    const manifestPath = resolve(REPO_ROOT, "plugins", id, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { lifecycle?: string };
    if (manifest.lifecycle === "on-demand") ids.push(id);
  }
  return ids;
}

/** N fresh loads that reach the Plugin's page, sampling its `plugin.start:<id>`. */
async function measureStart(page: Page, id: string): Promise<number[]> {
  const surface = pluginSurface(id);
  const measure = `plugin.start:${id}`;
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    await page.goto("/");
    const option = navList(page).getByRole("option", { name: new RegExp(`^${surface.title}`) });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await tabTo(page, navList(page).getByRole("option", { name: /^Books/ }));
    await pressUntilFocused(page, "ArrowDown", option, { max: 12 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/plugin/${id}/${surface.pageId}$`));
    await page.waitForFunction(
      (name) => performance.getEntriesByName(name, "measure").length > 0,
      measure,
      { timeout: 15_000 }
    );
    samples.push(
      await page.evaluate(
        (name) => performance.getEntriesByName(name, "measure")[0].duration,
        measure
      )
    );
  }
  return samples;
}

/**
 * Opens the seeded Book and leaves the Chapter list focused, so the open
 * Chapter stays the target `stamp` resolves and the editor (a typing target,
 * where modifier Shortcuts are suppressed) does not hold focus.
 */
async function openChapter(page: Page): Promise<void> {
  const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
  await expect(card).toHaveCount(1);
  await page.keyboard.press("1");
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
  const pane = page.getByRole("complementary", { name: "Chapter list" });
  for (let i = 0; i < 3; i++) {
    if (await isFocusWithin(pane)) break;
    await page.keyboard.press("Escape");
  }
  const grid = page.getByRole("grid", { name: "Chapters" });
  await tabTo(page, grid.getByRole("row", { selected: true }));
}

/**
 * One `stamp` press: a capture keydown records the chord's own timestamp, a
 * MutationObserver on the document records the first mutation that shows the
 * effect, then the next rAF reads `performance.now()`. The sample is that time
 * minus the keydown.
 */
async function pressStamp(page: Page): Promise<number> {
  await page.evaluate((effect) => {
    const w = window as unknown as {
      __benchCmd: { lastKey: number; sample: number | null; armed: boolean };
    };
    w.__benchCmd = { lastKey: 0, sample: null, armed: false };
    const onKey = (event: KeyboardEvent) => {
      w.__benchCmd.lastKey = event.timeStamp;
      w.__benchCmd.armed = true;
    };
    window.addEventListener("keydown", onKey, true);
    const observer = new MutationObserver(() => {
      const probe = w.__benchCmd;
      if (!probe.armed) return;
      const toast = [...document.querySelectorAll('[role="status"]')].find((el) =>
        el.textContent?.includes(effect)
      );
      if (!toast) return;
      probe.armed = false;
      const keyedAt = probe.lastKey;
      requestAnimationFrame(() => {
        probe.sample = performance.now() - keyedAt;
        observer.disconnect();
        window.removeEventListener("keydown", onKey, true);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }, STAMP_EFFECT);
  await page.keyboard.press(STAMP_SHORTCUT);
  await page.waitForFunction(
    () =>
      (window as unknown as { __benchCmd: { sample: number | null } }).__benchCmd.sample !== null,
    undefined,
    { timeout: 15_000 }
  );
  return page.evaluate(
    () =>
      (window as unknown as { __benchCmd: { sample: number | null } }).__benchCmd.sample as number
  );
}

/** Waits until the Plugin is ready, opens a Chapter, then samples N presses. */
async function measureCommand(page: Page): Promise<number[]> {
  await seedSettings(page, { lastPath: null });
  await page.goto("/");
  await page.waitForFunction(
    (mark) => performance.getEntriesByName(mark, "measure").length > 0,
    PLUGIN_READY_MARK,
    { timeout: 20_000 }
  );
  await openChapter(page);
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    samples.push(await pressStamp(page));
    // The notification admits one call every 5 s; wait it out (the 2 s toast
    // is gone well before), so every press has its own effect to observe.
    await page.waitForTimeout(5_300);
  }
  return samples;
}

/** Waits until the echo Text reads exactly `value` (e.g. `echo:` when empty). */
async function waitForEcho(page: Page, value: string): Promise<void> {
  await page.waitForFunction((expected) => {
    const el = [...document.querySelectorAll("p")].find((p) => p.textContent?.startsWith("echo:"));
    return el?.textContent === expected;
  }, value);
}

/**
 * Types `text` into the echo field and, per key, samples keydown -> the echo
 * Text containing that key's prefix, committed to the DOM. `delay` is the typing pace:
 * 120 ms for echo, 0 for the burst. A later echo of a longer prefix still
 * contains this key's prefix, so a burst the Worker coalesces into one update
 * still yields one sample per key. Before arming it types `ECHO_WARMUP_KEYS`
 * warm-up characters, waits for their echo, then clears the field (select all +
 * Backspace) back to an empty echo, so a cold first keystroke (JIT, the first
 * Remote UI update) does not decide p95 — the WebKitGTK echo samples were
 * [22,6,3,3,...] — exactly as launch discards two warm-up loads (issue #448).
 */
async function measureEcho(page: Page, text: string, delay: number): Promise<number[]> {
  const field = page.getByRole("textbox", { name: "Echo input" });
  await expect(field).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Row 1000", { exact: true })).toBeVisible({ timeout: 15_000 });
  await field.focus();

  await page.evaluate(() => {
    const w = window as unknown as {
      __benchEcho: { keys: number[]; mutations: { t: number; text: string }[]; armed: boolean };
    };
    const el = [...document.querySelectorAll("p")].find((p) => p.textContent?.startsWith("echo:"));
    if (!el) throw new Error("the echo Text was not found");
    w.__benchEcho = { keys: [], mutations: [], armed: false };
    window.addEventListener(
      "keydown",
      (event) => {
        if (w.__benchEcho.armed) w.__benchEcho.keys.push(event.timeStamp);
      },
      true
    );
    const observer = new MutationObserver(() => {
      if (!w.__benchEcho.armed) return;
      // The sample ends when the echo is committed to the DOM, not at the next
      // rAF: the rAF tail adds up to one frame of phase noise that measures the
      // display, not the Plugin round trip. Keystroke to next frame is
      // bench:frames' job (its plugin-remote-ui scenario).
      w.__benchEcho.mutations.push({ t: performance.now(), text: el.textContent ?? "" });
    });
    observer.observe(el, { childList: true, characterData: true, subtree: true });
  });

  // Warm up before arming, then clear the field back to an empty echo. The
  // observer ignores both (armed is still false), so neither reaches the samples.
  const warmup = echoWarmupText(ECHO_WARMUP_KEYS);
  await page.keyboard.type(warmup, { delay });
  await waitForEcho(page, `echo:${warmup}`);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await waitForEcho(page, "echo:");

  await page.evaluate(() => {
    const w = window as unknown as {
      __benchEcho: { keys: number[]; mutations: unknown[]; armed: boolean };
    };
    w.__benchEcho.keys = [];
    w.__benchEcho.mutations = [];
    w.__benchEcho.armed = true;
  });

  await page.keyboard.type(text, { delay });
  // Wait for the observer to have recorded the full value, not just for the
  // text to show it, so the last (or, in a coalesced burst, the only) sample
  // is never lost.
  await page.waitForFunction(
    (full) => {
      const w = window as unknown as { __benchEcho: { mutations: { text: string }[] } };
      return w.__benchEcho.mutations.some((entry) => entry.text === `echo:${full}`);
    },
    text,
    { timeout: 20_000 }
  );

  const { keys, mutations } = await page.evaluate(() => {
    const w = window as unknown as {
      __benchEcho: { keys: number[]; mutations: { t: number; text: string }[] };
    };
    return { keys: w.__benchEcho.keys, mutations: w.__benchEcho.mutations };
  });
  const samples: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const expected = `echo:${text.slice(0, i + 1)}`;
    // "the echo containing that prefix": a later echo of a longer prefix still
    // contains this key's prefix, so a coalesced burst still yields one sample
    // per key. An earlier mutation is always shorter, so the first match is the
    // echo this key produced.
    const mutation = mutations.find((entry) => entry.text.includes(expected));
    if (mutation !== undefined && keys[i] !== undefined) samples.push(mutation.t - keys[i]);
  }
  return samples;
}

test.describe("launch: no Plugins", () => {
  test.use({ library: "empty" });
  test("launch-baseline", async ({ page }) => {
    write("launch-baseline", await measureLaunch(page));
  });
});

test.describe("launch: twenty on-demand clones", () => {
  test.use({ library: "empty", plugins: clonePluginSeeds("fixture-everything-on-demand", 20) });
  test("launch-installed20", async ({ page }) => {
    write("launch-installed20", await measureLaunch(page));
  });
});

test.describe("launch: three persistent", () => {
  test.use({ library: "empty", plugins: clonePluginSeeds("fixture-everything", 3) });
  test("launch-persistent3", async ({ page }) => {
    write("launch-persistent3", await measureLaunch(page));
  });
});

test.describe("startToReady: on-demand Plugins", () => {
  test.use({ library: "empty", plugins: [ON_DEMAND_FIXTURE] });
  test("startToReady", async ({ page }) => {
    await seedSettings(page, { lastPath: null });
    const ids = [ON_DEMAND_FIXTURE, ...onDemandBuiltinIds()];
    const result: Record<string, number[]> = {};
    for (const id of ids) result[id] = await measureStart(page, id);
    write("startToReady", result);
  });
});

test.describe("commandToEffect: the stamp Command", () => {
  test.use({
    library: "oneBookThreeChapters",
    plugins: ["fixture-everything"],
    pluginApprovals: [{ pluginId: "fixture-everything", granted: EVERYTHING_PERMISSIONS }],
  });
  test("commandToEffect", async ({ page }) => {
    write("commandToEffect", await measureCommand(page));
  });
});

test.describe("remoteUiEcho: typing into the echo page", () => {
  test.use({
    library: "empty",
    plugins: ["fixture-bench"],
    pluginApprovals: [{ pluginId: "fixture-bench", granted: BENCH_PERMISSIONS }],
  });
  test("remoteUiEcho", async ({ page }) => {
    await seedSettings(page, { lastPath: null });
    await page.goto("/plugin/fixture-bench/echo");
    write("remoteUiEcho", await measureEcho(page, ECHO_TEXT, ECHO_DELAY_MS));
  });
});

test.describe("remoteUiBurst: typing into the echo page in a burst", () => {
  test.use({
    library: "empty",
    plugins: ["fixture-bench"],
    pluginApprovals: [{ pluginId: "fixture-bench", granted: BENCH_PERMISSIONS }],
  });
  test("remoteUiBurst", async ({ page }) => {
    await seedSettings(page, { lastPath: null });
    await page.goto("/plugin/fixture-bench/echo");
    write("remoteUiBurst", await measureEcho(page, ECHO_TEXT, 0));
  });
});
