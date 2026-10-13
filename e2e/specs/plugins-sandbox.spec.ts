// The sandbox wire contract (issue #434; audit fixes on #478): the fixed host
// prelude boots a Plugin exactly once whichever way the Plugin registers its
// message handler, and the frame bootstrap forwards only the first ready (and
// error) message, so a Plugin's own posts are not a side channel to the host
// window. Tagged @sandbox so Firefox runs it; it needs no OPFS, so WebKit runs
// it too.

import { runBootstrapForwarding, runPreludeShape } from "../support/plugins-sandbox";
import { expect, test } from "../support/test";

test.describe("Plugin sandbox Worker prelude @wf:plugins-sandbox @sandbox", () => {
  test("boots a Plugin that uses self.onmessage exactly once", async ({ page }) => {
    await page.goto("/");
    const run = await runPreludeShape(page, "onmessage");
    expect(run.inits).toEqual([1]);
  });

  test("boots a Plugin that uses self.addEventListener exactly once", async ({ page }) => {
    await page.goto("/");
    const run = await runPreludeShape(page, "addEventListener");
    expect(run.inits).toEqual([1]);
  });
});

test.describe("Plugin sandbox bootstrap @wf:plugins-sandbox @sandbox", () => {
  test("forwards only the first ready and never a Plugin's own posts", async ({ page }) => {
    await page.goto("/");
    const run = await runBootstrapForwarding(page);
    expect(run.readyForwards).toBe(1);
    expect(run.spamForwards).toBe(0);
    expect(run.errorForwards).toBe(0);
  });
});
