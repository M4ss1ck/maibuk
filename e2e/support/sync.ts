// The Sync lane's fixtures (issue #222). Every test gets a fresh Sync Account
// on the run's PocketBase (run-sync.mjs starts it and passes E2E_SYNC_URL),
// deleted afterwards, and can open more devices: each one its own browser
// context, prepared and hermetic like `page`. The keyboard helpers drive the
// same UI an author uses. Nothing here logs an email, password, token,
// Passphrase, or note content.

import { randomBytes, randomUUID } from "node:crypto";
import type { BrowserContext, Locator, Page, Route } from "@playwright/test";
import { pressUntilFocused, tabTo } from "./keyboard";
import { type LibrarySeed, prepareDevice, seedSettings } from "./storage";
import { expect, makeHermetic, test as base } from "./test";

export interface SyncAccount {
  email: string;
  password: string;
  passphrase: string;
}

interface SyncWorkerFixtures {
  syncServer: { url: string; superuserToken: string };
}

interface SyncFixtures {
  /**
   * "Sync automatically" on every device of the test. Off by default: a 30 s
   * idle run or a launch run landing mid-test would race the step under test.
   * The sync-auto row turns it on.
   */
  autoSync: boolean;
  syncUrl: string;
  account: SyncAccount;
  /** Another device: a fresh browser context with its own Library. */
  openDevice: (options?: { library?: LibrarySeed }) => Promise<Page>;
}

async function api(url: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const { token, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: token } : {}),
    },
  });
  if (!res.ok) {
    // The status and path only: a body can echo submitted credentials.
    throw new Error(
      `sync server: ${rest.method ?? "GET"} ${new URL(url).pathname} -> ${res.status}`
    );
  }
  return res;
}

export const test = base.extend<SyncFixtures, SyncWorkerFixtures>({
  syncServer: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this destructuring; it has none.
    async ({}, use) => {
      const url = process.env.E2E_SYNC_URL;
      const email = process.env.E2E_SYNC_SUPERUSER_EMAIL;
      const password = process.env.E2E_SYNC_SUPERUSER_PASSWORD;
      if (!url || !email || !password) {
        throw new Error("No sync server: run the Sync lane with `pnpm test:e2e:sync`");
      }
      const res = await api(`${url}/api/collections/_superusers/auth-with-password`, {
        method: "POST",
        body: JSON.stringify({ identity: email, password }),
      });
      const { token } = (await res.json()) as { token: string };
      await use({ url, superuserToken: token });
    },
    { scope: "worker" },
  ],

  autoSync: [false, { option: true }],

  page: async ({ page, autoSync }, use) => {
    await seedSettings(page, { autoSync }, { once: true });
    await use(page);
  },

  syncUrl: async ({ syncServer }, use) => {
    await use(syncServer.url);
  },

  account: async ({ syncServer }, use) => {
    const account: SyncAccount = {
      email: `author-${randomUUID().slice(0, 12)}@maibuk.test`,
      password: randomBytes(12).toString("base64url"),
      passphrase: `pass-${randomBytes(9).toString("base64url")}`,
    };
    const res = await api(`${syncServer.url}/api/collections/users/records`, {
      method: "POST",
      token: syncServer.superuserToken,
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        passwordConfirm: account.password,
        verified: true,
      }),
    });
    const { id } = (await res.json()) as { id: string };
    await use(account);
    // Cascades to the account's objects; the run's data directory goes anyway.
    await api(`${syncServer.url}/api/collections/users/records/${id}`, {
      method: "DELETE",
      token: syncServer.superuserToken,
    }).catch(() => {});
  },

  openDevice: async (
    {
      browser,
      autoSync,
      baseURL,
      viewport,
      locale,
      timezoneId,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
    },
    use
  ) => {
    const contexts: BrowserContext[] = [];
    await use(async ({ library = "empty" } = {}) => {
      const context = await browser.newContext({
        baseURL,
        viewport,
        locale,
        timezoneId,
        userAgent,
        deviceScaleFactor,
        isMobile,
        hasTouch,
      });
      contexts.push(context);
      await makeHermetic(context);
      const page = await context.newPage();
      await prepareDevice(page, { library, tutorial: "dismissed" });
      await seedSettings(page, { autoSync }, { once: true });
      return page;
    });
    for (const context of contexts) await context.close();
  },
});

export { expect };

// ---------------------------------------------------------------------------
// Keyboard helpers

/** Selects whatever the focused field holds and types `text` over it. */
async function typeOver(page: Page, text: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
}

export const syncSection = (page: Page): Locator =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "Sync", level: 2 }) });

export const loginButton = (page: Page): Locator =>
  syncSection(page).getByRole("button", { name: "Log In", exact: true });

export const authDialog = (page: Page, title = "Log In"): Locator =>
  page.getByRole("dialog", { name: title });

/** Settings' Sync button (not the popover's). */
export const syncButton = (page: Page): Locator =>
  syncSection(page).getByRole("button", { name: /^(Sync|Syncing\.\.\.)$/ });

export const passphraseDialog = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Enter Passphrase" });

/** The Sync log's header button, "Sync log (<n>)", which collapses and expands it. */
export const logHeader = (scope: Page | Locator): Locator =>
  scope.getByRole("button", { name: /^Sync log/ });

/** The Sync log's entries, newest first: the paragraphs under its header. */
export const logEntries = (scope: Page | Locator): Locator =>
  logHeader(scope).locator("xpath=..").locator("p");

export async function openSettings(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

/** Settings by the g s sequence: no reload, so this launch's Sync log stays. */
export async function gotoSettingsInApp(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.keyboard.press("g");
  await page.keyboard.press("s");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

/**
 * Fills the open Log In (or Sign Up) dialog and submits it with its footer
 * button: the form has no submit button of its own, so Enter in a field does
 * nothing.
 */
export async function fillAuthDialog(
  page: Page,
  syncUrl: string,
  { email, password }: Pick<SyncAccount, "email" | "password">,
  title = "Log In"
): Promise<void> {
  const dialog = authDialog(page, title);
  await expect(dialog).toBeVisible();
  await tabTo(page, dialog.getByRole("textbox", { name: "Server URL" }), { max: 10 });
  await typeOver(page, syncUrl);
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("textbox", { name: "Email" })).toBeFocused();
  await typeOver(page, email);
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Password", { exact: true })).toBeFocused();
  await typeOver(page, password);
  await tabTo(page, dialog.getByRole("button", { name: title, exact: true }), { max: 10 });
  await page.keyboard.press("Enter");
}

/** Signs in from Settings by keyboard and waits for "Logged in as". */
export async function signIn(page: Page, syncUrl: string, account: SyncAccount): Promise<void> {
  await openSettings(page);
  await tabTo(page, loginButton(page), { max: 80 });
  await page.keyboard.press("Enter");
  await fillAuthDialog(page, syncUrl, account);
  await expect(authDialog(page)).toBeHidden();
  await expect(syncSection(page).getByText(`Logged in as ${account.email}`)).toBeVisible();
}

/** Types the Passphrase into the open dialog, confirms it with Enter, and closes it. */
export async function enterPassphrase(page: Page, passphrase: string): Promise<void> {
  const dialog = passphraseDialog(page);
  await expect(dialog).toBeVisible();
  const field = dialog.getByLabel("Encryption Passphrase");
  await expect(field).toBeFocused();
  await page.keyboard.type(passphrase);
  await page.keyboard.press("Enter");
  // The footer Close, not the header's X (also named Close); both run the sync.
  const close = dialog.getByRole("button", { name: "Close", exact: true }).last();
  await tabTo(page, close, { max: 10 });
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

/**
 * Presses Settings' Sync button and, when the Passphrase is not set yet this
 * session, enters it. Waits for the run to finish: the button reads "Sync"
 * again and the log holds `until` (a text or pattern), when given.
 */
export async function syncFromSettings(
  page: Page,
  { passphrase, until }: { passphrase?: string; until?: string | RegExp } = {}
): Promise<void> {
  await tabTo(page, syncButton(page), { max: 80 });
  await page.keyboard.press("Enter");
  if (passphrase) await enterPassphrase(page, passphrase);
  await expect(syncButton(page)).toHaveText("Sync", { timeout: 20_000 });
  if (until)
    await expect(logEntries(syncSection(page)).filter({ hasText: until }).first()).toBeVisible();
}

/** Signs in and runs the first Sync, Passphrase included. */
export async function signInAndSync(
  page: Page,
  syncUrl: string,
  account: SyncAccount,
  until?: string | RegExp
): Promise<void> {
  await signIn(page, syncUrl, account);
  await syncFromSettings(page, { passphrase: account.passphrase, until });
}

/** Opens a React Aria Select in the Sync section by keyboard and picks `option`. */
export async function chooseSyncOption(
  page: Page,
  select: "Scope" | "Direction",
  option: string
): Promise<void> {
  const trigger = syncSection(page).getByRole("button", { name: new RegExp(`${select}$`) });
  await tabTo(page, trigger, { max: 80 });
  await page.keyboard.press("Enter");
  const target = page.getByRole("option", { name: option, exact: true });
  await pressUntilFocused(page, "ArrowDown", target, { max: 8 }).catch(async () => {
    await pressUntilFocused(page, "ArrowUp", target, { max: 8 });
  });
  await page.keyboard.press("Enter");
  await expect(trigger).toContainText(option);
}

// ---------------------------------------------------------------------------
// Network faults at the sync server boundary. Each returns a function that
// lifts the fault.

const objectsRoute = (syncUrl: string) => `${syncUrl}/api/collections/objects/**`;

/** Answers every objects API request with `status`, as a failing proxy would. */
export async function failObjectsApi(
  page: Page,
  syncUrl: string,
  status = 503
): Promise<() => Promise<void>> {
  const handler = (route: Route) =>
    route.fulfill({ status, contentType: "text/plain", body: "Service Unavailable" });
  await page.context().route(objectsRoute(syncUrl), handler);
  return () => page.context().unroute(objectsRoute(syncUrl), handler);
}

/**
 * Holds objects API requests until `release` is called, like a server that
 * answers slowly. `held` resolves when the first request arrives.
 */
export async function holdObjectsApi(
  page: Page,
  syncUrl: string
): Promise<{ held: Promise<void>; release: () => Promise<void> }> {
  let releaseAll!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });
  let arrived!: () => void;
  const held = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const handler = async (route: Route) => {
    arrived();
    await gate;
    await route.continue();
  };
  await page.context().route(objectsRoute(syncUrl), handler);
  return {
    held,
    release: async () => {
      releaseAll();
      await page.context().unroute(objectsRoute(syncUrl), handler);
    },
  };
}

/** Counts requests that reach the objects API from `page`'s device. */
export function countObjectsRequests(page: Page, syncUrl: string): () => number {
  let count = 0;
  page.context().on("request", (request) => {
    if (request.url().startsWith(`${syncUrl}/api/collections/objects/`)) count++;
  });
  return () => count;
}

// ---------------------------------------------------------------------------
// Books by keyboard

export const bookCard = (page: Page, title: string): Locator =>
  page.getByRole("grid", { name: "Books" }).getByRole("row", { name: title });

export const chapterText = (page: Page): Locator =>
  page.getByRole("textbox", { name: /^Text of / });

/**
 * Home by a fresh load. Loading "/" restores the last visited screen, which may
 * be a Book Editor that moves focus into the text a beat later (and would take
 * g p as typing), so load Settings, where nothing takes focus, and g p from it.
 */
export async function openHome(page: Page): Promise<void> {
  await openSettings(page);
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
}

/**
 * Opens the first Book from Home (key 1, Enter); focus lands in its open
 * Chapter's text once the stored text `expected` has loaded.
 */
export async function openFirstBook(page: Page, title: string, expected: string): Promise<void> {
  await openHome(page);
  await expect(bookCard(page, title)).toBeVisible();
  await page.keyboard.press("1");
  await expect(bookCard(page, title)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect(chapterText(page)).toBeFocused();
  await expect(chapterText(page)).toContainText(expected);
}

/** Types `text` at the end of the focused Chapter and saves it with Mod+S. */
export async function appendAndSave(page: Page, text: string): Promise<void> {
  await expect(chapterText(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

/** Deletes the open Book through Book Settings > Danger Zone; lands on Home. */
export async function deleteOpenBook(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  const trigger = page.getByRole("button", { name: "Book Settings" });
  await tabTo(page, trigger, { max: 80, backwards: true });
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Book Settings" });
  await expect(dialog.getByRole("textbox", { name: "Book Title" })).toBeFocused();
  await tabTo(page, dialog.getByRole("button", { name: "Danger Zone" }));
  await page.keyboard.press("Enter");
  await tabTo(page, dialog.getByRole("button", { name: "Delete Book" }));
  await page.keyboard.press("Enter");
  const confirm = dialog.getByRole("group", { name: /Are you sure you want to delete this book/ });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirm.getByRole("button", { name: "Yes, delete book" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
}
