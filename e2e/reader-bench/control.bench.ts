// The control for the memory gate (issue #653, gate 3). Reader is disabled, and
// the page makes the same in-app visit a reader makes: Settings, then back to the
// Library, with the same 30 s settle and the same forced-GC heap read as the
// document run. Its growth is what any in-app visit leaves behind on this build
// (the app's caches, Playwright's own InjectedScript copies), so the runner
// subtracts it from Reader's growth (scripts/reader-bench-budget.mjs
// `readerGrowthBytes`). A separate page load from the document run, so each
// baseline is its own.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";
import { benchOut, heapAfterGc, navOption } from "./support";

/** The same quiet period the document run uses before its heap read. */
const LEAVE_SETTLE_MS = 30_000;

test.use({
  plugins: ["maibuk-reader"],
  builtInPlugins: [{ id: "maibuk-reader" }],
  pluginApprovals: [{ pluginId: "maibuk-reader", enabled: false }],
});

test("control: an in-app visit to Settings and back, then 30 s", async ({ page }) => {
  await page.goto("/");
  await expect(navOption(page, "Books")).toBeVisible({ timeout: 60_000 });
  // The heap before the visit: the app with Reader disabled, on its first page.
  const baselineHeapBytes = await heapAfterGc(page);

  // The sidebar is a roving-focus listbox: Tab reaches its one stop (Books), then
  // arrows move the focus, as openReader and goHome do for Reader.
  await tabTo(page, navOption(page, "Books"), { max: 60 });
  await pressUntilFocused(page, "ArrowDown", navOption(page, "Settings"), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

  await tabTo(page, navOption(page, "Settings"), { max: 60 });
  await pressUntilFocused(page, "ArrowUp", navOption(page, "Books"), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);

  await page.waitForTimeout(LEAVE_SETTLE_MS);
  const afterLeaveHeapBytes = await heapAfterGc(page);

  writeFileSync(
    resolve(benchOut(), "control.json"),
    `${JSON.stringify({ baselineHeapBytes, afterLeaveHeapBytes, leaveSettleMs: LEAVE_SETTLE_MS }, null, 1)}\n`
  );
});
