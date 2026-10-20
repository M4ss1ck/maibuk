// The Plugin Endpoint (issue #586, ADR 0031): the local address where Maibuk
// hands an HTTP request to the Plugin its path names, and only to a Plugin that
// holds the `serve` Plugin Permission. Playwright drives the web build, which has
// no socket, so the tests reach the host side through the E2E lane's test-only
// seam (`e2e/support/endpoint.ts`): the real dispatcher, the real sandbox,
// Worker, and broker, with the app's live lifecycle and approvals. The socket
// itself (bind, Host and Origin, 421/403) is proven by the Rust tests in
// `src-tauri/src/plugins/endpoint.rs`.

import type { Page } from "@playwright/test";
import { dispatchEndpoint } from "../support/endpoint";
import type { PluginSeed } from "../support/storage";
import { expect, test } from "../support/test";

const ENDPOINT = "fixture-endpoint";
/** A Plugin that never holds `serve` beside the serving one, seeded first. */
const OTHER_WITH_ENDPOINT: PluginSeed[] = ["fixture-healthy", ENDPOINT];
/** The paths the fixture answers, spelled out so a change to either side shows here. */
const HELLO = `/plugin/${ENDPOINT}/hello`;
const STREAM = `/plugin/${ENDPOINT}/stream`;
const RECEIVED = `/plugin/${ENDPOINT}/received`;

/** The fixture's report that its Worker runs, so a later 404 is a route answer. */
const running = (page: Page) =>
  page.getByRole("status").filter({ hasText: "endpoint fixture running" });

/** Opens the app and waits for the fixture's Worker to report in. */
async function started(page: Page): Promise<void> {
  await page.goto("/");
  await expect(running(page)).toBeVisible();
}

test.describe("Plugin Endpoint @wf:plugins-endpoint", () => {
  test.describe("a Plugin granted the serve Plugin Permission", () => {
    test.use({
      plugins: [ENDPOINT],
      pluginApprovals: [{ pluginId: ENDPOINT, granted: ["serve"] }],
    });

    test("answers its own path with a whole answer", async ({ page }) => {
      await started(page);

      const answer = await dispatchEndpoint(page, ENDPOINT, HELLO);

      expect(answer.status).toBe(200);
      expect(answer.text).toBe("hello");
      // A whole answer arrives in one piece, so nothing is streamed.
      expect(answer.chunks).toEqual([]);
      expect(answer.headers).toContainEqual(["content-type", "text/plain; charset=utf-8"]);
    });

    test("streams its answer as three chunks in order", async ({ page }) => {
      await started(page);

      const answer = await dispatchEndpoint(page, ENDPOINT, STREAM);

      expect(answer.status).toBe(200);
      expect(answer.chunks).toEqual(["one ", "two ", "three "]);
      expect(answer.text).toBe("one two three ");
    });
  });

  test.describe("a Plugin without the serve grant", () => {
    test.use({
      plugins: [ENDPOINT],
      pluginApprovals: [{ pluginId: ENDPOINT, granted: [] }],
    });

    test("answers 404 while the Plugin itself runs", async ({ page }) => {
      // The report proves the Worker started, so the 404 comes from the missing
      // grant and not from a Plugin that never launched.
      await started(page);

      const answer = await dispatchEndpoint(page, ENDPOINT, HELLO);

      expect(answer.status).toBe(404);
      expect(answer.text).toBe("");
    });
  });

  test.describe("a request naming another Plugin", () => {
    test.use({
      // `fixture-healthy` declares no Plugin Permission, so it starts from its
      // seeded record and never holds `serve`. Seeded first, so its start
      // settles before the serving Plugin's report.
      plugins: OTHER_WITH_ENDPOINT,
      pluginApprovals: [{ pluginId: ENDPOINT, granted: ["serve"] }],
    });

    test("answers 404 for the Plugin that holds no serve grant", async ({ page }) => {
      await started(page);

      const refused = await dispatchEndpoint(page, "fixture-healthy", HELLO);
      expect(refused.status).toBe(404);

      // The serving Plugin answers in the same device state, so the 404 above is
      // the grant talking, not a device where no Plugin is up.
      const served = await dispatchEndpoint(page, ENDPOINT, HELLO);
      expect(served.status).toBe(200);
    });

    test("never reaches the endpoint fixture's handler", async ({ page }) => {
      await started(page);

      expect((await dispatchEndpoint(page, "fixture-healthy", HELLO)).status).toBe(404);
      expect((await dispatchEndpoint(page, ENDPOINT, HELLO)).status).toBe(200);

      const answer = await dispatchEndpoint(page, ENDPOINT, RECEIVED);

      // The fixture reports every path it was handed, oldest first, and takes
      // its snapshot before recording this call.
      expect(answer.status).toBe(200);
      expect(JSON.parse(answer.text)).toEqual([HELLO]);
    });
  });
});
