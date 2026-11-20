/**
 * Shared fixtures for the Maps page and Map editor tests (#744): the real
 * broker, in-memory Plugin storage and Library, and the host's Remote UI
 * renderer through the supported Plugin test kit. Split out of one test file
 * so each file runs in its own shard slot (#850). Importing this module
 * registers its `afterEach` cleanups in the importing file.
 */

import { readFileSync } from "node:fs";
import { useEffect } from "react";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, vi } from "vitest";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";
import { createTestHost as createKitHost } from "@/features/plugins/test-kit";
import type { TestHost, TestPdfFont } from "@/features/plugins/types";
import {
  registerPluginCommands,
  type CommandId,
  type PluginCommandDeclaration,
} from "@/lib/shortcut-registry";
import { useShortcuts } from "@/lib/shortcuts";
import { createPluginClient, type PluginClient, type PluginFrame } from "@/plugin-sdk";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import { type MapEditor } from "./editor";
import { ASSETS_KEY, assetKey, type AssetIndexEntry, type MapAsset } from "./assets";
import type { FrameFontMessage } from "./frame-protocol";
import en from "./locales/runtime/en.json";
import {
  INDEX_KEY,
  mapKey,
  type MapDocument,
  type MapElement,
  type MapFillContent,
  type MapFillElement,
  type MapIndexEntry,
  type MapImageElement,
  type MapLineElement,
} from "./maps";
import { startMaps, type MapsRuntime } from "./runtime";

// Every test sets up user-event with `delay: null`: the default waits a
// macrotask between key presses, which was 40% of a keyboard test's time and
// none of its coverage (#850). Events still dispatch in order.
export type User = ReturnType<typeof userEvent.setup>;

/**
 * vitest's jsdom environment puts jsdom's own realm's `Uint8Array` and
 * `ArrayBuffer` on the global, while the host `TextEncoder` still produces the
 * host ones. The export tests then hand the SDK the Plugin's own encoded bytes,
 * which fail its `bytes instanceof Uint8Array` check on `files.save`, and hand
 * the editor a rasterizer's `ArrayBuffer` its own parse refuses. The host
 * intrinsics are put back in every file that imports this module, as
 * `src/test/support/bundle-plugin-fixture.ts` does for its bundle.
 */
export const hostBytes = new TextEncoder().encode("");
export const globalsWithBytes = globalThis as {
  Uint8Array: Uint8ArrayConstructor;
  ArrayBuffer: ArrayBufferConstructor;
};
globalsWithBytes.Uint8Array = hostBytes.constructor as Uint8ArrayConstructor;
globalsWithBytes.ArrayBuffer = hostBytes.buffer.constructor as ArrayBufferConstructor;

/**
 * The Map Frame's own files (#750), read from the Plugin folder: the keyboard
 * test below runs the real `assets/ui/map.js`, so its crosshair answers real
 * key presses and posts the real messages the open editor keeps.
 */
export const FRAME_LIBRARY = readFileSync(
  join(__dirname, "assets/ui/lib/htm-preact-standalone.umd.js"),
  "utf8"
);
export const FRAME_SCRIPT = readFileSync(join(__dirname, "assets/ui/map.js"), "utf8");

export const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/**
 * Every host a test opened. A test that times out stops awaiting, but its body
 * keeps running and its pages stay in the document, where the next test's
 * `screen` queries find them (#770). Stopping each host here unmounts them even
 * when the test never reached its own `host.stop()`; stopping twice is a no-op.
 */
export const openHosts = new Set<TestHost>();
afterEach(async () => {
  for (const host of openHosts) await host.stop();
  openHosts.clear();
});

export function createTestHost(...args: Parameters<typeof createKitHost>): TestHost {
  const host = createKitHost(...args);
  openHosts.add(host);
  return host;
}

export function mapsManifest() {
  const result = parsePluginManifest(readFileSync(join(__dirname, "manifest.json"), "utf8"), {
    builtIn: true,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.manifest;
}

export function book(id: string, title: string) {
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

export const BOOKS = [book("b1", "Tides of Ash"), book("b2", "The Salt Road")];

export function entry(
  id: string,
  name: string,
  bookId: string | null,
  updatedAt: number
): MapIndexEntry {
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
export function seededStorage(): Map<string, unknown> {
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

export function hostFor(storage = new Map<string, unknown>(), language = "en") {
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
export function frameHostFor(storage: Map<string, unknown>, pdfFonts: TestPdfFont[] = []) {
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
export function recordingPort(): { port: MessagePort; messages: unknown[] } {
  const messages: unknown[] = [];
  const port = {
    onmessage: null,
    start: () => {},
    postMessage: (message: unknown) => messages.push(message),
  } as unknown as MessagePort;
  return { port, messages };
}

/** Whether one recorded Frame message carries the author's PDF Font. */
export function isFontMessage(message: unknown): message is FrameFontMessage {
  return (message as { kind?: unknown } | null)?.kind === "font";
}

/**
 * A mounted Frame stand-in for the export (#753): it answers every rasterize
 * request with `bytes`, the way the real Frame draws the SVG into a canvas and
 * hands the encoded picture back, and records every message the editor posts.
 * It attaches straight to the open editor, so a test needs no host handoff.
 */
export function frameStandIn(
  editor: MapEditor | null,
  bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  answerIngest?: (message: Record<string, unknown>) => Record<string, unknown> | null
): { port: MessagePort; messages: Array<Record<string, unknown>> } {
  const messages: Array<Record<string, unknown>> = [];
  const port = {
    onmessage: null,
    start: () => {},
    postMessage: (message: Record<string, unknown>) => {
      messages.push(message);
      if (message.kind === "ingest-asset") {
        const reply = answerIngest?.(message);
        if (reply !== undefined && reply !== null) editor?.handleFrameMessage(reply);
        return;
      }
      if (message.kind !== "rasterize") return;
      editor?.handleFrameMessage({
        kind: "rasterized",
        requestId: message.requestId,
        bytes: bytes.slice().buffer,
      });
    },
  } as unknown as MessagePort;
  editor?.attachFrame(port);
  return { port, messages };
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
export function loadMapFrame(runtime: MapsRuntime): MessagePort {
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

/**
 * A host and runtime for the Export and Place tests (#753). Every host call is
 * the real one: the suites below stub `Blob` for Node's, so a saved picture
 * crosses jsdom's MessageChannel and lands in `host.files.saves`, and
 * `host.files.queueSaveCancel()` stands for the dialog the author closed.
 */
export function exportHostFor(storage: Map<string, unknown>) {
  const host = createTestHost({
    manifest: mapsManifest(),
    library: { books: BOOKS },
    storage,
    language: "en",
  });
  const runtime = startMaps(createPluginClient(host.port), servePluginUi);
  return { host, runtime };
}

/** The Chapters and Notes the Place tests reach: two Chapters and a Note. */
export const PLACE_CHAPTERS = [
  {
    id: "c1",
    bookId: "b1",
    title: "Chapter One",
    order: 1,
    parentId: null,
    chapterType: "chapter" as const,
    wordCount: 0,
    status: "draft" as const,
    updatedAt: 1,
  },
  {
    id: "c2",
    bookId: "b2",
    title: "A Chapter of the Salt Road",
    order: 1,
    parentId: null,
    chapterType: "chapter" as const,
    wordCount: 0,
    status: "draft" as const,
    updatedAt: 1,
  },
];

/** The one Note the Place tests reach, filed under the Map's Book. */
export const PLACE_NOTES = [
  {
    id: "n1",
    bookId: "b1",
    title: "Field Notes",
    language: "en",
    tags: [],
    wordCount: 0,
    updatedAt: 1,
  },
];

/**
 * A host whose Library holds a Chapter and a Note for the Map's Book, and a
 * Chapter of the other Book. The kit serves no editor (`editor.insert` is not
 * one of its rows) and the Maps page is its own route, so the one insert call a
 * Place makes is answered at the SDK seam; the Library read, the navigation,
 * and the notification are the real host.
 */
export function placeHostFor(
  storage: Map<string, unknown>,
  chapters: typeof PLACE_CHAPTERS = PLACE_CHAPTERS
) {
  const host = createTestHost({
    manifest: mapsManifest(),
    library: { books: BOOKS, chapters, notes: PLACE_NOTES },
    storage,
    language: "en",
  });
  const client = createPluginClient(host.port);
  const insert = vi.spyOn(client.editor, "insert").mockResolvedValue({ status: "applied" });
  const runtime = startMaps(client, servePluginUi);
  return { host, runtime, insert };
}

/** A host and the runtime that owns the open Map, for the editor tests. */
export function editorHostFor(storage: Map<string, unknown>, language = "en") {
  const host = createTestHost({
    manifest: mapsManifest(),
    library: { books: BOOKS },
    storage,
    language,
  });
  const runtime = startMaps(createPluginClient(host.port), servePluginUi);
  return { host, runtime };
}

export function line(
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
export function areaFill(content: MapFillContent): MapFillElement {
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
export function mapStorage(elements: MapElement[]): Map<string, unknown> {
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

export function storedMap(storage: Map<string, unknown>): MapDocument {
  return storage.get(mapKey("m1")) as MapDocument;
}

/** A PNG's bytes, base64, as the Library stores one picture. */
export const PICTURE_DATA = "iVBORw0KGgo=";

/**
 * The storage of a Map drawing one uploaded picture twice (#756): the Map Image
 * `trace`, which exports, and `kept`, which the author left out of them. The
 * Library holds the picture the Map names.
 */
export function pictureStorage(): Map<string, unknown> {
  const image = (id: string, exportable: boolean): MapImageElement => ({
    id,
    kind: "image",
    name: id,
    hidden: false,
    locked: false,
    assetRef: "a1",
    transform: { x: 76.2, y: 60, size: 80, rotation: 0 },
    opacity: 1,
    exportable,
  });
  const storage = mapStorage([image("trace", true), image("kept", false)]);
  const row: AssetIndexEntry = {
    id: "a1",
    name: "Trace",
    mime: "image/png",
    width: 40,
    height: 20,
    recolorable: false,
    use: "image",
  };
  storage.set(ASSETS_KEY, [row]);
  storage.set(assetKey("a1"), { ...row, data: PICTURE_DATA });
  return storage;
}

/** Registers the manifest's Commands so the harness can bind their keys. */
/** Whether this test registered the Maps Commands, so `pickTool` does not twice. */
let mapCommandsRegistered = false;
/** Whether a `CommandKeys` is mounted, so `pickTool` does not mount a second. */
let commandKeysMounted = false;

export function registerMapCommands(): void {
  const unregister = registerPluginCommands("maibuk-maps", {
    defaultLanguage: "en",
    pages: ["maps", "map"],
    commands: (mapsManifest().contributes?.commands ?? []) as PluginCommandDeclaration[],
  });
  mapCommandsRegistered = true;
  cleanups.push(() => {
    unregister();
    mapCommandsRegistered = false;
  });
}

/** The host's PluginCommands stand-in: the same registry ids and `useShortcuts`. */
export function CommandKeys({ host }: { host: TestHost }) {
  const commands = (mapsManifest().contributes?.commands ?? []) as PluginCommandDeclaration[];
  useEffect(() => {
    commandKeysMounted = true;
    return () => {
      commandKeysMounted = false;
    };
  }, []);
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
export async function openEditor(
  storage: Map<string, unknown>,
  language = "en"
): Promise<{ host: TestHost; runtime: MapsRuntime }> {
  const { host, runtime } = editorHostFor(storage, language);
  expect(await runtime.openMap("m1")).toBe(true);
  return { host, runtime };
}

/** The Elements list the Layers card draws: the page's one list. */
export function elementsList(): HTMLElement {
  return screen.getByRole("list");
}

/**
 * Tabs to a row of the Elements list and selects it with Enter. Every row is
 * plain buttons, so Tab walks the list; the selection shows in the Properties
 * card's Name field.
 */
export async function selectRow(user: User, name: string): Promise<HTMLElement> {
  await openLayers(user);
  // The list can draw before its rows arrive: wait for the row itself.
  const list = await screen.findByRole("list");
  const row = await within(list).findByRole("button", { name: new RegExp(`^${name}`) });
  await tabTo(user, row, 300);
  await user.keyboard("{Enter}");
  await waitFor(() =>
    expect(
      (screen.getByRole("textbox", { name: en["properties.name"] }) as HTMLInputElement).value
    ).toMatch(new RegExp(`^${name}`))
  );
  return row;
}

/** Tabs from the focused row to its menu, opens it, and runs one entry by keyboard. */
export async function chooseRowMenu(user: User, label: string): Promise<void> {
  const item = (document.activeElement as HTMLElement | null)?.closest("li");
  if (item === null || item === undefined) throw new Error("no row has focus");
  const buttons = within(item).getAllByRole("button");
  const trigger = buttons[buttons.length - 1];
  await tabTo(user, trigger, 5);
  await user.keyboard("{Enter}");
  const dialog = await screen.findByRole("dialog");
  const target = await within(dialog).findByRole("button", { name: label });
  await tabTo(user, target, 10);
  await user.keyboard("{Enter}");
  // Only the menu's own popover shuts: an entry such as Rename opens a dialog.
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
}

/** Focuses a plain host button, away from the Elements list's own arrows. */
export async function focusPanelButton(user: User): Promise<HTMLElement> {
  const button = screen.getByRole("button", { name: en["map.backToMaps"] });
  await tabTo(user, button, 120);
  return button;
}

export function linePoints(storage: Map<string, unknown>, index = 0): [number, number][] {
  const element = storedMap(storage).elements[index] as MapLineElement;
  return element.points.map(([x, y]) => [x, y]);
}

/** The page's Tab stops in order: what `user.tab()` walks. */
export function tabStops(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]'
    )
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !(element as HTMLButtonElement).disabled &&
      element.closest("[inert], [hidden]") === null
  );
}

/**
 * Tabs to `element`, by keyboard alone, the shorter way round: a control late in
 * the order is a few Shift+Tabs away rather than dozens of Tabs, and each press
 * crosses the Plugin's thread (#770). The order is read from the DOM; Tab wraps,
 * so either way still arrives, and `max` bounds the presses.
 */
export async function tabTo(user: User, element: HTMLElement, max = 120): Promise<void> {
  const stops = tabStops();
  const from = stops.indexOf(document.activeElement as HTMLElement);
  const to = stops.indexOf(element);
  const forward = (to - from + stops.length) % stops.length;
  const shift = from >= 0 && to >= 0 && stops.length - forward < forward;
  for (let i = 0; i < max && document.activeElement !== element; i++) await user.tab({ shift });
}

/** Tabs back into the Elements list, so a row can be picked again. */
export async function backToRows(user: User): Promise<HTMLElement> {
  await openLayers(user);
  const list = elementsList();
  for (let i = 0; i < 300 && !list.contains(document.activeElement); i++)
    await user.tab({ shift: true });
  return list;
}

/** The Fill the open editor holds. */
export function fillNow(runtime: MapsRuntime): MapFillElement {
  const element = runtime.editor
    ?.getSnapshot()
    .elements.find((candidate): candidate is MapFillElement => candidate.kind === "fill");
  if (element === undefined) throw new Error("no Fill");
  return element;
}

/** The Map Line the open editor holds. */
export function lineNow(runtime: MapsRuntime): MapLineElement {
  const element = runtime.editor
    ?.getSnapshot()
    .elements.find((candidate): candidate is MapLineElement => candidate.kind === "line");
  if (element === undefined) throw new Error("no Map Line");
  return element;
}

/** The Fill the stored Map holds. */
export function storedFill(storage: Map<string, unknown>): MapFillElement {
  const element = storedMap(storage).elements.find(
    (candidate): candidate is MapFillElement => candidate.kind === "fill"
  );
  if (element === undefined) throw new Error("no stored Fill");
  return element;
}

/** The Map Line the stored Map holds. */
export function storedLine(storage: Map<string, unknown>): MapLineElement {
  const element = storedMap(storage).elements.find(
    (candidate): candidate is MapLineElement => candidate.kind === "line"
  );
  if (element === undefined) throw new Error("no stored Map Line");
  return element;
}

/** Each tool's belt label, mapped to the key its `<tool>Tool` Command defaults to. */
export const TOOL_KEYS = new Map(
  ((mapsManifest().contributes?.commands ?? []) as PluginCommandDeclaration[])
    .filter((command) => command.id.endsWith("Tool"))
    .map((command) => [
      en[`tools.${command.id.slice(0, -"Tool".length)}` as keyof typeof en],
      command.defaults?.[0]?.[0] ?? "",
    ])
);

/**
 * Picks a tool by its Shortcut, the way an author does without the belt.
 * Tabbing to the belt cost each call a dozen or more presses, which a loaded
 * Release runner turned into most of a test's budget (#770); the belt's own
 * Tab path is proven by the tests that pick from it. The host's shortcut layer
 * is mounted here when the test did not mount it, and a letter is pressed from
 * a plain button, never a text field or the Elements list, which take letters.
 */
export async function pickTool(user: User, name: string): Promise<HTMLElement> {
  const button = await screen.findByRole("button", { name });
  const key = TOOL_KEYS.get(name);
  if (!key) throw new Error(`no Shortcut for the tool "${name}"`);
  if (!mapCommandsRegistered) registerMapCommands();
  const host = [...openHosts].at(-1);
  if (!commandKeysMounted && host) render(<CommandKeys host={host} />);
  const active = document.activeElement;
  if (
    active === null ||
    active === document.body ||
    active.matches("input, textarea, [contenteditable]") ||
    active.closest('[role="list"], ul, [role="listbox"]') !== null
  )
    await focusPanelButton(user);
  await user.keyboard(key);
  await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
  return button;
}

/** Whether the belt reports `name` as the picked tool. */
export function pickedTool(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

/**
 * Opens the Layers card, which starts shut (#778), and waits for the list. A
 * page in another language passes its own label: the English one is there only
 * until the page's first render in that language lands.
 */
export async function openLayers(user: User, label = en["chrome.layers"]): Promise<void> {
  const toggle = await screen.findByRole("button", { name: label });
  if (toggle.getAttribute("aria-pressed") === "false") {
    await tabTo(user, toggle, 120);
    await user.keyboard("{Enter}");
  }
  await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
}

/** Shuts the Layers card, when it is open. */
export async function closeLayers(user: User): Promise<void> {
  const toggle = await screen.findByRole("button", { name: en["chrome.layers"] });
  if (toggle.getAttribute("aria-pressed") === "true") {
    await tabTo(user, toggle, 120);
    await user.keyboard("{Enter}");
  }
  await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "false"));
}

/** Opens the Export popover (#778) and waits for its one button. */
export async function openExport(user: User): Promise<HTMLElement> {
  const trigger = await screen.findByRole("button", { name: en["export.label"] });
  await tabTo(user, trigger, 120);
  await user.keyboard("{Enter}");
  return screen.findByRole("button", { name: en["export.save"] });
}

/** Opens the Map Style popover (#778) and picks one Style from its radio group. */
export async function pickMapStyle(user: User, style: string): Promise<void> {
  const trigger = await screen.findByRole("button", { name: en["properties.mapStyle"] });
  await tabTo(user, trigger, 120);
  await user.keyboard("{Enter}");
  const group = await screen.findByRole("radiogroup", { name: en["properties.mapStyle"] });
  const option = within(group).getByRole("radio", { name: style });
  const radios = within(group).getAllByRole("radio") as HTMLInputElement[];
  const start = Math.max(
    0,
    radios.findIndex((radio) => radio.checked)
  );
  await tabTo(user, radios[start], 4);
  // Each arrow's pick comes back one host batch later, so sampling `checked`
  // between presses overshoots: count the steps, and wait for each one.
  const steps =
    (radios.indexOf(option as HTMLInputElement) - start + radios.length) % radios.length;
  for (let i = 1; i <= steps; i++) {
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(radios[(start + i) % radios.length]).toBeChecked());
  }
  expect(option).toBeChecked();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument());
}

/** Picks a Shape tool by keyboard, then places one with its Place button. */
export async function placeShape(
  user: User,
  tool: "ellipse" | "rectangle" | "polygon"
): Promise<void> {
  await pickTool(user, en[`tools.${tool}`]);
  const place = await screen.findByRole("button", { name: en[`properties.placeShape.${tool}`] });
  await tabTo(user, place, 120);
  await user.keyboard("{Enter}");
}

/** Focuses a select's trigger and picks an option by arrow keys. */
export async function pickOption(
  user: User,
  label: string,
  option: string,
  scope: HTMLElement = document.body
) {
  // The page draws what the editor last published, so a control the last press
  // opened can arrive one host batch later: wait for it, never sample it.
  const trigger = await within(scope).findByLabelText(label);
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

/** Picks a Stamp from the Insert grid by keyboard: Tab to its tile, then Enter. */
export async function pickStamp(user: User, name: string): Promise<HTMLElement> {
  const tile = await screen.findByRole("button", { name });
  await tabTo(user, tile, 200);
  expect(tile).toHaveFocus();
  await user.keyboard("{Enter}");
  return tile;
}

/** The picture a Stamp's tile draws, as the SVG its data URI carries. */
export function tilePicture(tile: HTMLElement): string {
  const src = within(tile).getByRole("img").getAttribute("src") ?? "";
  expect(src.startsWith("data:image/svg+xml,")).toBe(true);
  return decodeURIComponent(src.slice("data:image/svg+xml,".length));
}

export function names(): string[] {
  const list = screen.queryByRole("list");
  if (list === null) return [];
  return within(list)
    .getAllByRole("listitem")
    .map((item) => within(item).getByRole("img").getAttribute("alt") ?? "");
}

export function index(storage: Map<string, unknown>): MapIndexEntry[] {
  return storage.get(INDEX_KEY) as MapIndexEntry[];
}

// The upload tests' own fixtures (#756).
/** The SVG the upload tests hand the picker, as the bytes a File Grant holds. */
export const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="40" height="20"/></svg>';
export const svgBytes = () => new TextEncoder().encode(SVG);

/** Every Library picture the storage's index lists. */
export function storedAssets(storage: Map<string, unknown>): AssetIndexEntry[] {
  return (storage.get(ASSETS_KEY) as AssetIndexEntry[] | undefined) ?? [];
}

/** The one picture the storage keeps under `id`. */
export function storedAsset(storage: Map<string, unknown>, id: string): MapAsset {
  return storage.get(assetKey(id)) as MapAsset;
}

/** Saves one picture's index row and bytes into a storage, as an earlier upload did. */
export function seedAsset(storage: Map<string, unknown>, row: AssetIndexEntry): void {
  storage.set(ASSETS_KEY, [...storedAssets(storage), row]);
  storage.set(assetKey(row.id), { ...row, data: PICTURE_DATA });
}

/** Adds a second Map to the storage, so the Library can be read from another Map. */
export function addMap(storage: Map<string, unknown>, id: string, name: string): void {
  const rows = (storage.get(INDEX_KEY) as MapIndexEntry[] | undefined) ?? [];
  storage.set(INDEX_KEY, [...rows, entry(id, name, "b1", 10)]);
  storage.set(mapKey(id), {
    id,
    name,
    bookId: "b1",
    page: { preset: "portrait", widthMm: 152.4, heightMm: 228.6 },
    elements: [],
    styleId: "atlas",
    overrides: {},
    createdAt: 1,
    updatedAt: 1,
    dataVersion: 1,
  } satisfies MapDocument);
}

/** The reply a Frame sends for an ingest: its sanitized bytes and measured size. */
export function ingested(message: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: "asset-ingested",
    requestId: message.requestId,
    data: message.data,
    width: 40,
    height: 20,
    recolorable: true,
  };
}

/** Tabs to the Insert panel's Upload button. */
export async function tabToUpload(user: User): Promise<HTMLElement> {
  const upload = await screen.findByRole("button", { name: en["properties.upload"] });
  await tabTo(user, upload, 120);
  return upload;
}
