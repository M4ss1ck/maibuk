// The `fixture-everything` Plugin's network, secrets, and clipboard calls
// (issue #453, unit 6): the Plugin saves a secret, fetches a granted host with
// the secret injected into a declared header and streams the response body in
// chunks, asks an ungranted host and is refused, lists its secret names, and
// round-trips the clipboard. It also drives the web Settings row's "Remember
// credentials on this device" switch and proves the saved name survives a reload
// when remembered and is gone when not.
//
// The Worker-side observed-string check (the page's `Leak:` line) proves the
// secret value never reaches the Plugin: the fixture writes it only in its save
// call, and the spec mirrors that literal only to assert the header the route
// received.
//
// @no-webkit: seeding the Plugin Directory needs OPFS, which the pinned
// Playwright WebKit build lacks (microsoft/playwright#18235; e2e/README.md).

import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

const PLUGIN_NAME = "Fixture Everything";
/** The fixture's required Plugin Permissions, in manifest order. */
const REQUIRED_PERMISSIONS = [
  "library:read",
  "library:write",
  "editor:read",
  "editor:decorate",
  "secrets",
  "network:api.fixture.test",
];
/** The grants the fixture's calls need: the required set plus the optional clipboard. */
const GRANTED_PERMISSIONS = [...REQUIRED_PERMISSIONS, "clipboard"];

const GRANTED_ROUTE = "https://api.fixture.test/**";
const UNGRANTED_ROUTE = "https://evil.fixture.test/**";
const REMEMBER_LABEL = "Remember credentials on this device";
/**
 * The secret value the fixture saves, mirrored here so the spec can assert the
 * injected header strictly. It is the same literal the fixture's `saveSecret`
 * call writes; nothing else in the spec reads it back from the Plugin.
 */
const SECRET_VALUE = "fixture-secret-7c1f9a";
/** The clipboard value the fixture round-trips. */
const CLIPBOARD_MARK = "Clipboard: round trip: fixture clipboard text";

/**
 * The streamed body: two SSE events over 64 KB, so the host hands it back in
 * more than one chunk and only the last event carries the end marker.
 */
const FIRST_EVENT = `event: first\ndata: ${"a".repeat(40_000)}\n\n`;
const LAST_EVENT = `event: second\ndata: ${"b".repeat(40_000)}END-OF-STREAM\n\n`;
const SSE_BODY = FIRST_EVENT + LAST_EVENT;

/** Opens the fixture's page directly, clearing the remembered path first. */
async function openFixturePage(page: Page): Promise<void> {
  await seedSettings(page, { lastPath: null });
  await page.goto("/plugin/fixture-everything/panel");
  await expect(page.getByText("Deterministic content")).toBeVisible({ timeout: 15_000 });
}

/** Tabs to the Plugin page button `name` and activates it. */
async function pressPluginButton(page: Page, name: string): Promise<void> {
  const button = page.getByRole("button", { name, exact: true });
  await expect(button).toBeVisible({ timeout: 15_000 });
  await tabTo(page, button, { max: 60 });
  await page.keyboard.press("Enter");
}

/** The text of the Plugin page line beginning with `prefix`. */
async function readLine(page: Page, prefix: string): Promise<string> {
  const line = page.getByText(new RegExp(`^${prefix}`)).first();
  await expect(line).toBeVisible({ timeout: 15_000 });
  return (await line.textContent()) ?? "";
}

/** Jumps to the Plugins section through the Settings outline, leaving its heading focused. */
async function openPluginsSection(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tree = page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("treegrid", { name: "Settings sections" });
  const pluginsEntry = tree.getByRole("row", { name: /^Plugins(, current)?$/ });
  await expect(tree).toBeVisible();
  for (let i = 0; i < 12; i++) {
    if (await isFocusWithin(tree)) break;
    await page.keyboard.press("Shift+Tab");
  }
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", pluginsEntry, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Plugins" })).toBeFocused();
}

/** Tabs to the Plugin's row and expands it. */
async function expandPluginRow(page: Page): Promise<void> {
  await tabTo(page, page.getByRole("button", { name: new RegExp(`^${PLUGIN_NAME}`) }), {
    max: 30,
  });
  await page.keyboard.press("Enter");
}

/** Expands the nested Permissions accordion inside an open card. */
async function openPermissions(page: Page): Promise<void> {
  const trigger = page.getByRole("button", { name: /Plugin permissions/ });
  await tabTo(page, trigger, { max: 40 });
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

/** Toggles the row's remember switch to `on` from Settings and returns it. */
async function setRemembered(page: Page, on: boolean): Promise<void> {
  await openPluginsSection(page);
  await expandPluginRow(page);
  // The remember switch lives in the nested Permissions accordion.
  await openPermissions(page);
  const remember = page.getByRole("switch", { name: REMEMBER_LABEL });
  await expect(remember).toBeVisible({ timeout: 15_000 });
  await tabTo(page, remember, { max: 40 });
  await page.keyboard.press("Space");
  await expect(remember).toHaveAttribute("aria-checked", String(on));
}

test.describe("fixture-everything secret header injection @wf:plugins-network-secret @sandbox @no-webkit", () => {
  test.use({
    library: "empty",
    plugins: ["fixture-everything"],
    pluginApprovals: [{ pluginId: "fixture-everything", granted: GRANTED_PERMISSIONS }],
  });

  test("injects the stored secret and streams the whole body", async ({ page }) => {
    const seen: Record<string, string>[] = [];
    await page.route(GRANTED_ROUTE, (route) => {
      seen.push(route.request().headers());
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: SSE_BODY });
    });

    await openFixturePage(page);
    await pressPluginButton(page, "Fetch granted host");

    await expect(page.getByText("Status: 200")).toBeVisible();
    // The granted fetch reached the route exactly once, carrying the injected
    // header: the store's value, never the header's secret name. The spec
    // mirrors that value so it can assert it strictly; the Worker-side `Leak:`
    // check below then proves the value never crosses back to the Plugin.
    expect(seen).toHaveLength(1);
    const apiKey = seen[0]["x-api-key"];
    expect(apiKey).toBe(SECRET_VALUE);

    // The whole body arrived, in more than one chunk, and the secret is not
    // anywhere the Worker could observe.
    await expect(page.getByText(`Bytes: ${SSE_BODY.length}`)).toBeVisible();
    const chunks = await readLine(page, "Chunks: ");
    expect(Number(chunks.replace("Chunks: ", ""))).toBeGreaterThan(1);
    const body = await page.locator("code", { hasText: "END-OF-STREAM" }).textContent();
    expect(body).toBe(SSE_BODY);
    await expect(page.getByText("Leak: absent")).toBeVisible();
  });
});

test.describe("fixture-everything ungranted host @wf:plugins-network-refused @sandbox @no-webkit", () => {
  test.use({
    library: "empty",
    plugins: ["fixture-everything"],
    pluginApprovals: [{ pluginId: "fixture-everything", granted: GRANTED_PERMISSIONS }],
  });

  test("refuses an ungranted host and sends no request", async ({ page }) => {
    let hits = 0;
    await page.route(UNGRANTED_ROUTE, (route) => {
      hits += 1;
      return route.fulfill({ status: 200, body: "this must never be reached" });
    });

    await openFixturePage(page);
    await pressPluginButton(page, "Fetch ungranted host");

    await expect(page.getByText("Refusal: permission-denied")).toBeVisible();
    expect(hits).toBe(0);
  });
});

test.describe("fixture-everything clipboard @wf:plugins-clipboard @sandbox @no-webkit", () => {
  test.use({
    library: "empty",
    plugins: ["fixture-everything"],
    pluginApprovals: [{ pluginId: "fixture-everything", granted: GRANTED_PERMISSIONS }],
  });

  test("writes and reads the clipboard", async ({ page, context, browserName }) => {
    let granted = false;
    if (browserName === "chromium") {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      granted = true;
    }

    await openFixturePage(page);
    await pressPluginButton(page, "Clipboard round trip");

    const line = page.getByText(/^Clipboard: /).first();
    await expect(line).not.toHaveText("Clipboard: (not run)", { timeout: 15_000 });
    const text = (await line.textContent()) ?? "";
    if (granted) {
      expect(text).toBe(CLIPBOARD_MARK);
      return;
    }
    // Firefox cannot grant clipboard-read through Playwright ("Unknown
    // permission"), yet its clipboard still round-trips here; a browser that
    // refuses the read draws the broker's typed internal-error instead.
    expect([CLIPBOARD_MARK, "Clipboard: internal-error"]).toContain(text);
  });
});

test.describe("fixture-everything remember switch @wf:plugins-remember-switch @sandbox @no-webkit", () => {
  test.use({
    library: "empty",
    plugins: ["fixture-everything"],
    pluginApprovals: [{ pluginId: "fixture-everything", granted: GRANTED_PERMISSIONS }],
  });

  test("a remembered secret name survives a reload", async ({ page }) => {
    await setRemembered(page, true);
    await capture(page, "plugins-remember-credentials");

    // Save the secret with remembering already on, so it persists to storage.
    await openFixturePage(page);
    await pressPluginButton(page, "Save secret");
    await expect(page.getByText("Saved: yes")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Deterministic content")).toBeVisible({ timeout: 15_000 });
    await pressPluginButton(page, "List secrets");
    await expect(page.getByText("Names: apiKey")).toBeVisible();
  });

  test("an unremembered secret name is gone after a reload", async ({ page }) => {
    // Toggle the switch on and back off, so the Plugin is not remembered.
    await setRemembered(page, true);
    await setRemembered(page, false);

    await openFixturePage(page);
    await pressPluginButton(page, "Save secret");
    await expect(page.getByText("Saved: yes")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Deterministic content")).toBeVisible({ timeout: 15_000 });
    await pressPluginButton(page, "List secrets");
    await expect(page.getByText("Names: (none)")).toBeVisible();
  });
});
