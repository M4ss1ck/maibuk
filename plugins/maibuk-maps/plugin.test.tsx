/**
 * The Maps page (#744) through the supported Plugin test kit: the real broker,
 * in-memory Plugin storage and Library, and the host's Remote UI renderer.
 * Every action is reached with `user-event` key presses and asserted by what
 * the host drew and stored. `index.tsx` (the Worker bootstrap) is never imported.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";
import { createTestHost } from "@/features/plugins/test-kit";
import type { TestHost, TestPdfFont } from "@/features/plugins/types";
import {
  registerPluginCommands,
  type CommandId,
  type PluginCommandDeclaration,
} from "@/lib/shortcut-registry";
import { effectiveShortcuts } from "@/lib/shortcut-resolve";
import { useShortcuts } from "@/lib/shortcuts";
import { createPluginClient, type PluginClient, type PluginFrame } from "@/plugin-sdk";
import { PLUGIN_COMMAND_RUN_REQUEST, PLUGIN_MIGRATE_DATA_REQUEST } from "@/plugin-sdk/protocol";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import { DEFAULT_SOFT_EDGE_MM, SOFT_EDGE_STEP_MM } from "./editor";
import type { FrameFontMessage } from "./frame-protocol";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import { format } from "./i18n";
import {
  DEFAULT_FILL_COLOR,
  DEFAULT_LABEL_FONT,
  INDEX_KEY,
  MAP_LABEL_FONT_FAMILIES,
  mapKey,
  newLabel,
  type MapDocument,
  type MapElement,
  type MapFillContent,
  type MapFillElement,
  type MapIndexEntry,
  type MapLabelElement,
  type MapLineElement,
  type MapStampElement,
} from "./maps";
import {
  BOOK_MAPS,
  MAP_PAGE_ID,
  MAPS_PAGE_ID,
  MOVE_RIGHT,
  OPEN_MAPS,
  startMaps,
  type MapsRuntime,
} from "./runtime";
import { DEFAULT_SCATTER_SPACING_MM } from "./scatter";
import { smoothStroke } from "./scene";
import { linePath, roughen, seedFor, shapeOutline } from "./geometry";

type User = ReturnType<typeof userEvent.setup>;

/**
 * The Map Frame's own files (#750), read from the Plugin folder: the keyboard
 * test below runs the real `assets/ui/map.js`, so its crosshair answers real
 * key presses and posts the real messages the open editor keeps.
 */
const FRAME_LIBRARY = readFileSync(
  join(__dirname, "assets/ui/lib/htm-preact-standalone.umd.js"),
  "utf8"
);
const FRAME_SCRIPT = readFileSync(join(__dirname, "assets/ui/map.js"), "utf8");

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function mapsManifest() {
  const result = parsePluginManifest(readFileSync(join(__dirname, "manifest.json"), "utf8"), {
    builtIn: true,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.manifest;
}

function book(id: string, title: string) {
  return {
    id,
    title,
    subtitle: null,
    authorName: "Ana",
    genre: null,
    language: "en",
    wordCount: 0,
    targetWordCount: null,
    status: "draft" as const,
    updatedAt: 1,
  };
}

const BOOKS = [book("b1", "Tides of Ash"), book("b2", "The Salt Road")];

function entry(id: string, name: string, bookId: string | null, updatedAt: number): MapIndexEntry {
  return {
    id,
    bookId,
    name,
    preset: "portrait",
    updatedAt,
    preview: "data:image/svg+xml,%3Csvg%2F%3E",
  };
}

/** A storage holding two Maps of the first Book and one with no Book. */
function seededStorage(): Map<string, unknown> {
  const rows = [
    entry("m1", "Coast", "b1", 30),
    entry("m2", "Isles", "b1", 20),
    entry("m3", "Loose", null, 10),
  ];
  const storage = new Map<string, unknown>([[INDEX_KEY, rows]]);
  for (const row of rows) {
    storage.set(mapKey(row.id), {
      id: row.id,
      name: row.name,
      bookId: row.bookId,
      page: { preset: "portrait", widthMm: 152.4, heightMm: 228.6 },
      elements: [],
    });
  }
  return storage;
}

function hostFor(storage = new Map<string, unknown>(), language = "en") {
  const host = createTestHost({
    manifest: mapsManifest(),
    library: { books: BOOKS },
    storage,
    language,
  });
  startMaps(createPluginClient(host.port), servePluginUi);
  return host;
}

/** A host, its runtime, and the Frame handoff handler the Plugin registered. */
function frameHostFor(storage: Map<string, unknown>, pdfFonts: TestPdfFont[] = []) {
  const host = createTestHost({
    manifest: mapsManifest(),
    library: { books: BOOKS },
    storage,
    language: "en",
    pdfFonts,
  });
  const handlers: Array<(frame: PluginFrame) => void> = [];
  const client = createPluginClient(host.port);
  const wrapped = new Proxy(client, {
    get(target, property, receiver) {
      if (property === "onFrame") {
        return (handler: (frame: PluginFrame) => void) => {
          handlers.push(handler);
          return target.onFrame(handler);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as PluginClient;
  const runtime = startMaps(wrapped, servePluginUi);
  return {
    host,
    runtime,
    handoff(frameId: string, port: MessagePort): void {
      for (const handler of handlers) handler({ id: frameId, src: "", port });
    },
  };
}

/** A MessagePort stand-in that records every scene posted to it. */
function recordingPort(): { port: MessagePort; messages: unknown[] } {
  const messages: unknown[] = [];
  const port = {
    onmessage: null,
    start: () => {},
    postMessage: (message: unknown) => messages.push(message),
  } as unknown as MessagePort;
  return { port, messages };
}

/** Whether one recorded Frame message carries the author's PDF Font. */
function isFontMessage(message: unknown): message is FrameFontMessage {
  return (message as { kind?: unknown } | null)?.kind === "font";
}

/**
 * The real Map Frame (#750), loaded into this document so a keyboard test can
 * drive its crosshair with real key presses and read what it posts. The two
 * ports stand for the ends of the Frame's MessageChannel: every message the
 * Frame posts reaches the open editor, and every scene the editor sends reaches
 * the Frame. Returns the port the editor draws into.
 *
 * The Frame's own `#surface` is added to the document's body rather than
 * replacing it, so the page around this test keeps the body its queries hold.
 */
function loadMapFrame(runtime: MapsRuntime): MessagePort {
  const surface = document.createElement("div");
  surface.id = "surface";
  document.body.appendChild(surface);
  const framePort = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    start: () => {},
    postMessage: (message: unknown) => runtime.editor?.handleFrameMessage(message),
  };
  const workerPort = {
    onmessage: null,
    start: () => {},
    postMessage: (message: unknown) => framePort.onmessage?.({ data: message } as MessageEvent),
  } as unknown as MessagePort;
  (window as unknown as { maibuk: unknown }).maibuk = { port: framePort };
  // The script hands back its cleanup through the same test seam the Frame's
  // own tests use, so its document listeners and surface never outlive it.
  (globalThis as Record<string, unknown>).__mapTestHooks = {
    onReady: (cleanup: () => void) =>
      cleanups.push(() => {
        cleanup();
        surface.remove();
        delete (window as unknown as { maibuk?: unknown }).maibuk;
      }),
  };
  try {
    new Function(FRAME_LIBRARY)();
    new Function(FRAME_SCRIPT)();
  } finally {
    delete (globalThis as Record<string, unknown>).__mapTestHooks;
  }
  return workerPort;
}

/** A host and the runtime that owns the open Map, for the editor tests. */
function editorHostFor(storage: Map<string, unknown>, language = "en") {
  const host = createTestHost({
    manifest: mapsManifest(),
    library: { books: BOOKS },
    storage,
    language,
  });
  const runtime = startMaps(createPluginClient(host.port), servePluginUi);
  return { host, runtime };
}

function line(
  id: string,
  name: string,
  points: [number, number][],
  extra: Partial<MapLineElement> = {}
): MapLineElement {
  return {
    id,
    kind: "line",
    name,
    hidden: false,
    locked: false,
    points,
    style: "plain",
    enclosesFills: true,
    closed: false,
    curves: points.slice(1).map(() => true),
    roughened: false,
    ...extra,
  };
}

/** An Area Fill covering its own square outline, which the properties panel edits. */
function areaFill(content: MapFillContent): MapFillElement {
  return {
    id: "f1",
    kind: "fill",
    name: "Fill 1",
    hidden: false,
    locked: false,
    anchor: [50, 50],
    outline: {
      points: [
        [10, 10],
        [90, 10],
        [90, 90],
        [10, 90],
      ],
      curves: [false, false, false, false],
      roughened: false,
    },
    content,
  };
}

/** One Map, `m1`, holding `elements`. */
function mapStorage(elements: MapElement[]): Map<string, unknown> {
  const storage = new Map<string, unknown>([[INDEX_KEY, [entry("m1", "Coast", "b1", 30)]]]);
  storage.set(mapKey("m1"), {
    id: "m1",
    name: "Coast",
    bookId: "b1",
    page: { preset: "portrait", widthMm: 152.4, heightMm: 228.6 },
    elements,
    styleId: "atlas",
    overrides: {},
    createdAt: 1,
    updatedAt: 1,
    dataVersion: 1,
  } satisfies MapDocument);
  return storage;
}

function storedMap(storage: Map<string, unknown>): MapDocument {
  return storage.get(mapKey("m1")) as MapDocument;
}

/** Registers the manifest's Commands so the harness can bind their keys. */
function registerMapCommands(): void {
  cleanups.push(
    registerPluginCommands("maibuk-maps", {
      defaultLanguage: "en",
      pages: ["maps", "map"],
      commands: (mapsManifest().contributes?.commands ?? []) as PluginCommandDeclaration[],
    })
  );
}

/** The host's PluginCommands stand-in: the same registry ids and `useShortcuts`. */
function CommandKeys({ host }: { host: TestHost }) {
  const commands = (mapsManifest().contributes?.commands ?? []) as PluginCommandDeclaration[];
  useShortcuts(
    commands
      .filter((command) => command.contexts.includes("map"))
      .map((command) => ({
        id: `plugin.maibuk-maps.${command.id}` as CommandId,
        onTrigger: () => {
          void host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: command.id });
        },
      }))
  );
  return null;
}

/** Renders the Map editor for an open Map and returns the runtime. */
async function openEditor(
  storage: Map<string, unknown>,
  language = "en"
): Promise<{ host: TestHost; runtime: MapsRuntime }> {
  const { host, runtime } = editorHostFor(storage, language);
  expect(await runtime.openMap("m1")).toBe(true);
  return { host, runtime };
}

/** Focuses a row in the Elements list by keyboard and selects it with Space. */
async function selectRow(user: User, name: string): Promise<HTMLElement> {
  const list = await screen.findByRole("listbox", { name: en["elements.label"] });
  const row = within(list).getByRole("option", { name: new RegExp(`^${name}`) });
  for (let i = 0; i < 60 && !list.contains(document.activeElement); i++) await user.tab();
  await user.keyboard("{Home}");
  for (let i = 0; i < 10 && document.activeElement !== row; i++) await user.keyboard("{ArrowDown}");
  if (row.getAttribute("aria-selected") !== "true") await user.keyboard(" ");
  await waitFor(() => expect(row).toHaveAttribute("aria-selected", "true"));
  return row;
}

/** Opens the focused row's Item Menu and runs one entry by keyboard. */
async function chooseRowMenu(user: User, label: string): Promise<void> {
  await user.keyboard("{Shift>}{F10}{/Shift}");
  const menu = await screen.findByRole("menu");
  await user.keyboard("{Home}");
  const target = within(menu).getByRole("menuitem", { name: label });
  for (let i = 0; i < 10 && document.activeElement !== target; i++)
    await user.keyboard("{ArrowDown}");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
}

/** Focuses a plain host button, away from the Elements list's own arrows. */
async function focusPanelButton(user: User): Promise<HTMLElement> {
  const button = screen.getByRole("button", { name: en["map.backToMaps"] });
  await tabTo(user, button, 60);
  return button;
}

function linePoints(storage: Map<string, unknown>, index = 0): [number, number][] {
  const element = storedMap(storage).elements[index] as MapLineElement;
  return element.points.map(([x, y]) => [x, y]);
}

async function tabTo(user: User, element: HTMLElement, max = 40): Promise<void> {
  for (let i = 0; i < max && document.activeElement !== element; i++) await user.tab();
}

/** Tabs back into the Elements list, so a row can be picked again. */
async function backToRows(user: User): Promise<HTMLElement> {
  const list = screen.getByRole("listbox", { name: en["elements.label"] });
  for (let i = 0; i < 60 && !list.contains(document.activeElement); i++)
    await user.tab({ shift: true });
  return list;
}

/** The Fill the open editor holds. */
function fillNow(runtime: MapsRuntime): MapFillElement {
  const element = runtime.editor
    ?.getSnapshot()
    .elements.find((candidate): candidate is MapFillElement => candidate.kind === "fill");
  if (element === undefined) throw new Error("no Fill");
  return element;
}

/** The Map Line the open editor holds. */
function lineNow(runtime: MapsRuntime): MapLineElement {
  const element = runtime.editor
    ?.getSnapshot()
    .elements.find((candidate): candidate is MapLineElement => candidate.kind === "line");
  if (element === undefined) throw new Error("no Map Line");
  return element;
}

/** The Fill the stored Map holds. */
function storedFill(storage: Map<string, unknown>): MapFillElement {
  const element = storedMap(storage).elements.find(
    (candidate): candidate is MapFillElement => candidate.kind === "fill"
  );
  if (element === undefined) throw new Error("no stored Fill");
  return element;
}

/** The Map Line the stored Map holds. */
function storedLine(storage: Map<string, unknown>): MapLineElement {
  const element = storedMap(storage).elements.find(
    (candidate): candidate is MapLineElement => candidate.kind === "line"
  );
  if (element === undefined) throw new Error("no stored Map Line");
  return element;
}

/** Focuses the Tool radio group and arrows to `name`, from wherever it stands. */
async function pickTool(user: User, name: string): Promise<HTMLElement> {
  const tools = await screen.findByRole("radiogroup", { name: en["tools.label"] });
  for (let i = 0; i < 60 && !tools.contains(document.activeElement); i++) await user.tab();
  const radio = screen.getByRole("radio", { name });
  for (let i = 0; i < 8 && !(radio as HTMLInputElement).checked; i++)
    await user.keyboard("{ArrowRight}");
  await waitFor(() => expect(radio).toBeChecked());
  return radio;
}

/** Picks a Shape tool by keyboard, then places one with its Place button. */
async function placeShape(user: User, tool: "ellipse" | "rectangle" | "polygon"): Promise<void> {
  await pickTool(user, en[`tools.${tool}`]);
  const place = await screen.findByRole("button", { name: en[`properties.placeShape.${tool}`] });
  await tabTo(user, place, 10);
  await user.keyboard("{Enter}");
}

/** Focuses a select's trigger and picks an option by arrow keys. */
async function pickOption(
  user: User,
  label: string,
  option: string,
  scope: HTMLElement = document.body
) {
  const trigger = within(scope).getByLabelText(label);
  await tabTo(user, trigger);
  await user.keyboard("{Enter}");
  const listbox = await screen.findByRole("listbox");
  const target = within(listbox).getByRole("option", { name: option });
  await user.keyboard("{Home}");
  // One step per option, so the picker of 22 Stamps reaches its last one.
  for (let i = 0; i < 30 && document.activeElement !== target; i++)
    await user.keyboard("{ArrowDown}");
  await user.keyboard("{Enter}");
}

function names(): string[] {
  const list = screen.queryByRole("list");
  if (list === null) return [];
  return within(list)
    .getAllByRole("listitem")
    .map((item) => within(item).getByRole("img").getAttribute("alt") ?? "");
}

function index(storage: Map<string, unknown>): MapIndexEntry[] {
  return storage.get(INDEX_KEY) as MapIndexEntry[];
}

describe("Maps page", () => {
  it("creates a Map by keyboard alone: name, Book, and page size", async () => {
    const storage = new Map<string, unknown>();
    const host = hostFor(storage);
    try {
      const page = await host.renderPage(MAPS_PAGE_ID);
      expect(await screen.findByText(en["list.emptyTitle"])).toBeInTheDocument();
      const user = userEvent.setup();

      const create = screen.getByRole("button", { name: en["list.new"] });
      await tabTo(user, create);
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog", { name: en["create.title"] });
      expect(within(dialog).getByRole("textbox", { name: en["create.name"] })).toHaveFocus();
      await user.keyboard("Northern Reach");

      await pickOption(user, en["create.book"], "The Salt Road", dialog);
      const landscape = within(dialog).getByRole("radio", { name: en["page.landscape"] });
      await tabTo(user, landscape);
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect(within(dialog).getByRole("radio", { name: en["page.spread"] })).toBeChecked()
      );

      await tabTo(user, within(dialog).getByRole("button", { name: en["create.submit"] }));
      await user.keyboard("{Enter}");

      await waitFor(() => expect(names()).toEqual(["Northern Reach"]));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByText(`The Salt Road · ${en["page.spread"]}`)).toBeInTheDocument();
      const [created] = index(storage);
      expect(created).toMatchObject({ name: "Northern Reach", bookId: "b2", preset: "spread" });
      expect(storage.get(mapKey(created.id))).toMatchObject({ elements: [], dataVersion: 1 });
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("keeps the dialog open with an error when the name is empty, and Escape closes it", async () => {
    const storage = new Map<string, unknown>();
    const host = hostFor(storage);
    try {
      const page = await host.renderPage(MAPS_PAGE_ID);
      const user = userEvent.setup();
      const create = await screen.findByRole("button", { name: en["list.new"] });
      await tabTo(user, create);
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog");
      await tabTo(user, within(dialog).getByRole("button", { name: en["create.submit"] }));
      await user.keyboard("{Enter}");
      expect(await within(dialog).findByText(en["dialog.emptyName"])).toBeInTheDocument();
      expect(storage.has(INDEX_KEY)).toBe(false);

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() =>
        expect(screen.getByRole("button", { name: en["list.new"] })).toHaveFocus()
      );
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("renames a Map by keyboard, and the index follows", async () => {
    const storage = seededStorage();
    const host = hostFor(storage);
    try {
      const page = await host.renderPage(MAPS_PAGE_ID);
      const user = userEvent.setup();
      const rename = await screen.findByRole("button", { name: `${en["list.rename"]} Isles` });
      await tabTo(user, rename);
      await user.keyboard("{Enter}");
      await screen.findByRole("dialog", { name: en["rename.title"] });
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(rename).toHaveFocus());
      expect(index(storage).find((row) => row.id === "m2")?.name).toBe("Isles");

      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog", { name: en["rename.title"] });
      const field = within(dialog).getByRole("textbox", { name: en["create.name"] });
      expect(field).toHaveValue("Isles");
      await user.keyboard("{Control>}a{/Control}Shattered Isles");
      await tabTo(user, within(dialog).getByRole("button", { name: en["rename.submit"] }));
      await user.keyboard("{Enter}");

      await waitFor(() => expect(names()).toEqual(["Shattered Isles", "Coast", "Loose"]));
      expect(index(storage).find((row) => row.id === "m2")?.name).toBe("Shattered Isles");
      expect(storage.get(mapKey("m2"))).toMatchObject({ name: "Shattered Isles" });
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("deletes a Map by keyboard after confirming", async () => {
    const storage = seededStorage();
    const host = hostFor(storage);
    try {
      const page = await host.renderPage(MAPS_PAGE_ID);
      const user = userEvent.setup();
      const remove = await screen.findByRole("button", { name: `${en["list.delete"]} Coast` });
      await tabTo(user, remove);
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText("Delete Coast?")).toBeInTheDocument();

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      await waitFor(() => expect(remove).toHaveFocus());
      expect(names()).toEqual(["Coast", "Isles", "Loose"]);

      await tabTo(user, screen.getByRole("button", { name: `${en["list.delete"]} Coast` }));
      await user.keyboard("{Enter}");
      const again = await screen.findByRole("alertdialog");
      await tabTo(user, within(again).getByRole("button", { name: en["delete.confirm"] }));
      await user.keyboard("{Enter}");

      await waitFor(() => expect(names()).toEqual(["Isles", "Loose"]));
      expect(storage.has(mapKey("m1"))).toBe(false);
      expect(index(storage).map((row) => row.id)).toEqual(["m2", "m3"]);
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("filters by Book; a Map with no Book shows only under All", async () => {
    const host = hostFor(seededStorage());
    try {
      const page = await host.renderPage(MAPS_PAGE_ID);
      await waitFor(() => expect(names()).toEqual(["Coast", "Isles", "Loose"]));
      const user = userEvent.setup();
      await pickOption(user, en["list.filter"], "Tides of Ash");
      await waitFor(() => expect(names()).toEqual(["Coast", "Isles"]));
      await pickOption(user, en["list.filter"], "The Salt Road");
      expect(await screen.findByText(en["list.emptyBookTitle"])).toBeInTheDocument();
      await pickOption(user, en["list.filter"], en["list.filter.all"]);
      await waitFor(() => expect(names()).toEqual(["Coast", "Isles", "Loose"]));
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("speaks Spanish when the app does", async () => {
    const host = hostFor(new Map(), "es");
    try {
      const page = await host.renderPage(MAPS_PAGE_ID);
      expect(await screen.findByText(es["list.emptyTitle"])).toBeInTheDocument();
      expect(screen.getByRole("button", { name: es["list.new"] })).toBeInTheDocument();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});

describe("Maps Commands and host requests", () => {
  it("Open Maps opens the page", async () => {
    const host = hostFor();
    try {
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: OPEN_MAPS });
      expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-maps", pageId: MAPS_PAGE_ID }]);
    } finally {
      await host.stop();
    }
  });

  it("the Book Item Menu entry opens the page filtered to that Book", async () => {
    const host = hostFor(seededStorage());
    try {
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, {
        id: BOOK_MAPS,
        target: { kind: "book", id: "b1" },
      });
      expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-maps", pageId: MAPS_PAGE_ID }]);
      const page = await host.renderPage(MAPS_PAGE_ID);
      await waitFor(() => expect(names()).toEqual(["Coast", "Isles"]));
      expect(screen.getByLabelText(en["list.filter"])).toHaveTextContent("Tides of Ash");
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("the next visit after a Book's entry starts at All again", async () => {
    const host = hostFor(seededStorage());
    try {
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, {
        id: BOOK_MAPS,
        target: { kind: "book", id: "b1" },
      });
      const first = await host.renderPage(MAPS_PAGE_ID);
      await waitFor(() => expect(names()).toEqual(["Coast", "Isles"]));
      await first.unmount();

      const second = await host.renderPage(MAPS_PAGE_ID);
      await waitFor(() => expect(names()).toEqual(["Coast", "Isles", "Loose"]));
      await second.unmount();
    } finally {
      await host.stop();
    }
  });

  it("keeps a Book's filter when the Library read fails, rather than showing every Map", async () => {
    const host = createTestHost({
      manifest: mapsManifest(),
      library: { books: BOOKS },
      storage: seededStorage(),
      permissions: ["editor:write", "files:pick", "files:save"],
    });
    startMaps(createPluginClient(host.port), servePluginUi);
    try {
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, {
        id: BOOK_MAPS,
        target: { kind: "book", id: "b1" },
      });
      const page = await host.renderPage(MAPS_PAGE_ID);
      await waitFor(() => expect(names()).toEqual(["Coast", "Isles"]));
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("answers migrateData from version 1 without touching the data", async () => {
    const storage = seededStorage();
    const before = structuredClone([...storage]);
    const host = hostFor(storage);
    try {
      await expect(
        host.broker.request(PLUGIN_MIGRATE_DATA_REQUEST, { from: 1 })
      ).resolves.toBeNull();
      expect([...storage]).toEqual(before);
    } finally {
      await host.stop();
    }
  });
});

describe("Map editor Commands", () => {
  const MAP_COMMANDS = [
    "undo",
    "redo",
    "zoomIn",
    "zoomOut",
    "zoomReset",
    "panLeft",
    "panRight",
    "panUp",
    "panDown",
    "moveLeft",
    "moveRight",
    "moveUp",
    "moveDown",
    "moveLeftFar",
    "moveRightFar",
    "moveUpFar",
    "moveDownFar",
    "selectTool",
    "pencilTool",
    "penTool",
    "bucketTool",
    "areaTool",
    "ellipseTool",
    "rectangleTool",
    "polygonTool",
    "insertTool",
    "eraserTool",
    "roughen",
    "deleteElement",
  ];

  it("binds every Map editor Command, bare Arrows included", () => {
    registerMapCommands();
    for (const id of MAP_COMMANDS) {
      const full = `plugin.maibuk-maps.${id}` as CommandId;
      expect(effectiveShortcuts(full, {}, false).length, id).toBeGreaterThan(0);
    }
    expect(effectiveShortcuts("plugin.maibuk-maps.moveRight", {}, false)).toContainEqual([
      "ArrowRight",
    ]);
    expect(effectiveShortcuts("plugin.maibuk-maps.moveLeft", {}, false)).toContainEqual([
      "ArrowLeft",
    ]);
    expect(effectiveShortcuts("plugin.maibuk-maps.moveDownFar", {}, false)).toContainEqual([
      "Shift+ArrowDown",
    ]);
    expect(effectiveShortcuts("plugin.maibuk-maps.penTool", {}, false)).toContainEqual(["n"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.bucketTool", {}, false)).toContainEqual(["b"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.areaTool", {}, false)).toContainEqual(["a"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.insertTool", {}, false)).toContainEqual(["i"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.ellipseTool", {}, false)).toContainEqual(["o"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.rectangleTool", {}, false)).toContainEqual(["r"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.polygonTool", {}, false)).toContainEqual(["s"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.eraserTool", {}, false)).toContainEqual(["e"]);
    // Mod+Shift+r is core `editor.alignRight` in the editor, which no route
    // shows beside the Map page, so the binding is live here.
    expect(effectiveShortcuts("plugin.maibuk-maps.roughen", {}, false)).toContainEqual([
      "Mod+Shift+r",
    ]);
  });
});

describe("Map editor page", () => {
  it("opens a Map from the list by keyboard and draws its editor", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const { host, runtime } = editorHostFor(storage);
    try {
      const mapsPage = await host.renderPage(MAPS_PAGE_ID);
      const user = userEvent.setup();
      const open = await screen.findByRole("button", { name: `${en["list.open"]} Coast` });
      await tabTo(user, open, 60);
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(host.pageNavigations).toContainEqual({
          pluginId: "maibuk-maps",
          pageId: MAP_PAGE_ID,
        })
      );
      expect(runtime.currentMapId).toBe("m1");
      await mapsPage.unmount();

      const editorPage = await host.renderPage(MAP_PAGE_ID);
      // The Line style select also offers "Coast", so the page title is the
      // paragraph, not any text of that name.
      expect(await screen.findByText("Coast", { selector: "p" })).toBeInTheDocument();
      expect(screen.getByRole("listbox", { name: en["elements.label"] })).toBeInTheDocument();
      expect(screen.getByRole("radiogroup", { name: en["tools.label"] })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: en["map.backToMaps"] })).toBeInTheDocument();
      await editorPage.unmount();
    } finally {
      await host.stop();
    }
  });

  it("shows an EmptyState when no Map is open, and returns to the list", async () => {
    const { host } = editorHostFor(new Map());
    try {
      const page = await host.renderPage(MAP_PAGE_ID);
      expect(await screen.findByText(en["map.emptyTitle"])).toBeInTheDocument();
      const user = userEvent.setup();
      const back = screen.getByRole("button", { name: en["map.backToMaps"] });
      await tabTo(user, back, 40);
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(host.pageNavigations).toContainEqual({
          pluginId: "maibuk-maps",
          pageId: MAPS_PAGE_ID,
        })
      );
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("moves with ArrowRight and Shift+ArrowDown, then undoes and redoes", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup();
      await selectRow(user, "Line one");
      await focusPanelButton(user);

      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).points[0][0]).toBe(11)
      );
      await runtime.editor?.flush();
      expect(linePoints(storage)[0][0]).toBe(11);

      await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).points[0][1]).toBe(20)
      );
      await runtime.editor?.flush();
      expect(linePoints(storage)[0][1]).toBe(20);

      await user.keyboard("{Control>}z{/Control}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).points[0][1]).toBe(10)
      );
      await runtime.editor?.flush();
      expect(linePoints(storage)[0]).toEqual([11, 10]);

      await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).points[0][1]).toBe(20)
      );
      await runtime.editor?.flush();
      expect(linePoints(storage)[0]).toEqual([11, 20]);

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("leaves the Elements list's handled arrows to the list", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
      line("e2", "Line two", [
        [30, 30],
        [40, 40],
      ]),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup();
      await selectRow(user, "Line two");
      const list = screen.getByRole("listbox", { name: en["elements.label"] });
      const first = within(list).getByRole("option", { name: /^Line one/ });

      // ArrowDown is the list's own: focus moves, and the selected Map Line
      // stays where it was.
      await user.keyboard("{ArrowDown}");
      await waitFor(() => expect(document.activeElement).toBe(first));
      expect(runtime.editor?.getSnapshot().selectedId).toBe("e2");
      await runtime.editor?.flush();
      expect(linePoints(storage, 1)).toEqual([
        [30, 30],
        [40, 40],
      ]);

      // A vertical list does not handle the horizontal arrows, so those still
      // reach the Map Command and move the selected Element.
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[1] as MapLineElement).points[0][0]).toBe(31)
      );
      await runtime.editor?.flush();
      expect(linePoints(storage, 1)[0][0]).toBe(31);

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("renames, reorders, hides, locks, and deletes through the Elements list by keyboard", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
      line("e2", "Line two", [
        [30, 30],
        [40, 40],
      ]),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup();

      await selectRow(user, "Line one");
      await chooseRowMenu(user, "Move up");
      await runtime.editor?.flush();
      expect(storedMap(storage).elements.map((element) => element.id)).toEqual(["e2", "e1"]);

      await selectRow(user, "Line one");
      await chooseRowMenu(user, "Move down");
      await runtime.editor?.flush();
      expect(storedMap(storage).elements.map((element) => element.id)).toEqual(["e1", "e2"]);

      await selectRow(user, "Line one");
      await chooseRowMenu(user, "Rename");
      const dialog = await screen.findByRole("dialog", { name: en["properties.renameTitle"] });
      const field = within(dialog).getByRole("textbox", { name: en["properties.name"] });
      expect(field).toHaveFocus();
      await user.keyboard("{Control>}a{/Control}Coastline");
      await tabTo(
        user,
        within(dialog).getByRole("button", { name: en["properties.renameSubmit"] }),
        10
      );
      await user.keyboard("{Enter}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0].name).toBe("Coastline");

      await selectRow(user, "Coastline");
      await chooseRowMenu(user, "Hide");
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0].hidden).toBe(true);

      await selectRow(user, "Coastline");
      await chooseRowMenu(user, "Lock");
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0].locked).toBe(true);

      const before = linePoints(storage)[0];
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: MOVE_RIGHT });
      expect(linePoints(storage)[0]).toEqual(before);

      await selectRow(user, "Coastline");
      await chooseRowMenu(user, "Delete");
      await runtime.editor?.flush();
      expect(storedMap(storage).elements.map((element) => element.id)).toEqual(["e2"]);
      expect(screen.queryByRole("option", { name: /^Coastline/ })).not.toBeInTheDocument();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("adds a smoothed Map Line from a Frame stroke and previews its path", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const raw: [number, number][] = [
        [10, 10],
        [10.02, 10.02],
        [30, 10],
        [40, 20],
      ];
      runtime.editor?.handleFrameMessage({ kind: "stroke", points: raw });
      await runtime.editor?.flush();

      const elements = storedMap(storage).elements;
      expect(elements).toHaveLength(1);
      const element = elements[0] as MapLineElement;
      expect(element).toMatchObject({
        kind: "line",
        name: "Map Line 1",
        hidden: false,
        locked: false,
        style: "plain",
        enclosesFills: true,
        closed: false,
        roughened: false,
      });
      expect(element.points).toEqual(smoothStroke(raw));
      expect(element.curves).toEqual(element.points.slice(1).map(() => true));
      expect(runtime.editor?.getSnapshot().selectedId).toBe(element.id);

      const preview = decodeURIComponent((storage.get(INDEX_KEY) as MapIndexEntry[])[0].preview);
      expect(preview).toContain(linePath(element));

      runtime.editor?.handleFrameMessage({ kind: "stroke", points: "not-points" });
      expect(runtime.editor?.getSnapshot().elements).toHaveLength(1);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("keeps a finished Pen line with its curves, closure, and current style", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      runtime.editor?.setLineStyle("coast");
      runtime.editor?.handleFrameMessage({
        kind: "line",
        points: [
          [10, 10],
          [20, 10],
          [20, 20],
        ],
        curves: [false, false, false],
        closed: true,
      });
      await runtime.editor?.flush();

      const elements = storedMap(storage).elements;
      expect(elements).toHaveLength(1);
      const element = elements[0] as MapLineElement;
      expect(element).toMatchObject({
        kind: "line",
        name: "Map Line 1",
        hidden: false,
        locked: false,
        style: "coast",
        enclosesFills: true,
        closed: true,
        roughened: false,
      });
      expect(element.curves).toEqual([false, false, false]);
      expect(runtime.editor?.getSnapshot().selectedId).toBe(element.id);

      // A malformed line is dropped and changes nothing.
      runtime.editor?.handleFrameMessage({
        kind: "line",
        points: [
          [0, 0],
          [1, 1],
        ],
        curves: [],
        closed: false,
      });
      runtime.editor?.handleFrameMessage({ kind: "line", points: [[0, 0]], curves: [] });
      expect(runtime.editor?.getSnapshot().elements).toHaveLength(1);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("splits a Map Line with one Eraser drag as a single undo step", async () => {
    const storage = mapStorage([
      line(
        "e1",
        "Coastline",
        [
          [0, 0],
          [10, 0],
          [20, 0],
          [30, 0],
        ],
        { curves: [false, false, false] }
      ),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const before = runtime.editor?.getSnapshot().elements;

      runtime.editor?.handleFrameMessage({
        kind: "erase",
        points: [
          [15, 5],
          [15, -5],
        ],
        radiusMm: 2,
      });
      await runtime.editor?.flush();

      const pieces = storedMap(storage).elements as MapLineElement[];
      expect(pieces).toHaveLength(2);
      // The first piece keeps the id and name; the second takes a new id and
      // the name plus its number, right after the original in z-order.
      expect(pieces[0].id).toBe("e1");
      expect(pieces[0].name).toBe("Coastline");
      expect(pieces[1].id).not.toBe("e1");
      expect(pieces[1].name).toBe("Coastline 2");
      expect(pieces[0].closed).toBe(false);
      expect(pieces[1].closed).toBe(false);
      expect(pieces[0].points[pieces[0].points.length - 1][0]).toBeCloseTo(13, 0);
      expect(pieces[1].points[0][0]).toBeCloseTo(17, 0);

      runtime.editor?.undo();
      const restored = runtime.editor?.getSnapshot().elements;
      expect(restored).toEqual(before);
      expect(restored).toHaveLength(1);

      // An erase that touches nothing, or a malformed one, is not an edit.
      runtime.editor?.handleFrameMessage({
        kind: "erase",
        points: [[60, 60]],
        radiusMm: 2,
      });
      runtime.editor?.handleFrameMessage({ kind: "erase", points: [], radiusMm: 2 });
      expect(runtime.editor?.getSnapshot().elements).toHaveLength(1);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("tells the Frame both plural forms of the Pen draft label, in the app language", async () => {
    const { host, runtime } = await openEditor(mapStorage([]), "es");
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      // The Frame counts its own draft but cannot read the catalogs, so both
      // forms ship with the scene: "1 punto", "2 puntos".
      const sent: Array<Record<string, unknown>> = [];
      const port = {
        postMessage: (message: Record<string, unknown>) => sent.push(message),
      } as unknown as MessagePort;
      runtime.editor?.attachFrame(port);
      expect(sent.at(-1)?.penLabel).toEqual({
        one: "Línea de pluma, {{count}} punto",
        other: "Línea de pluma, {{count}} puntos",
      });

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("changes the selected line's style, resets Encloses Fills, and undoes in one step", async () => {
    const storage = mapStorage([
      line(
        "e1",
        "River",
        [
          [0, 0],
          [10, 10],
        ],
        { style: "river", enclosesFills: false }
      ),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      runtime.editor?.select("e1");
      expect(runtime.editor?.getSnapshot().selectedIsLine).toBe(true);
      expect(runtime.editor?.getSnapshot().selectedLineStyle).toBe("river");
      expect(runtime.editor?.getSnapshot().selectedEnclosesFills).toBe(false);
      expect(runtime.editor?.getSnapshot().currentLineStyle).toBe("plain");

      runtime.editor?.setLineStyle("coast");
      const changed = runtime.editor?.getSnapshot().elements[0] as MapLineElement;
      expect(changed.style).toBe("coast");
      expect(changed.enclosesFills).toBe(true);
      expect(runtime.editor?.getSnapshot().currentLineStyle).toBe("coast");
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapLineElement).style).toBe("coast");

      runtime.editor?.undo();
      const restored = runtime.editor?.getSnapshot().elements[0] as MapLineElement;
      expect(restored.style).toBe("river");
      expect(restored.enclosesFills).toBe(false);

      // With no Map Line selected, the pick only becomes the current style.
      runtime.editor?.select(null);
      expect(runtime.editor?.getSnapshot().selectedIsLine).toBe(false);
      expect(runtime.editor?.getSnapshot().selectedLineStyle).toBeNull();
      runtime.editor?.setLineStyle("road");
      expect(runtime.editor?.getSnapshot().currentLineStyle).toBe("road");
      expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).style).toBe("river");

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("sets Encloses Fills on one line as its own undo step", async () => {
    const storage = mapStorage([
      line(
        "e1",
        "Coast",
        [
          [0, 0],
          [10, 10],
        ],
        { style: "coast", enclosesFills: true }
      ),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      runtime.editor?.setEnclosesFills("e1", false);
      expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).enclosesFills).toBe(
        false
      );
      runtime.editor?.undo();
      expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).enclosesFills).toBe(
        true
      );
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("changes neither style nor Encloses Fills of a locked line", async () => {
    const storage = mapStorage([
      line(
        "e1",
        "Coast",
        [
          [0, 0],
          [10, 10],
        ],
        { style: "coast", enclosesFills: true, locked: true }
      ),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      runtime.editor?.select("e1");
      // Roughen and drag already refuse a locked Element; so do these two, and
      // a refused edit is not an undo step.
      runtime.editor?.setLineStyle("road");
      runtime.editor?.setEnclosesFills("e1", false);
      const locked = runtime.editor?.getSnapshot().elements[0] as MapLineElement;
      expect(locked.style).toBe("coast");
      expect(locked.enclosesFills).toBe(true);
      expect(runtime.editor?.getSnapshot().currentLineStyle).toBe("plain");
      expect(runtime.editor?.getSnapshot().canUndo).toBe(false);
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapLineElement).style).toBe("coast");

      // Unlocking lets the same pick through, as one undo step.
      runtime.editor?.setLocked("e1", false);
      runtime.editor?.setLineStyle("road");
      const unlocked = runtime.editor?.getSnapshot().elements[0] as MapLineElement;
      expect(unlocked.style).toBe("road");
      expect(unlocked.enclosesFills).toBe(false);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("roughens the selected line as one undo step, and undo restores its exact points", async () => {
    const points: [number, number][] = [
      [0, 0],
      [30, 0],
      [30, 30],
    ];
    const storage = mapStorage([line("e1", "Coast", points, { curves: [false, false] })]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      runtime.editor?.select("e1");
      runtime.editor?.setRoughenStrength(3);
      expect(runtime.editor?.getSnapshot().roughenStrength).toBe(3);
      // The slider's own range clamps a value from outside it.
      runtime.editor?.setRoughenStrength(10);
      expect(runtime.editor?.getSnapshot().roughenStrength).toBe(5);
      runtime.editor?.setRoughenStrength(3);

      runtime.editor?.roughen();
      const roughened = runtime.editor?.getSnapshot().elements[0] as MapLineElement;
      expect(roughened.roughened).toBe(true);
      expect(roughened.points.length).toBeGreaterThan(points.length);
      expect(roughened.curves).toHaveLength(roughened.points.length - 1);
      expect(roughened.curves.every((flag) => flag === false)).toBe(true);
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapLineElement).roughened).toBe(true);

      runtime.editor?.undo();
      const restored = runtime.editor?.getSnapshot().elements[0] as MapLineElement;
      expect(restored.points).toEqual(points);
      expect(restored.roughened).toBe(false);

      // No selected line is a no-op.
      runtime.editor?.select(null);
      runtime.editor?.roughen();
      expect(runtime.editor?.getSnapshot().elements).toHaveLength(1);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("raises the Roughen strength with ArrowRight and Roughens the line with it", async () => {
    const points: [number, number][] = [
      [0, 0],
      [30, 0],
      [30, 30],
    ];
    const storage = mapStorage([line("e1", "Coast", points, { curves: [false, false] })]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup();
      await selectRow(user, "Coast");
      expect(runtime.editor?.getSnapshot().roughenStrength).toBe(1.5);

      const slider = screen.getByRole("slider", { name: en["properties.roughenStrength"] });
      await tabTo(user, slider, 80);
      await user.keyboard("{ArrowRight}");
      await waitFor(() => expect(runtime.editor?.getSnapshot().roughenStrength).toBeCloseTo(1.6));
      const raised = runtime.editor?.getSnapshot().roughenStrength ?? 0;
      expect(raised).toBeGreaterThan(1.5);

      const roughenButton = await screen.findByRole("button", {
        name: en["properties.roughen"],
      });
      await tabTo(user, roughenButton, 10);
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).roughened).toBe(true)
      );
      await runtime.editor?.flush();

      // The path is the one Roughen draws at the strength the author picked.
      const stored = storedMap(storage).elements[0] as MapLineElement;
      expect(stored.points).toEqual(roughen(points, false, raised, seedFor("e1")));

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("selects the Pen by its key, Roughens by its Shortcut, and undo restores the exact points", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup();
      // The page commits after `renderPage` returns; wait for its first control.
      await screen.findByRole("radiogroup", { name: en["tools.label"] });
      await focusPanelButton(user);

      // The Pen tool's own key selects it, and the picker follows.
      await user.keyboard("n");
      await waitFor(() => expect(runtime.editor?.getSnapshot().tool).toBe("pen"));
      expect(screen.getByRole("radio", { name: en["tools.pen"] })).toBeChecked();

      // The keyboard pen draws a closed outline in the Frame; the Frame stand-in
      // hands the editor the line message the real Frame posts for it.
      const outline: [number, number][] = [
        [20, 20],
        [60, 20],
        [60, 50],
        [20, 50],
      ];
      runtime.editor?.handleFrameMessage({
        kind: "line",
        points: outline,
        curves: [false, false, false, false],
        closed: true,
      });
      await runtime.editor?.flush();

      const drawn = storedMap(storage).elements[0] as MapLineElement;
      expect(drawn).toMatchObject({ style: "plain", closed: true, roughened: false });
      expect(drawn.points).toEqual(outline);
      expect(runtime.editor?.getSnapshot().selectedId).toBe(drawn.id);

      // Roughen by its Shortcut resamples the line off its path, as one step.
      await user.keyboard("{Control>}{Shift>}r{/Shift}{/Control}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).roughened).toBe(true)
      );
      const roughened = runtime.editor?.getSnapshot().elements[0] as MapLineElement;
      expect(roughened.points.length).toBeGreaterThan(outline.length);
      expect(roughened.points).not.toEqual(outline);
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapLineElement).roughened).toBe(true);

      // Undo puts the exact points back.
      await user.keyboard("{Control>}z{/Control}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).roughened).toBe(false)
      );
      expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).points).toEqual(outline);
      await runtime.editor?.flush();
      expect(linePoints(storage)).toEqual(outline);

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("draws an Area Fill with the keyboard and Roughens its outline", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    registerMapCommands();
    // The real Frame runs here, so the arrows move its crosshair and Enter
    // posts the outline it closes; nothing about the Frame is stubbed.
    const workerPort = loadMapFrame(runtime);
    runtime.editor?.attachFrame(workerPort);
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup();

      // The Area tool's own key selects it, through the host's shortcut registry.
      await user.keyboard("a");
      await waitFor(() => expect(runtime.editor?.getSnapshot().tool).toBe("area"));

      // The crosshair starts at the view centre of the portrait page, 76.2 by
      // 114.3 mm; Shift+Arrow steps it ten millimetres.
      const startX = 152.4 / 2;
      const startY = 228.6 / 2;
      await user.keyboard("{Enter}");
      await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
      await user.keyboard("{Enter}");
      await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
      await user.keyboard("{Enter}");
      // Back on the first point, Enter closes the outline.
      await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
      await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
      await user.keyboard("{Enter}");

      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toHaveLength(1));
      await runtime.editor?.flush();

      // The outline the author pointed out is the Area Fill the Map keeps.
      const drawn = storedMap(storage).elements[0] as MapFillElement;
      expect(drawn).toMatchObject({
        kind: "fill",
        name: "Fill 1",
        content: { color: "land" },
      });
      expect(drawn.outline?.points).toEqual([
        [startX, startY],
        [startX + 10, startY],
        [startX + 10, startY + 10],
      ]);
      expect(drawn.outline?.curves).toEqual([false, false, false]);
      expect(drawn.outline?.roughened).toBe(false);
      expect(runtime.editor?.getSnapshot().selectedId).toBe(drawn.id);

      // Roughen by its Shortcut redraws that outline, as one undo step.
      await user.keyboard("{Control>}{Shift>}r{/Shift}{/Control}");
      const roughenedNow = () =>
        (runtime.editor?.getSnapshot().elements[0] as MapFillElement).outline?.roughened;
      await waitFor(() => expect(roughenedNow()).toBe(true));
      const roughened = runtime.editor?.getSnapshot().elements[0] as MapFillElement;
      expect(roughened.outline?.points.length).toBeGreaterThan(drawn.outline?.points.length ?? 0);
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapFillElement).outline?.roughened).toBe(true);
    } finally {
      keys.unmount();
      await host.stop();
    }
  });

  it("picks the Bucket, pours at the keyboard crosshair, and undoes the Fill", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup();

      // A closed Shape to pour into, landed at the view centre by keyboard.
      await placeShape(user, "rectangle");
      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toHaveLength(1));

      // The tool picker reaches the Bucket with its arrows.
      const tools = screen.getByRole("radiogroup", { name: en["tools.label"] });
      for (let i = 0; i < 10 && !tools.contains(document.activeElement); i++)
        await user.tab({ shift: true });
      const bucket = screen.getByRole("radio", { name: en["tools.bucket"] });
      for (let i = 0; i < 8 && !(bucket as HTMLInputElement).checked; i++)
        await user.keyboard("{ArrowLeft}");
      await waitFor(() => expect(bucket).toBeChecked());
      expect(runtime.editor?.getSnapshot().tool).toBe("bucket");

      // Enter at the crosshair sends the Frame's pour message; the Frame stand-in
      // hands the editor the point the real Frame would report (the page centre).
      runtime.editor?.handleFrameMessage({ kind: "pour", point: [76.2, 114.3] });
      await runtime.editor?.flush();

      const list = screen.getByRole("listbox", { name: en["elements.label"] });
      expect(await within(list).findByRole("option", { name: /^Fill 1/ })).toBeInTheDocument();
      const poured = storedMap(storage).elements.find(
        (element): element is MapFillElement => element.kind === "fill"
      );
      expect(poured).toMatchObject({ name: "Fill 1", content: { color: "land" } });
      expect(runtime.editor?.getSnapshot().selectedId).toBe(poured?.id);
      expect(screen.getByRole("listbox", { name: en["elements.label"] })).toHaveTextContent(
        en["element.kind.fill"]
      );

      // Undo by its Shortcut takes the Fill off the list again.
      await focusPanelButton(user);
      await user.keyboard("{Control>}z{/Control}");
      await waitFor(() =>
        expect(within(list).queryByRole("option", { name: /^Fill/ })).not.toBeInTheDocument()
      );
      await runtime.editor?.flush();
      expect(storedMap(storage).elements.some((element) => element.kind === "fill")).toBe(false);

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("sets the Bucket's Fill color, then a selected Fill's, from the properties panel", async () => {
    const storage = mapStorage([
      line(
        "ring",
        "Ring",
        [
          [10, 10],
          [90, 10],
          [90, 90],
          [10, 90],
        ],
        { closed: true, curves: [false, false, false, false] }
      ),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup();

      /** Opens the Fill color picker and commits one hex colour by keyboard. */
      async function pickColor(hex: string): Promise<void> {
        const trigger = await screen.findByRole("button", { name: en["properties.fillColor"] });
        await tabTo(user, trigger, 60);
        await user.keyboard("{Enter}");
        const dialog = await screen.findByRole("dialog", { name: en["properties.fillColor"] });
        const field = within(dialog).getByRole("textbox");
        await user.clear(field);
        await user.type(field, hex);
        await user.keyboard("{Enter}");
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      }

      // With the Bucket active the control holds what the next pour uses.
      await pickTool(user, en["tools.bucket"]);
      await pickColor("#112233");
      await waitFor(() => expect(runtime.editor?.getSnapshot().currentFillColor).toBe("#112233"));

      runtime.editor?.handleFrameMessage({ kind: "pour", point: [50, 50] });
      await runtime.editor?.flush();
      const poured = storedMap(storage).elements.find(
        (element): element is MapFillElement => element.kind === "fill"
      );
      expect(poured?.content.color).toBe("#112233");

      // With a Fill selected the same control edits that Fill.
      await user.keyboard("v");
      await waitFor(() => expect(runtime.editor?.getSnapshot().tool).toBe("select"));
      expect(runtime.editor?.getSnapshot().selectedId).toBe(poured?.id);

      const trigger = await screen.findByRole("button", { name: en["properties.fillColor"] });
      await tabTo(user, trigger, 60);
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog", { name: en["properties.fillColor"] });
      expect(within(dialog).getByRole("textbox")).toHaveValue("#112233");
      await user.clear(within(dialog).getByRole("textbox"));
      await user.type(within(dialog).getByRole("textbox"), "#445566");
      await user.keyboard("{Enter}");
      await user.keyboard("{Escape}");

      await waitFor(() => expect(runtime.editor?.getSnapshot().selectedFillColor).toBe("#445566"));
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapFillElement).content.color).toBe("#445566");

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("places an ellipse by keyboard and makes it a circle through Width and Height", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup();
      await placeShape(user, "ellipse");
      expect(runtime.editor?.getSnapshot().elements).toHaveLength(1);

      // The Frame's drag is the pointer path; the number fields are the keyboard's.
      const width = await screen.findByRole("textbox", { name: en["properties.shape.width"] });
      await tabTo(user, width, 60);
      await user.keyboard("{Control>}a{/Control}60{Tab}");
      const height = screen.getByRole("textbox", { name: en["properties.shape.height"] });
      await tabTo(user, height, 10);
      await user.keyboard("{Control>}a{/Control}60{Tab}");

      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).shape).toMatchObject({
          kind: "ellipse",
          width: 60,
          height: 60,
        })
      );
      await runtime.editor?.flush();

      const stored = storedMap(storage).elements[0] as MapLineElement;
      expect(stored.shape).toEqual({
        kind: "ellipse",
        cx: 76.2,
        cy: 114.3,
        width: 60,
        height: 60,
        rotation: 0,
        sides: 6,
        cornerRadius: 0,
      });
      if (stored.shape === undefined) throw new Error("the line kept no Shape");
      expect(stored.points).toEqual(shapeOutline(stored.shape).points);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("shows Sides only for a polygon and Corner radius only for a rectangle", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup();
      const sides = () => screen.queryByRole("textbox", { name: en["properties.shape.sides"] });
      const cornerRadius = () =>
        screen.queryByRole("textbox", { name: en["properties.shape.cornerRadius"] });

      await placeShape(user, "polygon");
      const sidesField = await screen.findByRole("textbox", {
        name: en["properties.shape.sides"],
      });
      expect(cornerRadius()).not.toBeInTheDocument();

      // ArrowUp steps the side count, and the Shape follows.
      await tabTo(user, sidesField, 60);
      await user.keyboard("{ArrowUp}");
      await waitFor(() => expect(runtime.editor?.getSnapshot().selectedShape?.sides).toBe(7));

      // Shift+Tab walks back to the Tool group, where the next Shape is one ArrowLeft away.
      const tools = screen.getByRole("radiogroup", { name: en["tools.label"] });
      for (let i = 0; i < 60 && !tools.contains(document.activeElement); i++)
        await user.tab({ shift: true });
      const rectangle = screen.getByRole("radio", { name: en["tools.rectangle"] });
      for (let i = 0; i < 12 && !(rectangle as HTMLInputElement).checked; i++)
        await user.keyboard("{ArrowRight}");
      await waitFor(() => expect(rectangle).toBeChecked());
      const place = await screen.findByRole("button", {
        name: en["properties.placeShape.rectangle"],
      });
      await tabTo(user, place, 10);
      await user.keyboard("{Enter}");

      const radiusField = await screen.findByRole("textbox", {
        name: en["properties.shape.cornerRadius"],
      });
      expect(sides()).not.toBeInTheDocument();
      await tabTo(user, radiusField, 60);
      await user.keyboard("{Control>}a{/Control}2{Enter}");
      await waitFor(() =>
        expect(runtime.editor?.getSnapshot().selectedShape?.cornerRadius).toBe(2)
      );

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("says which Shape a line was converted from after Roughen", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup();
      await placeShape(user, "ellipse");
      expect(screen.queryByText(en["properties.convertedFrom.ellipse"])).not.toBeInTheDocument();

      const roughenButton = screen.getByRole("button", { name: en["properties.roughen"] });
      await tabTo(user, roughenButton, 60);
      await user.keyboard("{Enter}");

      expect(await screen.findByText(en["properties.convertedFrom.ellipse"])).toBeInTheDocument();
      expect(runtime.editor?.getSnapshot().selectedConvertedFrom).toBe("ellipse");
      // The line is point by point now, so its number fields are gone.
      expect(
        screen.queryByRole("textbox", { name: en["properties.shape.width"] })
      ).not.toBeInTheDocument();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("disables the Shape number fields while the line is locked", async () => {
    const storage = mapStorage([]);
    const { host } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup();
      await placeShape(user, "ellipse");
      const width = await screen.findByRole("textbox", {
        name: en["properties.shape.width"],
      });
      expect(width).toBeEnabled();

      const locked = screen.getByRole("switch", { name: en["properties.locked"] });
      await tabTo(user, locked, 60);
      await user.keyboard(" ");
      await waitFor(() =>
        expect(screen.getByRole("textbox", { name: en["properties.shape.width"] })).toBeDisabled()
      );

      await user.keyboard(" ");
      await waitFor(() =>
        expect(screen.getByRole("textbox", { name: en["properties.shape.width"] })).toBeEnabled()
      );

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("selects each Shape tool by its key and its Place button appears", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup();
      await screen.findByRole("radiogroup", { name: en["tools.label"] });
      await focusPanelButton(user);

      const tools = [
        ["o", "ellipse", en["tools.ellipse"]],
        ["r", "rectangle", en["tools.rectangle"]],
        ["s", "polygon", en["tools.polygon"]],
      ] as const;
      for (const [key, tool, label] of tools) {
        await user.keyboard(key);
        await waitFor(() => expect(runtime.editor?.getSnapshot().tool).toBe(tool));
        expect(screen.getByRole("radio", { name: label })).toBeChecked();
        expect(
          await screen.findByRole("button", { name: en[`properties.placeShape.${tool}`] })
        ).toBeInTheDocument();
      }

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("changes the selected line's Line style and Encloses Fills from the properties panel", async () => {
    const storage = mapStorage([
      line(
        "e1",
        "Road",
        [
          [10, 10],
          [20, 20],
        ],
        { style: "road", enclosesFills: false }
      ),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup();
      await screen.findByRole("radiogroup", { name: en["tools.label"] });
      // With no Map Line selected the select shows the current style.
      expect(screen.getByLabelText(en["properties.lineStyle"])).toHaveTextContent(
        en["properties.style.plain"]
      );

      await selectRow(user, "Road");
      expect(screen.getByLabelText(en["properties.lineStyle"])).toHaveTextContent(
        en["properties.style.road"]
      );

      // Picking a style changes the selected line and takes its Encloses Fills default.
      await pickOption(user, en["properties.lineStyle"], en["properties.style.coast"]);
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).style).toBe("coast")
      );
      expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).enclosesFills).toBe(
        true
      );
      expect(screen.getByLabelText(en["properties.lineStyle"])).toHaveTextContent(
        en["properties.style.coast"]
      );

      // The switch turns Encloses Fills off again, by the keyboard.
      const encloses = screen.getByRole("switch", { name: en["properties.enclosesFills"] });
      expect(encloses).toBeChecked();
      await tabTo(user, encloses);
      expect(encloses).toHaveFocus();
      await user.keyboard(" ");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).enclosesFills).toBe(
          false
        )
      );
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0]).toMatchObject({
        style: "coast",
        enclosesFills: false,
      });

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("takes a Frame select for a known Element, clears on null, and drops the rest", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
      line("e2", "Line two", [
        [30, 30],
        [40, 40],
      ]),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      runtime.editor?.handleFrameMessage({ kind: "select", id: "e2" });
      expect(runtime.editor?.getSnapshot().selectedId).toBe("e2");

      runtime.editor?.handleFrameMessage({ kind: "select", id: null });
      expect(runtime.editor?.getSnapshot().selectedId).toBeNull();

      runtime.editor?.handleFrameMessage({ kind: "select", id: "e1" });
      expect(runtime.editor?.getSnapshot().selectedId).toBe("e1");

      // An id no Element has selects nothing, like an unknown pick.
      runtime.editor?.handleFrameMessage({ kind: "select", id: "missing" });
      expect(runtime.editor?.getSnapshot().selectedId).toBeNull();

      // A malformed select is dropped and leaves the selection alone.
      runtime.editor?.handleFrameMessage({ kind: "select", id: "e1" });
      runtime.editor?.handleFrameMessage({ kind: "select", id: 7 });
      runtime.editor?.handleFrameMessage({ kind: "select" });
      expect(runtime.editor?.getSnapshot().selectedId).toBe("e1");

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("Properties selects the row and moves focus to the Name field even when it is already selected", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup();
      await selectRow(user, "Line one");
      expect(runtime.editor?.getSnapshot().selectedId).toBe("e1");

      await chooseRowMenu(user, "Properties");

      await waitFor(() =>
        expect(screen.getByRole("textbox", { name: en["properties.name"] })).toHaveFocus()
      );
      expect(runtime.editor?.getSnapshot().selectedId).toBe("e1");

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("drops the selection when undo removes the selected Element", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      runtime.editor?.handleFrameMessage({
        kind: "stroke",
        points: [
          [10, 10],
          [20, 20],
        ],
      });
      expect(runtime.editor?.getSnapshot().selectedId).not.toBeNull();

      runtime.editor?.undo();
      const snapshot = runtime.editor?.getSnapshot();
      expect(snapshot?.elements).toHaveLength(0);
      expect(snapshot?.selectedId).toBeNull();
      // The properties panel says what it says with no Element selected.
      expect(await screen.findByText(en["properties.empty"])).toBeInTheDocument();

      // Redo restores the Element, but a pruned selection stays cleared.
      runtime.editor?.redo();
      expect(runtime.editor?.getSnapshot().elements).toHaveLength(1);
      expect(runtime.editor?.getSnapshot().selectedId).toBeNull();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("keeps only the newest Frame port, so a remounted Frame stops receiving scenes", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const { host, runtime, handoff } = frameHostFor(storage);
    try {
      expect(await runtime.openMap("m1")).toBe(true);

      const first = recordingPort();
      handoff("frame-1", first.port);
      const second = recordingPort();
      handoff("frame-2", second.port);

      // Each Frame gets one scene when it connects; only the newest is kept.
      expect(first.messages).toHaveLength(1);
      expect(second.messages).toHaveLength(1);

      runtime.editor?.select("e1");
      runtime.editor?.move(1, 0);

      expect(first.messages).toHaveLength(1);
      expect(second.messages.length).toBeGreaterThan(1);
    } finally {
      await host.stop();
    }
  });

  it("hands the Frame the installed PDF Font, so a pdf label draws in it", async () => {
    const bytes = new TextEncoder().encode("FONT BYTES");
    const { host, runtime, handoff } = frameHostFor(mapStorage([]), [
      { id: "latin", family: "Noto Serif", bytes },
    ]);
    try {
      expect(await runtime.openMap("m1")).toBe(true);
      const frame = recordingPort();
      handoff("frame-1", frame.port);

      const fonts = () => frame.messages.filter(isFontMessage);
      await waitFor(() => expect(fonts()).toHaveLength(1));
      expect(fonts()[0].family).toBe(MAP_LABEL_FONT_FAMILIES.pdf);
      expect(Array.from(new Uint8Array(fonts()[0].bytes))).toEqual(Array.from(bytes));
    } finally {
      await host.stop();
    }
  });

  it("sends no font when no PDF Font is installed, so a pdf label stays a serif", async () => {
    const { host, runtime, handoff } = frameHostFor(mapStorage([]));
    try {
      expect(await runtime.openMap("m1")).toBe(true);
      const frame = recordingPort();
      handoff("frame-1", frame.port);

      // The host answers this request only after the font read it served first,
      // so a font message would already be here.
      await expect(host.broker.request("health.check", null)).resolves.toBe("pong");
      expect(frame.messages.filter(isFontMessage)).toEqual([]);
      // The Frame still drew the scene it was handed.
      expect(frame.messages).toHaveLength(1);
    } finally {
      await host.stop();
    }
  });

  it("stays on the Map with a warning when Back to Maps cannot save, then leaves once it can", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const setEntry = storage.set.bind(storage);
    let failSaves = false;
    storage.set = ((key: string, value: unknown) => {
      if (failSaves && key === mapKey("m1")) throw new Error("storage-full");
      return setEntry(key, value);
    }) as typeof storage.set;
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup();
      await selectRow(user, "Line one");
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: MOVE_RIGHT });
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).points[0][0]).toBe(11)
      );
      expect(linePoints(storage)[0][0]).toBe(10);

      failSaves = true;
      await focusPanelButton(user);
      await user.keyboard("{Enter}");

      // The write failed: the editor stays open and the page says so.
      expect(await screen.findByText(en["map.saveFailed"])).toBeInTheDocument();
      expect(runtime.currentMapId).toBe("m1");
      expect(host.pageNavigations).not.toContainEqual({
        pluginId: "maibuk-maps",
        pageId: MAPS_PAGE_ID,
      });

      // The next Back retries the pending document and leaves once it lands.
      failSaves = false;
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(host.pageNavigations).toContainEqual({
          pluginId: "maibuk-maps",
          pageId: MAPS_PAGE_ID,
        })
      );
      expect(linePoints(storage)[0][0]).toBe(11);
      expect(runtime.currentMapId).toBeNull();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("flushes autosave before Back to Maps returns to the list", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup();
      await selectRow(user, "Line one");
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: MOVE_RIGHT });
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).points[0][0]).toBe(11)
      );
      expect(linePoints(storage)[0][0]).toBe(10);

      await focusPanelButton(user);
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(host.pageNavigations).toContainEqual({
          pluginId: "maibuk-maps",
          pageId: MAPS_PAGE_ID,
        })
      );
      await waitFor(() => expect(linePoints(storage)[0][0]).toBe(11));
      expect(runtime.currentMapId).toBeNull();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("inserts a castle Stamp from the picker by keyboard, then moves, resizes, and deletes it", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup();

      // The Insert tool by its place in the tool picker, and the Stamp picker it shows.
      await pickTool(user, en["tools.insert"]);
      expect(runtime.editor?.getSnapshot().tool).toBe("insert");
      expect(runtime.editor?.getSnapshot().currentStampId).toBe("capital");

      await pickOption(user, en["properties.stamp"], en["stamp.castle"]);
      await waitFor(() => expect(runtime.editor?.getSnapshot().currentStampId).toBe("castle"));

      const place = await screen.findByRole("button", {
        name: format(en["properties.placeStamp"], { stamp: en["stamp.castle"] }),
      });
      await tabTo(user, place, 10);
      await user.keyboard("{Enter}");

      // A Castle Stamp at the page centre of the portrait page, and selected.
      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toHaveLength(1));
      const inserted = runtime.editor?.getSnapshot().elements[0] as MapStampElement;
      expect(inserted).toMatchObject({
        kind: "stamp",
        name: en["stamp.castle"],
        stampRef: "base:castle",
        transform: { x: 76.2, y: 114.3, size: 12, rotation: 0 },
      });
      expect(runtime.editor?.getSnapshot().selectedId).toBe(inserted.id);
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0]).toMatchObject({
        id: inserted.id,
        stampRef: "base:castle",
      });

      // The Elements list calls the row a Stamp, as it calls a line a Map Line.
      // The description reaches the page over the Remote UI bridge, one hop
      // after the row itself, so the assertion waits for it.
      await waitFor(() =>
        expect(screen.getByRole("listbox", { name: en["elements.label"] })).toHaveTextContent(
          en["element.kind.stamp"]
        )
      );

      // One arrow moves the selected Stamp one page millimetre.
      await focusPanelButton(user);
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapStampElement).transform.x).toBe(
          77.2
        )
      );
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapStampElement).transform.x).toBe(77.2);

      // The number fields size and turn it.
      const size = await screen.findByRole("textbox", { name: en["properties.stamp.size"] });
      await tabTo(user, size, 60);
      await user.keyboard("{Control>}a{/Control}20{Enter}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapStampElement).transform.size).toBe(
          20
        )
      );
      const rotation = screen.getByRole("textbox", { name: en["properties.stamp.rotation"] });
      await tabTo(user, rotation, 60);
      await user.keyboard("{Control>}a{/Control}30{Enter}");
      await waitFor(() =>
        expect(
          (runtime.editor?.getSnapshot().elements[0] as MapStampElement).transform.rotation
        ).toBe(30)
      );
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapStampElement).transform).toEqual({
        x: 77.2,
        y: 114.3,
        size: 20,
        rotation: 30,
      });

      // Delete takes the Stamp off the Map and off the Elements list.
      await focusPanelButton(user);
      await user.keyboard("{Delete}");
      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toHaveLength(0));
      expect(screen.queryByRole("option", { name: en["stamp.castle"] })).not.toBeInTheDocument();
      await runtime.editor?.flush();
      expect(storedMap(storage).elements).toEqual([]);

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("inserts the scale bar and sets its unit and span from the properties panel by keyboard", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup();

      await pickTool(user, en["tools.insert"]);
      await pickOption(user, en["properties.stamp"], en["stamp.scale-bar"]);
      const place = await screen.findByRole("button", {
        name: format(en["properties.placeStamp"], { stamp: en["stamp.scale-bar"] }),
      });
      await tabTo(user, place, 10);
      await user.keyboard("{Enter}");

      // The scale bar starts at 40 mm, reading the page's width in kilometres.
      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toHaveLength(1));
      expect(runtime.editor?.getSnapshot().elements[0]).toMatchObject({
        stampRef: "base:scale-bar",
        transform: { size: 40 },
        scale: { unit: "km", span: 1000 },
      });

      // The bar's size is the longest bar it may draw, so the field says so.
      const maxLength = await screen.findByRole("textbox", {
        name: en["properties.stamp.maxLength"],
      });
      expect(maxLength).toHaveValue("40");

      // The unit is a two-choice group: one arrow picks the other choice.
      const unit = await screen.findByRole("radiogroup", { name: en["properties.stamp.unit"] });
      for (let i = 0; i < 60 && !unit.contains(document.activeElement); i++) await user.tab();
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapStampElement).scale?.unit).toBe(
          "mi"
        )
      );

      const span = await screen.findByRole("textbox", { name: en["properties.stamp.span"] });
      await tabTo(user, span, 60);
      await user.keyboard("{Control>}a{/Control}500{Enter}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapStampElement).scale).toEqual({
          unit: "mi",
          span: 500,
        })
      );
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapStampElement).scale).toEqual({
        unit: "mi",
        span: 500,
      });

      // The field's minimum is a span the model keeps: typing 0 commits 1, so
      // the panel never shows a reading the Map has refused.
      await tabTo(user, span, 60);
      await user.keyboard("{Control>}a{/Control}0{Enter}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapStampElement).scale?.span).toBe(1)
      );
      expect(span).toHaveValue("1");

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("adds a Map Label at the view centre by keyboard, then writes, fonts, and bends it", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup();

      // The Insert tool offers a Map Label beside the Stamp picker; the button
      // is the keyboard path that lands it at the view centre.
      await pickTool(user, en["tools.insert"]);
      const place = await screen.findByRole("button", { name: en["properties.mapLabel.place"] });
      await tabTo(user, place, 10);
      await user.keyboard("{Enter}");

      // A Map Label at the centre of the portrait page, writing the default
      // text, and selected.
      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toHaveLength(1));
      const inserted = runtime.editor?.getSnapshot().elements[0] as MapLabelElement;
      expect(inserted).toMatchObject({
        kind: "label",
        name: "Map Label 1",
        text: "Label",
        x: 76.2,
        y: 114.3,
        rotation: 0,
        font: DEFAULT_LABEL_FONT,
        bend: 0,
      });
      expect(runtime.editor?.getSnapshot().selectedId).toBe(inserted.id);
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0]).toMatchObject({ x: 76.2, y: 114.3 });

      // The Elements list calls the row a Map Label.
      await waitFor(() =>
        expect(screen.getByRole("listbox", { name: en["elements.label"] })).toHaveTextContent(
          en["element.kind.label"]
        )
      );

      // One arrow moves the selected label one page millimetre.
      await focusPanelButton(user);
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLabelElement).x).toBe(77.2)
      );

      // The Text field writes what the author commits.
      const text = await screen.findByRole("textbox", { name: en["properties.mapLabel.text"] });
      await tabTo(user, text, 60);
      await user.keyboard("{Control>}a{/Control}Northern Reach{Enter}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLabelElement).text).toBe(
          "Northern Reach"
        )
      );
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0]).toMatchObject({ text: "Northern Reach" });

      // The Font select offers the bundled faces by family name.
      await pickOption(user, en["properties.mapLabel.font"], "Cinzel");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLabelElement).font).toBe("cinzel")
      );
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0]).toMatchObject({ font: "cinzel" });

      // Bend curves the baseline; 0 draws it straight.
      const bend = await screen.findByRole("textbox", { name: en["properties.mapLabel.bend"] });
      await tabTo(user, bend, 60);
      await user.keyboard("{Control>}a{/Control}5{Enter}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLabelElement).bend).toBe(5)
      );
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0]).toMatchObject({ bend: 5 });

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("names an installed PDF Font in the Font select, and says when none is installed", async () => {
    const storageLabel = () =>
      newLabel({
        id: "l1",
        name: "Map Label 1",
        text: "Label",
        point: [76.2, 114.3],
        font: "pdf",
      });

    const installed = frameHostFor(mapStorage([storageLabel()]), [
      { id: "latin", family: "Noto Serif", bytes: new TextEncoder().encode("FONT") },
    ]);
    try {
      expect(await installed.runtime.openMap("m1")).toBe(true);
      installed.runtime.editor?.select("l1");
      const page = await installed.host.renderPage(MAP_PAGE_ID);
      const font = await screen.findByLabelText(en["properties.mapLabel.font"]);
      await waitFor(() => expect(font).toHaveTextContent("PDF Font (Noto Serif)"));
      await page.unmount();
    } finally {
      await installed.host.stop();
    }

    const missing = frameHostFor(mapStorage([storageLabel()]));
    try {
      expect(await missing.runtime.openMap("m1")).toBe(true);
      missing.runtime.editor?.select("l1");
      const page = await missing.host.renderPage(MAP_PAGE_ID);
      const font = await screen.findByLabelText(en["properties.mapLabel.font"]);
      await waitFor(() => expect(font).toHaveTextContent(en["font.pdfNotInstalled"]));
      await page.unmount();
    } finally {
      await missing.host.stop();
    }
  });

  it("turns Soft Edge on a Fill and a Map Line by keyboard, and fades it further with the arrows", async () => {
    const storage = mapStorage([
      areaFill({ color: DEFAULT_FILL_COLOR }),
      line(
        "ring",
        "Ring",
        [
          [20, 20],
          [70, 20],
          [70, 70],
        ],
        { closed: true, curves: [false, false, false] }
      ),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup();
      await selectRow(user, "Fill 1");

      const toggle = await screen.findByRole("switch", { name: en["properties.softEdge"] });
      await tabTo(user, toggle, 60);
      expect(toggle).toHaveFocus();
      await user.keyboard(" ");
      await waitFor(() => expect(fillNow(runtime).softEdge).toBe(DEFAULT_SOFT_EDGE_MM));

      const amount = await screen.findByRole("slider", { name: en["properties.softEdgeAmount"] });
      await tabTo(user, amount, 10);
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect(fillNow(runtime).softEdge).toBe(DEFAULT_SOFT_EDGE_MM + SOFT_EDGE_STEP_MM)
      );
      await runtime.editor?.flush();
      expect(storedFill(storage).softEdge).toBe(DEFAULT_SOFT_EDGE_MM + SOFT_EDGE_STEP_MM);

      // A Map Line takes the same two controls, and its own amount: the panel
      // shows the Line's value, not the one the Fill left behind.
      await backToRows(user);
      await selectRow(user, "Ring");
      const lineToggle = await screen.findByRole("switch", { name: en["properties.softEdge"] });
      await tabTo(user, lineToggle, 60);
      await user.keyboard(" ");
      await waitFor(() => expect(lineNow(runtime).softEdge).toBe(DEFAULT_SOFT_EDGE_MM));

      const lineAmount = await screen.findByRole("slider", {
        name: en["properties.softEdgeAmount"],
      });
      await tabTo(user, lineAmount, 10);
      expect(lineAmount).toHaveFocus();
      // The Line's amount is its own: one step down lands on 1.5, not on the
      // 2 the Fill's slider had moved to.
      await user.keyboard("{ArrowLeft}");
      await waitFor(() =>
        expect(lineNow(runtime).softEdge).toBe(DEFAULT_SOFT_EDGE_MM - SOFT_EDGE_STEP_MM)
      );
      await runtime.editor?.flush();
      expect(storedLine(storage).softEdge).toBe(DEFAULT_SOFT_EDGE_MM - SOFT_EDGE_STEP_MM);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("picks a texture and a scatter by keyboard, respaces and reseeds it, and clears one kind", async () => {
    const storage = mapStorage([areaFill({ color: DEFAULT_FILL_COLOR })]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup();
      await selectRow(user, "Fill 1");

      await pickOption(user, en["properties.fillTexture"], en["properties.texture.grass"]);
      await waitFor(() => expect(fillNow(runtime).content.texture).toBe("grass"));

      // A Fill that first takes a scatter picks a Stamp from the base picker and
      // starts from a fresh seed.
      await pickOption(user, en["properties.fillScatter"], en["stamp.castle"]);
      await waitFor(() => expect(fillNow(runtime).content.scatter?.stamp).toBe("base:castle"));
      const firstSeed = fillNow(runtime).content.scatter?.seed ?? 0;
      expect(firstSeed).toBeGreaterThan(0);
      expect(fillNow(runtime).content.scatter?.spacing).toBe(DEFAULT_SCATTER_SPACING_MM);

      const spacing = await screen.findByRole("slider", { name: en["properties.scatterSpacing"] });
      await tabTo(user, spacing, 60);
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect(fillNow(runtime).content.scatter?.spacing).toBe(DEFAULT_SCATTER_SPACING_MM + 1)
      );
      expect(fillNow(runtime).content.scatter?.seed).toBe(firstSeed);

      // Reseed keeps the Stamp and the spacing, and moves the Stamps.
      const reseed = await screen.findByRole("button", { name: en["properties.reseed"] });
      await tabTo(user, reseed, 10);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(fillNow(runtime).content.scatter?.seed).not.toBe(firstSeed));

      // The colour and the scatter still cover the Fill, so the texture may go.
      await backToRows(user);
      await pickOption(user, en["properties.fillTexture"], en["properties.none"]);
      await waitFor(() => expect(fillNow(runtime).content.texture).toBeUndefined());
      await runtime.editor?.flush();
      expect(storedFill(storage).content).toMatchObject({
        color: "land",
        scatter: { stamp: "base:castle" },
      });
      expect(storedFill(storage).content.texture).toBeUndefined();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("refuses to remove the last kind a Fill has, from the keyboard", async () => {
    const storage = mapStorage([areaFill({ texture: "hatching" })]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup();
      await selectRow(user, "Fill 1");

      await pickOption(user, en["properties.fillTexture"], en["properties.none"]);

      // A pick the Worker refuses leaves the Fill as it was: the scatter that
      // lands afterwards proves the refusal was answered, not still in flight.
      await backToRows(user);
      await pickOption(user, en["properties.fillScatter"], en["stamp.castle"]);
      await waitFor(() => expect(fillNow(runtime).content.scatter?.stamp).toBe("base:castle"));

      expect(fillNow(runtime).content.texture).toBe("hatching");
      expect(screen.getByLabelText(en["properties.fillTexture"])).toHaveTextContent(
        en["properties.texture.hatching"]
      );

      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});
