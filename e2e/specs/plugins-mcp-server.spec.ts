// The MCP Server Plugin page (issue #594): turning the Built-in MCP Server on
// from Settings, copying a setup snippet, an Agent connecting with the Key it
// carries, a write reaching the Library, the live Connections list, the
// Activity log, the reconnect notice, and every Plugin Command the manifest
// declares, by keyboard alone.
//
// MCP Server ships desktop-only and this lane drives the production web build,
// so the seed installs the real `plugins/maibuk-mcp` source as a Built-in whose
// built manifest lists "web" for this test only (`plugin-fixtures-build.ts`);
// the shipped manifest is untouched. The web build has no socket either, so
// every HTTP request goes through the E2E lane's test-only seam instead of a
// real one: the real dispatcher, sandbox, Worker, and broker, with the app's
// live lifecycle and approvals (`e2e/support/endpoint.ts`). The issue's "real
// HTTP request" is replaced by that seam here; the socket itself (bind, Host
// and Origin, 421/403) is proven by the Rust tests in
// `src-tauri/src/plugins/endpoint.rs`. The address the page shows, and the move
// that raises the reconnect notice, come from the same seam's listener state.

import type { Locator, Page } from "@playwright/test";
import { readClipboard } from "../support/clipboard";
import { dispatchEndpoint, setEndpointAddress } from "../support/endpoint";
import { expectFocusWithin, isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { SEED_BOOK, SEED_CHAPTERS } from "../support/seed/names";
import { expect, test } from "../support/test";

const PLUGIN_NAME = "MCP Server";
const PLUGIN_ID = "maibuk-mcp";
/** The port the seam reports as bound; the moved one is the reconnect notice. */
const ADDRESS_PORT = 41000;
const MOVED_PORT = 41234;
/** The one Endpoint path MCP Server answers. */
const MCP_PATH = `/plugin/${PLUGIN_ID}/mcp`;
/** The chapter the write appends to, and the Agent that writes it. */
const CHAPTER = SEED_CHAPTERS[0].title;
const AGENT = "Claude Code";
const APPENDED = "The Agent appended this line.";

/** The three required Plugin Permissions, as the card labels them. */
const REQUIRED_LABELS = [
  "Answer requests from apps on this computer · Required to enable this Plugin",
  "Read your Library · Required to enable this Plugin",
  "Use the clipboard · Required to enable this Plugin",
] as const;
/** The optional grant an untouched Built-in is pre-granted too (#442). */
const WRITE_LABEL = "Change your Library · Optional";

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });
const enableSwitch = (page: Page) =>
  page.getByRole("switch", { name: `Enable ${PLUGIN_NAME}`, exact: true });
/** The MCP Server card, by the Settings row id it carries (issue #442). */
const card = (page: Page) => page.locator(`[data-settings-row="pluginCard.${PLUGIN_ID}"]`);
/** The first setup snippet: Claude Code's, the order the page shows. */
const firstSnippet = (page: Page) => page.locator("pre code").first();
/** Every snippet, in the page's order. */
const snippets = (page: Page) => page.locator("pre code");

/** Jumps to the Plugins section through the Settings outline, leaving its heading focused. */
async function openPluginsSection(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  // Instant section jumps: the jump animates otherwise.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tree = page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("treegrid", { name: "Settings sections" });
  const pluginsEntry = tree.getByRole("row", { name: /^Plugins(, current)?$/ });
  await expect(tree).toBeVisible();
  // The outline is the page's last focusable region: Shift+Tab reaches it.
  for (let i = 0; i < 12; i++) {
    if (await isFocusWithin(tree)) break;
    await page.keyboard.press("Shift+Tab");
  }
  await expectFocusWithin(tree);
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", pluginsEntry, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Plugins" })).toBeFocused();
}

/**
 * Turns MCP Server on from its card by keyboard. An untouched Built-in is
 * pre-granted every declared Plugin Permission (the optional `library:write`
 * included), so the switch starts it with no review dialog.
 */
async function turnOn(page: Page): Promise<void> {
  await openPluginsSection(page);
  await expect(card(page)).toBeVisible();
  // The card's disclosure trigger comes first in its header, the switch after.
  const trigger = card(page).getByRole("button").first();
  await tabTo(page, trigger, { max: 40 });
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const toggle = enableSwitch(page);
  await tabTo(page, toggle, { max: 12 });
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await expect(page.getByRole("dialog", { name: "Review access" })).toHaveCount(0);
  // Its sidebar entry appears once the Worker is running.
  await expect(navOption(page, PLUGIN_NAME)).toBeVisible({ timeout: 20_000 });
}

/** Opens the nested Permissions accordion inside the already expanded card. */
async function openPermissions(page: Page): Promise<void> {
  const trigger = page.getByRole("button", { name: /Plugin permissions/ });
  await tabTo(page, trigger, { max: 40 });
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

/** Opens the Command Palette and returns its dialog. */
async function openPalette(page: Page): Promise<Locator> {
  await page.keyboard.press("F1");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Runs one Command from the Command Palette by its label. */
async function runPaletteCommand(page: Page, label: string): Promise<void> {
  const dialog = await openPalette(page);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(label);
  const option = dialog.getByRole("option", { name: label, exact: true });
  await expect(option).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

/** Opens the MCP Server page through its navigating Command. */
async function openMcpPage(page: Page): Promise<void> {
  await runPaletteCommand(page, "Open MCP Server");
  await expect(page).toHaveURL(new RegExp(`/plugin/${PLUGIN_ID}/connect$`));
  await expect(page.getByRole("heading", { name: PLUGIN_NAME, level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect an Agent", level: 2 })).toBeVisible();
}

/**
 * Binds the address the snippets show, the way the desktop supervisor records
 * a listening port. The page is already open and shows the unavailable Status
 * until this lands, so the event reaches a mounted page.
 */
async function bindAddress(page: Page, port: number): Promise<void> {
  await setEndpointAddress(page, port);
  await expect(snippets(page)).toHaveCount(4);
  await expect(snippets(page).first()).toContainText(`http://127.0.0.1:${port}/`);
}

/** Tabs to the first Copy button and presses it, then returns the clipboard text. */
async function copyFirstSnippet(page: Page): Promise<string> {
  const copy = page.getByRole("button", { name: "Copy", exact: true }).first();
  await tabTo(page, copy, { max: 60 });
  await page.keyboard.press("Enter");
  // The write lands on the browser clipboard through the host, so the page's
  // Copied confirmation comes first and the text follows.
  await expect(page.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
  await expect.poll(async () => clipboardText(page), { timeout: 10_000 }).not.toBe("");
  return clipboardText(page);
}

/**
 * The clipboard text, read through the clipboard helper. Chromium refuses a
 * read that races a write ("Clipboard data has changed"), so a transient
 * failure reads as "not written yet" and the caller polls again.
 */
async function clipboardText(page: Page): Promise<string> {
  try {
    return (await readClipboard(page)).text;
  } catch {
    return "";
  }
}

/** The Key a snippet carries as its Bearer token. */
function keyOf(snippetText: string): string {
  const match = /Bearer ([0-9a-f]{64})/.exec(snippetText);
  if (match === null) throw new Error(`no Key in the snippet: ${snippetText}`);
  return match[1];
}

/** The Key the first snippet carries, or null while it still renders none. */
function keyOrNull(snippetText: string): string | null {
  return /Bearer ([0-9a-f]{64})/.exec(snippetText)?.[1] ?? null;
}

/** The first snippet's text right now. */
async function snippetTextOf(page: Page): Promise<string> {
  return (await firstSnippet(page).textContent()) ?? "";
}

/** One JSON-RPC request the Agent sends through the seam. */
async function mcpRequest(
  page: Page,
  key: string | null,
  body: unknown
): Promise<{ status: number; json: any; text: string }> {
  const headers: [string, string][] = [
    ["content-type", "application/json"],
    ["accept", "application/json, text/event-stream"],
  ];
  if (key !== null) headers.push(["authorization", `Bearer ${key}`]);
  const answer = await dispatchEndpoint(page, PLUGIN_ID, MCP_PATH, "POST", {
    headers,
    body: JSON.stringify(body),
  });
  // The SDK answers JSON or one SSE frame; the last data line is the message.
  const frames = answer.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"));
  const payload =
    frames.length > 0 ? frames[frames.length - 1].slice("data:".length).trim() : answer.text.trim();
  let json: any = null;
  try {
    json = payload === "" ? null : JSON.parse(payload);
  } catch {
    json = null;
  }
  return { status: answer.status, json, text: answer.text };
}

/** The legacy `initialize` handshake, self-reporting the Agent's name. */
function initializeBody(id = 1): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: AGENT, version: "1.0.0" },
    },
  };
}

/** One legacy `tools/call` body. */
function toolsCallBody(name: string, args: unknown, id = 2): unknown {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

/** The text one `tools/call` answered with. */
function toolText(json: any): string {
  const content = json?.result?.content;
  if (!Array.isArray(content)) throw new Error(`no tool content in ${JSON.stringify(json)}`);
  return content.map((item: { text?: string }) => item.text ?? "").join("");
}

/** The only Book in the seeded Library, by the short id the tool printed. */
function firstBookId(listText: string): string {
  // The list opens with a "Books 1-1 of 1" header; a row is "<id>  <title> …".
  const match = /^(\S+)\s{2}/m.exec(listText);
  if (match === null) throw new Error(`no Book id in ${listText}`);
  return match[1];
}

/** The named Chapter's short id, from the Book's Chapter list. */
function chapterIdOf(bookText: string, title: string): string {
  const pattern = new RegExp(`^\\d+\\.\\s+(\\S+)\\s{2}${title}\\b`, "m");
  const match = pattern.exec(bookText);
  if (match === null) throw new Error(`no ${title} id in ${bookText}`);
  return match[1];
}

test.use({
  library: "oneBookThreeChapters",
  plugins: [PLUGIN_ID],
  builtInPlugins: [{ id: PLUGIN_ID }],
  // The snippets and the copy Commands write the real browser clipboard.
  permissions: ["clipboard-read", "clipboard-write"],
});

test.describe("MCP Server page @wf:plugins-mcp-server @chromium-only", () => {
  test("turning it on pre-grants every permission, and a copied snippet carries the address and Key @sc:plugin.maibuk-mcp.openConnect", async ({
    page,
  }) => {
    await turnOn(page);

    // The Built-in card lists the three required grants and the optional
    // `library:write` it was pre-granted, so the write tools work out of the box.
    await openPermissions(page);
    for (const label of REQUIRED_LABELS) {
      const grant = page.getByRole("checkbox", { name: label, exact: true });
      await expect(grant).toBeChecked();
      await expect(grant).toBeDisabled();
    }
    const writeGrant = page.getByRole("checkbox", { name: WRITE_LABEL, exact: true });
    await expect(writeGrant).toBeChecked();
    await expect(writeGrant).toBeEnabled();

    await openMcpPage(page);
    // The web build has no socket, so until the seam binds an address the page
    // says there is none.
    await expect(
      page.getByText("The Plugin Endpoint is not available, so there is no address to connect to yet.")
    ).toBeVisible();
    await bindAddress(page, ADDRESS_PORT);

    const snippetText = await copyFirstSnippet(page);
    const key = keyOf(snippetText);
    expect(snippetText).toContain(`http://127.0.0.1:${ADDRESS_PORT}/plugin/${PLUGIN_ID}/mcp`);
    expect(snippetText).toContain(`claude mcp add --transport http maibuk`);
    // The page shows the same text it put on the clipboard.
    await expect(firstSnippet(page)).toHaveText(snippetText);
    await expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  test("an Agent that connects appears in Live Connections, the indicator says connected, and the Activity log holds its call", async ({
    page,
  }) => {
    await turnOn(page);
    await openMcpPage(page);
    await bindAddress(page, ADDRESS_PORT);
    await expect(page.getByText("No Agents connected", { exact: true })).toBeVisible();

    const key = keyOf(await copyFirstSnippet(page));
    const initialized = await mcpRequest(page, key, initializeBody());
    expect(initialized.status, initialized.text).toBe(200);
    expect(initialized.json.result.serverInfo.name).toBe("maibuk");

    const listed = await mcpRequest(page, key, toolsCallBody("list_books", {}));
    expect(listed.status, listed.text).toBe(200);
    expect(toolText(listed.json)).toContain(SEED_BOOK.title);

    // The Agent's Connection is live, named by the initialize it borrowed.
    const connections = page.getByRole("table", { name: "Live Connections" });
    await expect(connections.getByRole("cell", { name: AGENT, exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Connected: 1 Agent", { exact: true })).toBeVisible();

    // The call landed in the Activity log with its tool and Agent.
    const activity = page.getByRole("table", { name: "Activity log" });
    const call = activity.getByRole("row", { name: new RegExp(AGENT) }).filter({
      has: page.getByRole("cell", { name: "list_books", exact: true }),
    });
    await expect(call).toHaveCount(1);
    await expect(call.getByRole("cell", { name: "OK", exact: true })).toBeVisible();
  });

  test("a write through the Endpoint changes the Library, and the open Chapter shows it", async ({
    page,
  }) => {
    await turnOn(page);
    await openMcpPage(page);
    await bindAddress(page, ADDRESS_PORT);
    const key = keyOf(await copyFirstSnippet(page));

    const initialized = await mcpRequest(page, key, initializeBody());
    expect(initialized.status, initialized.text).toBe(200);

    const listed = await mcpRequest(page, key, toolsCallBody("list_books", {}));
    expect(listed.status, listed.text).toBe(200);
    const bookId = firstBookId(toolText(listed.json));

    const book = await mcpRequest(page, key, toolsCallBody("get_book", { book: bookId }));
    expect(book.status, book.text).toBe(200);
    const chapterId = chapterIdOf(toolText(book.json), CHAPTER);

    const edited = await mcpRequest(
      page,
      key,
      toolsCallBody("edit_chapter", { chapter: chapterId, append: APPENDED }, 3)
    );
    expect(edited.status, edited.text).toBe(200);
    expect(edited.json.result.isError).not.toBe(true);

    // The Activity log names the write, with none of the author's text in it.
    // It lives on the Plugin page, so it is read before leaving for the Book.
    const activity = page.getByRole("table", { name: "Activity log" });
    await expect(
      activity.getByRole("cell", { name: "edit_chapter", exact: true })
    ).toBeVisible({ timeout: 10_000 });
    await expect(activity.getByRole("cell", { name: APPENDED })).toHaveCount(0);

    // The whole Library change is visible: the Chapter opens with the text the
    // Agent appended, after the text the seed gave it.
    const dialog = await openPalette(page);
    await page.keyboard.type(CHAPTER);
    const option = dialog.getByRole("option", { name: new RegExp(CHAPTER) }).first();
    await expect(option).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/book\/[^/]+$/);
    const chapterText = page.getByRole("textbox", { name: `Text of ${CHAPTER}` });
    await expect(chapterText).toContainText(SEED_CHAPTERS[0].text);
    await expect(chapterText).toContainText(APPENDED);
  });

  test("a moved address raises the reconnect notice with refreshed snippets, and Done dismisses it", async ({
    page,
  }) => {
    await turnOn(page);
    await openMcpPage(page);
    await bindAddress(page, ADDRESS_PORT);

    // The author copies the current snippet; the page has stored the address
    // it showed, so the move that follows reads as a change.
    const before = await copyFirstSnippet(page);
    expect(before).toContain(`:${ADDRESS_PORT}/`);

    await setEndpointAddress(page, MOVED_PORT);
    const notice = page.getByText(
      "Maibuk's address changed. Copy the refreshed snippet into each Agent to reconnect.",
      { exact: true }
    );
    await expect(notice).toBeVisible();
    // Every snippet was refreshed in place with the new address, Key unchanged.
    for (const text of await snippets(page).allTextContents()) {
      expect(text).toContain(`http://127.0.0.1:${MOVED_PORT}/`);
      expect(text).toContain(keyOf(before));
    }

    const done = page.getByRole("button", { name: "Done", exact: true });
    await tabTo(page, done, { max: 40 });
    await page.keyboard.press("Enter");
    await expect(notice).toBeHidden();
    // The snippets keep the moved address after the notice is dismissed.
    await expect(firstSnippet(page)).toContainText(`http://127.0.0.1:${MOVED_PORT}/`);
  });

  test("the Plugin Commands make a new Key that refuses the old one, copy each Agent's snippet @sc:plugin.maibuk-mcp.newKey @sc:plugin.maibuk-mcp.copyClaudeCode @sc:plugin.maibuk-mcp.copyCodex @sc:plugin.maibuk-mcp.copyOpenCode @sc:plugin.maibuk-mcp.copyCursor", async ({
    page,
  }) => {
    await turnOn(page);
    await openMcpPage(page);
    await bindAddress(page, ADDRESS_PORT);

    const first = await copyFirstSnippet(page);
    const oldKey = keyOf(first);
    const firstSnippets = await snippets(page).allTextContents();

    // Make a New MCP Server Key rotates the Key in place on the open page.
    await runPaletteCommand(page, "Make a New MCP Server Key");
    await expect(page).toHaveURL(new RegExp(`/plugin/${PLUGIN_ID}/connect$`));
    await expect.poll(async () => keyOrNull(await snippetTextOf(page))).not.toBe(oldKey);
    const newKey = keyOf(await snippetTextOf(page));
    expect(newKey).not.toBe(oldKey);
    // Every snippet was rebuilt: the old text is gone, the new Key is in it.
    const rotated = await snippets(page).allTextContents();
    expect(rotated).toHaveLength(firstSnippets.length);
    for (const text of rotated) {
      expect(text).not.toContain(oldKey);
      expect(text).toContain(`Bearer ${newKey}`);
    }

    // The old Key is cut off through the Endpoint; the new one answers.
    const refused = await mcpRequest(page, oldKey, initializeBody(11));
    expect(refused.status).toBe(401);
    expect(refused.json.error.message).toContain("The Key is missing or old");
    expect((await mcpRequest(page, newKey, initializeBody(12))).status).toBe(200);

    // Each copy Command puts its own Agent's snippet, with this address and
    // Key, on the clipboard.
    const copies: { command: string; marker: string }[] = [
      {
        command: "Copy the Claude Code setup snippet",
        marker: "claude mcp add --transport http maibuk",
      },
      { command: "Copy the Codex setup snippet", marker: "[mcp_servers.maibuk]" },
      {
        command: "Copy the OpenCode setup snippet",
        marker: '"$schema": "https://opencode.ai/config.json"',
      },
      { command: "Copy the Cursor setup snippet", marker: '"mcpServers"' },
    ];
    for (const { command, marker } of copies) {
      await runPaletteCommand(page, command);
      await expect.poll(async () => clipboardText(page), { timeout: 10_000 }).toContain(marker);
      const text = await clipboardText(page);
      expect(text).toContain(marker);
      expect(text).toContain(`http://127.0.0.1:${ADDRESS_PORT}/plugin/${PLUGIN_ID}/mcp`);
      expect(text).toContain(`Bearer ${newKey}`);
      expect(text).not.toContain(oldKey);
    }
  });
});
