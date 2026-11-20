// Shared setup and helpers for the Command Palette tests (#851).
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { mockVirtualizerLayout } from "@/test/support/virtualizer-layout";

// The palette dialog over the real app on a real in-memory Library, driven
// with real keys. Only what jsdom cannot run is stubbed: the Fabric cover
// stage, React Flow's canvas surface, the metrics worker, Dictation, and the
// update check. Prior art: tutorial-app.test.tsx, navigating-commands.test.tsx.
const hoisted = vi.hoisted(() => ({
  authorDb: { current: null as DatabaseAdapter | null },
  platform: { desktop: true },
  web: { value: false },
  // While set, the indexed Library search answers nothing, as an index that is
  // still filling would.
  indexBlank: { value: false },
}));

// A hoisted binding cannot carry `export` itself, so each one is exported by alias.
export const authorDb = hoisted.authorDb;
export const platform = hoisted.platform;
export const web = hoisted.web;
export const indexBlank = hoisted.indexBlank;

vi.mock("@/features/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/search")>();
  return {
    ...actual,
    searchLibrary: vi.fn(async (...args: Parameters<typeof actual.searchLibrary>) => {
      if (indexBlank.value) return { results: [] };
      return actual.searchLibrary(...args);
    }),
  };
});

vi.mock("@/lib/platform/target", () => ({
  get IS_WEB() {
    return web.value;
  },
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  get IS_DESKTOP() {
    return platform.desktop;
  },
  createDatabase: vi.fn(async () => authorDb.current),
  createBackup: vi.fn(async () => ({
    listBackups: async () => [],
    listBackupsPage: async () => ({
      entries: [],
      totalCount: 0,
      totalSizeBytes: 0,
      page: 1,
      pageSize: 10,
    }),
  })),
  isLaunchOnStartupEnabled: vi.fn(async () => false),
  setLaunchOnStartup: vi.fn(async () => undefined),
}));

vi.mock("@/lib/metrics/MetricsService", () => ({
  metricsService: {
    init: vi.fn(async () => undefined),
    recordEvents: vi.fn(),
    markActive: vi.fn(),
    endSession: vi.fn(),
    discardSession: vi.fn(),
    flushNow: vi.fn(async () => undefined),
    getAggregate: vi.fn(async () => ({})),
    shutdown: vi.fn(),
  },
}));

// The launch check would reach GitHub; release-check.test.ts covers it. The
// rest of the module stays real: the Release Notes dialog mounts app-wide and
// reads its notes from here, so a stub listing one export throws on the others.
vi.mock("@/features/releases/release-check", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/releases/release-check")>()),
  installReleaseCheck: () => () => {},
}));

vi.mock("@/features/backup/lifecycle", () => ({
  // The launch Backup never settles here, so the Version storage upgrade never starts.
  hasLaunchBackupSettled: vi.fn(() => false),
  onLaunchBackupSettled: vi.fn(() => () => {}),
  scheduleDailyBackup: vi.fn(),
  runBackgroundBackup: vi.fn(async () => undefined),
  createDailyBackup: vi.fn(async () => undefined),
}));

const dictationRuntime = vi.hoisted(() => ({
  getDictation: vi.fn(),
}));

vi.mock("@/features/dictation/runtime", () => ({
  getDictation: dictationRuntime.getDictation,
  resetDictationForTests: vi.fn(),
}));

dictationRuntime.getDictation.mockImplementation(async () => ({
  session: {
    toggle: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    setLanguage: vi.fn(async () => {}),
    getSnapshot: () => ({ status: "idle" }),
  },
  host: { start: vi.fn(async () => {}), load: vi.fn(async () => {}) },
  install: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  cancelInstall: vi.fn(),
  setNotifier: vi.fn(),
  stats: {
    summary: () => ({
      lines: 0,
      medianLatencyMs: null,
      medianInterpreterMs: null,
      maxInterpreterMs: null,
      spokenPunctuationCount: 0,
      scratchCount: 0,
      voiceCommandCount: 0,
      voiceCommandUnavailableCount: 0,
      voiceCommandRefusedCount: 0,
    }),
  },
}));

vi.mock("@/components/cover-editor/CanvasStage", () => ({
  CanvasStage: () => <div data-testid="cover-stage" />,
}));

vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="react-flow">{children}</div>
  ),
  useReactFlow: () => ({
    fitView: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    screenToFlowPosition: (point: { x: number; y: number }) => point,
    flowToScreenPosition: (point: { x: number; y: number }) => point,
    getZoom: () => 1,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: vi.fn(),
  }),
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ transform: [0, 0, 1], width: 800, height: 600 }),
  // `CanvasBackground` reads the pane and subscribes to pans through the store
  // API; the mocked `ReactFlow` renders its children without the provider.
  useStoreApi: () => ({
    getState: () => ({ transform: [0, 0, 1], width: 800, height: 600 }),
    subscribe: () => () => {},
  }),
  ViewportPortal: ({ children }: { children: React.ReactNode }) => children,
}));

// ProseMirror measures the selection while handling real keyboard events, but
// jsdom does not implement these geometry methods on every possible node.
const emptyRect: DOMRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
};
const emptyRects = (): DOMRectList =>
  ({ 0: emptyRect, length: 1, item: () => emptyRect }) as unknown as DOMRectList;

for (const prototype of [Range.prototype, Text.prototype, Comment.prototype]) {
  const geometry = prototype as unknown as {
    getClientRects?: () => DOMRectList;
    getBoundingClientRect?: () => DOMRect;
  };
  geometry.getClientRects ??= emptyRects;
  geometry.getBoundingClientRect ??= () => emptyRect;
}

// jsdom cannot scroll: lists scroll their selection into view.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
// Reading Position probes the caret's coordinates; jsdom has no layout.
(document as Document & { elementFromPoint?: () => null }).elementFromPoint ??= () => null;

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
let restoreLayout: () => void;
const measuredRect = {
  width: 800,
  height: 400,
  top: 0,
  left: 0,
  bottom: 400,
  right: 800,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

beforeAll(() => {
  // The Virtualizer lays rows out from the scroll view's size, which jsdom
  // reports as 0.
  restoreLayout = mockVirtualizerLayout({ width: 900, height: 4000 });
  Element.prototype.getBoundingClientRect = () => measuredRect as DOMRect;
});

afterAll(() => {
  restoreLayout();
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

const i18n = (await import("@/i18n")).default;
const App = (await import("@/App")).default;
const { closeDatabase } = await import("@/lib/db");
export const { createBookRow } = await import("@/features/books/write");
export const { createChapterRow, updateChapterRow } = await import("@/features/chapters/write");
export const { createNoteRow } = await import("@/features/notes/write");
export const { createCanvasRow } = await import("@/features/canvas/write");
export const { getDatabase } = await import("@/lib/db");
export const librarySwitch = await import("@/features/tutorial/library-switch");
const { useTutorialStore, EMPTY_TUTORIAL_PROGRESS } = await import("@/features/tutorial");
export const { useSettingsStore } = await import("@/features/settings/store");
export const { useBookStore } = await import("@/features/books/store");
export const { useSettingsRevealStore } = await import("@/features/settings/settings-reveal-store");
export const { useNoteStore } = await import("@/features/notes/store");
const { useCanvasStore } = await import("@/features/canvas/store");
const { useEphemeralStore } = await import("@/features/ephemeral/store");
const { useThemeStore } = await import("@/features/theme/store");
export const { useDictationStore } = await import("@/features/dictation/store");
const { useShortcutSettingsStore } = await import("@/features/settings/shortcut-store");
export const { useBoundShortcutStore } = await import("@/lib/bound-shortcuts");
const { useModalStore } = await import("@/components/ui/modal-store");
const { useCommandPaletteStore } = await import("@/features/command-palette/store");
export const { useCommandPaletteRecentStore } = await import(
  "@/features/command-palette/recent-store"
);
export const { useSearchSwitchesStore, SEARCH_SWITCHES_STORAGE_KEY } = await import(
  "@/features/search/switches"
);
const { DEFAULT_SHORTCUT_SETTINGS } = await import("@/lib/shortcut-resolve");
const { resetSyncEngineForTests } = await import("@/features/sync/sync-engine");
export const { requestSearchRebuild, resetSearchIndexForTests } = await import(
  "@/features/search/rebuild"
);
const { resetAutoSyncForTests } = await import("@/features/sync/auto-sync");
export const { lastFocusedEditor } = await import("@/components/editor/editor-command-source");
export const { runCommand } = await import("@/lib/command-runner");
export const { defaultWholeLinePhrases } = await import("@/features/dictation/voice-commands");

export const en = (key: string, options?: Record<string, unknown>) =>
  (i18n.t as unknown as (k: string, o?: Record<string, unknown>) => string)(key, {
    lng: "en",
    ...options,
  });

export let path = "/";
function LocationProbe() {
  path = useLocation().pathname;
  return null;
}

export function renderApp(initialPath = "/") {
  path = initialPath;
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
      <LocationProbe />
    </MemoryRouter>
  );
}

export async function settleOn(screenPath: string) {
  await waitFor(() => expect(path).toBe(screenPath));
  await waitFor(() => expect(document.querySelector("[data-route-heading]")).not.toBeNull());
  // A screen binds its Commands once it has mounted; the palette lists them.
  await waitFor(() =>
    expect(Object.keys(useBoundShortcutStore.getState().counts).length).toBeGreaterThan(0)
  );
}

export const PALETTE_NAME = "Command palette";
export const COMMANDS_PREFIX = ">";

export async function openPaletteWithF1(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{F1}");
  return screen.findByRole("dialog", { name: PALETTE_NAME });
}

/** Opens the palette straight into Library Search, as the Search Library Command does. */
export async function openLibrarySearch(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Control>}{Alt>}p{/Alt}{/Control}");
  return screen.findByRole("dialog", { name: PALETTE_NAME });
}

export function paletteSearch(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("searchbox", { name: "Find by name" });
}

/** The label of the result React Aria currently holds focused, if any. */
export function activeResultLabel(search: HTMLElement): string | null {
  const id = search.getAttribute("aria-activedescendant");
  const element = id ? document.getElementById(id) : null;
  return element?.textContent ?? null;
}

/** The Book Editor's heading is the open Book's title. */
export function bookEditorTitle(): string {
  return document.querySelector("[data-route-heading]")?.textContent ?? "";
}

/** The Chapter the Book Editor currently shows, by its own title line. */
export function openChapterTitle(): string {
  const heading = document.querySelector("[data-route-heading]");
  return heading?.nextElementSibling?.textContent ?? "";
}

/**
 * Waits until React Aria holds one of the CURRENT options as active. It
 * updates the active descendant 500 ms after typing forward, so a screen
 * reader finishes announcing the typed letter first.
 */
export async function awaitActiveInCurrentOptions(dialog: HTMLElement, search: HTMLElement) {
  await waitFor(() => {
    const id = search.getAttribute("aria-activedescendant");
    expect(
      within(dialog)
        .getAllByRole("option")
        .some((option) => option.id === id)
    ).toBe(true);
  });
}

/** The options of one titled section of the results, e.g. "Recent". */
export function sectionOptions(dialog: HTMLElement, name: string): HTMLElement[] {
  return within(within(dialog).getByRole("group", { name })).getAllByRole("option");
}

/** An option's name is its label alone; the detail is its description. */
export function optionLabel(option: HTMLElement): string {
  return option.querySelector('[slot="label"]')?.textContent ?? option.textContent ?? "";
}

/** Arrows down until the named option is the active result, then Enter chooses it. */
export async function arrowToAndChoose(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  search: HTMLElement,
  option: HTMLElement
) {
  const isActive = () => {
    const id = search.getAttribute("aria-activedescendant");
    return id !== null && document.getElementById(id) === option;
  };
  await awaitActiveInCurrentOptions(dialog, search);
  for (let i = 0; i < 60 && !isActive(); i += 1) {
    const before = search.getAttribute("aria-activedescendant");
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(search.getAttribute("aria-activedescendant")).not.toBe(before));
  }
  expect(isActive()).toBe(true);
  // The caret stays in the field: React Aria holds the list in virtual focus.
  expect(document.activeElement).toBe(search);
  await user.keyboard("{Enter}");
}

beforeEach(async () => {
  await closeDatabase();
  librarySwitch.resetLibrarySwitchForTests();
  resetSyncEngineForTests();
  resetAutoSyncForTests();
  authorDb.current = await createTestDatabase();
  platform.desktop = true;
  web.value = false;
  localStorage.clear();
  await i18n.changeLanguage("en");
  useTutorialStore.setState({ progress: EMPTY_TUTORIAL_PROGRESS, status: "idle", run: null });
  // A fresh author is offered the Tutorial on launch; dismiss it so F1 is free.
  useTutorialStore.getState().dismiss(1);
  useSettingsStore.setState({
    lastPath: null,
    lastNoteId: null,
    autoSync: false,
    spellCheckEnabled: false,
    language: "en",
  });
  useBookStore.setState({ books: [], currentBook: null, error: null });
  useNoteStore.setState({ notes: [], currentNote: null, error: null });
  useCanvasStore.setState({ canvases: [], galleryLoaded: false, galleryLoading: false });
  useEphemeralStore.setState({ content: "", wordCount: 0 });
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  useCommandPaletteStore.setState({ isOpen: false, opener: null, snapshot: new Map() });
  useCommandPaletteRecentStore.setState({ keys: [] });
  useSearchSwitchesStore.setState({ matchCase: false, wholeWord: false, regex: false });
  useSettingsRevealStore.setState({
    pendingRowId: null,
    advancedOpen: false,
    pasteCleanupAdvancedOpen: false,
  });
  useThemeStore.setState({ theme: "system" });
  document.documentElement.classList.remove("dark");
  useDictationStore.setState({ enabled: true, support: null });
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
  useBoundShortcutStore.setState({ counts: {} });
});

afterEach(() => {
  web.value = false;
});
