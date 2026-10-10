// Plugin sandbox tracer (issue #434): a tracer Plugin folder seeded into OPFS
// with a pinned-hash approval starts at launch, answers the host's health
// check, makes one broker call (a toast), and proves the sandbox CSP refuses a
// direct fetch from its Worker. Tagged @sandbox: the Plugin testing strategy
// runs that group on chromium, webkit, and firefox.

import { expect, test } from "../support/test";

const LEAK_URL = "https://tracer.invalid/leak";

test.describe("Plugin sandbox tracer @wf:plugins-sandbox-tracer @sandbox @no-webkit", () => {
  test.use({ plugins: ["tracer"] });

  test("starts the seeded Plugin and observes a broker round trip", async ({ page }) => {
    // The hermetic network aborts every non-local request; this route records
    // whether the direct fetch left the Worker at all. The CSP must refuse it
    // before a request exists, so the log stays empty.
    const requests: string[] = [];
    await page.route(`${LEAK_URL}*`, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });

    await page.goto("/");
    const toast = page.getByRole("status").filter({ hasText: "Tracer Fixture" });
    await expect(toast).toContainText("tracer ready; direct fetch: refused");
    expect(requests).toEqual([]);
  });
});

test.describe("Plugin sandbox tracer with no Plugins @wf:plugins-sandbox-tracer @sandbox", () => {
  test("launch creates no sandbox frame", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
    // A hidden sandbox frame has no accessible name to locate it by; the count
    // is the assertion, and no frame is the only way no Plugin Worker exists.
    expect(await page.locator("iframe").count()).toBe(0);
  });
});
