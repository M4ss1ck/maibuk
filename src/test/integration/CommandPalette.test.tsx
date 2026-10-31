import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { mockVirtualizerLayout } from "@/test/support/virtualizer-layout";

// The palette dialog over the real app on a real in-memory Library, driven
// with real keys. Only what jsdom cannot run is stubbed: the Fabric cover
// stage, React Flow's canvas surface, the metrics worker, Dictation, and the
// update check. Prior art: tutorial-app.test.tsx, navigating-commands.test.tsx.
const { authorDb, platform, web, indexBlank } = vi.hoisted(() => ({
  authorDb: { current: null as DatabaseAdapter | null },
  platform: { desktop: true },
  web: { value: false },
  // While set, the indexed Library search answers nothing, as an index that is
  // still filling would.
  indexBlank: { value: false },
}));

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
const { createBookRow } = await import("@/features/books/write");
const { createChapterRow, updateChapterRow } = await import("@/features/chapters/write");
const { createNoteRow } = await import("@/features/notes/write");
const { createCanvasRow } = await import("@/features/canvas/write");
const { getDatabase } = await import("@/lib/db");
const librarySwitch = await import("@/features/tutorial/library-switch");
const { useTutorialStore, EMPTY_TUTORIAL_PROGRESS } = await import("@/features/tutorial");
const { useSettingsStore } = await import("@/features/settings/store");
const { useBookStore } = await import("@/features/books/store");
const { useSettingsRevealStore } = await import("@/features/settings/settings-reveal-store");
const { useNoteStore } = await import("@/features/notes/store");
const { useCanvasStore } = await import("@/features/canvas/store");
const { useEphemeralStore } = await import("@/features/ephemeral/store");
const { useThemeStore } = await import("@/features/theme/store");
const { useDictationStore } = await import("@/features/dictation/store");
const { useShortcutSettingsStore } = await import("@/features/settings/shortcut-store");
const { useBoundShortcutStore } = await import("@/lib/bound-shortcuts");
const { useModalStore } = await import("@/components/ui/modal-store");
const { useCommandPaletteStore } = await import("@/features/command-palette/store");
const { useCommandPaletteRecentStore } = await import("@/features/command-palette/recent-store");
const { useSearchSwitchesStore, SEARCH_SWITCHES_STORAGE_KEY } = await import(
  "@/features/search/switches"
);
const { DEFAULT_SHORTCUT_SETTINGS } = await import("@/lib/shortcut-resolve");
const { resetSyncEngineForTests } = await import("@/features/sync/sync-engine");
const { requestSearchRebuild, resetSearchIndexForTests } = await import(
  "@/features/search/rebuild"
);
const { resetAutoSyncForTests } = await import("@/features/sync/auto-sync");
const { lastFocusedEditor } = await import("@/components/editor/editor-command-source");
const { runCommand } = await import("@/lib/command-runner");
const { defaultWholeLinePhrases } = await import("@/features/dictation/voice-commands");

const en = (key: string, options?: Record<string, unknown>) =>
  (i18n.t as unknown as (k: string, o?: Record<string, unknown>) => string)(key, {
    lng: "en",
    ...options,
  });

let path = "/";
function LocationProbe() {
  path = useLocation().pathname;
  return null;
}

function renderApp(initialPath = "/") {
  path = initialPath;
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
      <LocationProbe />
    </MemoryRouter>
  );
}

async function settleOn(screenPath: string) {
  await waitFor(() => expect(path).toBe(screenPath));
  await waitFor(() => expect(document.querySelector("[data-route-heading]")).not.toBeNull());
  // A screen binds its Commands once it has mounted; the palette lists them.
  await waitFor(() =>
    expect(Object.keys(useBoundShortcutStore.getState().counts).length).toBeGreaterThan(0)
  );
}

const PALETTE_NAME = "Command palette";
const COMMANDS_PREFIX = ">";

async function openPaletteWithF1(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{F1}");
  return screen.findByRole("dialog", { name: PALETTE_NAME });
}

/** Opens the palette straight into Library Search, as the Search Library Command does. */
async function openLibrarySearch(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Control>}{Alt>}p{/Alt}{/Control}");
  return screen.findByRole("dialog", { name: PALETTE_NAME });
}

function paletteSearch(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("searchbox", { name: "Find by name" });
}

/** The label of the result React Aria currently holds focused, if any. */
function activeResultLabel(search: HTMLElement): string | null {
  const id = search.getAttribute("aria-activedescendant");
  const element = id ? document.getElementById(id) : null;
  return element?.textContent ?? null;
}

/** The Book Editor's heading is the open Book's title. */
function bookEditorTitle(): string {
  return document.querySelector("[data-route-heading]")?.textContent ?? "";
}

/** The Chapter the Book Editor currently shows, by its own title line. */
function openChapterTitle(): string {
  const heading = document.querySelector("[data-route-heading]");
  return heading?.nextElementSibling?.textContent ?? "";
}

/**
 * Waits until React Aria holds one of the CURRENT options as active. It
 * updates the active descendant 500 ms after typing forward, so a screen
 * reader finishes announcing the typed letter first.
 */
async function awaitActiveInCurrentOptions(dialog: HTMLElement, search: HTMLElement) {
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
function sectionOptions(dialog: HTMLElement, name: string): HTMLElement[] {
  return within(within(dialog).getByRole("group", { name })).getAllByRole("option");
}

/** An option's name is its label alone; the detail is its description. */
function optionLabel(option: HTMLElement): string {
  return option.querySelector('[slot="label"]')?.textContent ?? option.textContent ?? "";
}

/** Arrows down until the named option is the active result, then Enter chooses it. */
async function arrowToAndChoose(
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

describe("Command Palette", () => {
  it("opens with F1 with focus in the search field, in Commands mode", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openPaletteWithF1(user);
    const search = paletteSearch(dialog);
    expect(search).toHaveFocus();
    // F1 is the Commands shortcut: the prefix is already typed, so the field
    // starts half-written and one Backspace reaches Library Search.
    expect(search).toHaveValue(COMMANDS_PREFIX);
  });

  it("opens Commands mode with Mod+Shift+P on desktop", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("{Control>}{Shift>}p{/Shift}{/Control}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    expect(paletteSearch(dialog)).toHaveFocus();
    expect(paletteSearch(dialog)).toHaveValue(COMMANDS_PREFIX);
  });

  it("opens Commands mode with > typed when its Voice Command runs", async () => {
    renderApp("/");
    await settleOn("/");
    // The Command answers to its label in the Dictation Language (ADR 0016);
    // the phrase is what a speaker says, before the interpreter hands it over.
    expect(defaultWholeLinePhrases("global.openCommandPalette", "en")).toContain(
      "Open command palette"
    );

    await act(async () => {
      expect(await runCommand("global.openCommandPalette", { source: "voice" })).toBe("ran");
    });

    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    expect(paletteSearch(dialog)).toHaveFocus();
    expect(paletteSearch(dialog)).toHaveValue(COMMANDS_PREFIX);
  });

  it("opens Library Search empty with Mod+Alt+P", async () => {
    await createBookRow({ title: "Shortcut Book", authorName: "Author" }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");
    expect(useBoundShortcutStore.getState().counts["global.searchLibrary"]).toBeGreaterThan(0);

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    expect(search).toHaveFocus();
    expect(search).toHaveValue("");

    // No prefix means Library Search: typing a Book title finds it.
    await user.keyboard("Shortcut");
    await within(dialog).findByRole("option", { name: "Shortcut Book" });
  });

  it("lists the Search Library Command in Commands mode", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openPaletteWithF1(user);
    await user.keyboard("Search Library");
    expect(await within(dialog).findByRole("option", { name: "Search Library" })).toBeVisible();
  });

  it("answers to F1 only on the web build", async () => {
    web.value = true;
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("{Control>}{Shift>}p{/Shift}{/Control}");
    // Ordering witness: "?" opens the shortcuts dialog through the same key
    // handler, after the ignored shortcut. Its dialog proves that keystroke ran.
    await user.keyboard("?");
    await screen.findByRole("dialog", { name: en("shortcuts.title") });
    expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: en("shortcuts.title") })).toBeNull()
    );

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    expect(paletteSearch(dialog)).toHaveFocus();
  });

  it("Escape closes and returns focus to the opener", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const trigger = screen.getByRole("button", { name: en("books.noBooksButton") });
    trigger.focus();
    await openPaletteWithF1(user);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("Escape once with a query closes and returns focus to the opener", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const trigger = screen.getByRole("button", { name: en("books.noBooksButton") });
    trigger.focus();
    const dialog = await openPaletteWithF1(user);
    const search = paletteSearch(dialog);
    await user.keyboard("dark");
    expect(search).not.toHaveValue("");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("keeps Tab inside the dialog", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    for (let i = 0; i < 10; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 10; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("lists the theme Commands for 'theme' and moves the active result with arrows", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    const search = paletteSearch(dialog);
    await user.keyboard("theme");

    await waitFor(() => expect(within(dialog).getAllByRole("option").length).toBeGreaterThan(0));
    const names = within(dialog)
      .getAllByRole("option")
      .map((option) => option.textContent ?? "");
    for (const label of ["Cycle theme", "Light", "Dark", "System"]) {
      expect(names.some((name) => name.includes(label))).toBe(true);
    }
    expect(document.activeElement).toBe(search);

    // Autocomplete moves the active descendant 500 ms after typing forward, so
    // a screen reader finishes announcing the typed letter first.
    const activeOption = () => search.getAttribute("aria-activedescendant");
    await waitFor(() => expect(activeOption()).toContain("command:global.toggleTheme"));
    const first = activeOption();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(activeOption()).not.toBe(first));
    expect(activeOption()).toContain("command:global.themeDark");
    expect(document.activeElement).toBe(search);
  });

  it("runs Dark from the palette, applies the theme, closes, and remembers it", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    const search = paletteSearch(dialog);
    await user.keyboard("dark");
    const dark = await within(dialog).findByRole("option", { name: "Dark" });
    await arrowToAndChoose(user, dialog, search, dark);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(useCommandPaletteRecentStore.getState().keys).toEqual(["command:global.themeDark"]);

    // Reopening with an empty query lists the Recent Command first, then
    // Suggested; no search result section.
    await user.keyboard("{F1}");
    const reopened = await screen.findByRole("dialog", { name: PALETTE_NAME });
    const options = sectionOptions(reopened, "Recent");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Dark");
    expect(within(reopened).queryByText("Commands")).toBeNull();
  });

  it("lists Dark on a Book page and running it applies dark", async () => {
    const book = await createBookRow({ title: "Themed", authorName: "Author" }, "local");
    const user = userEvent.setup();
    renderApp(`/book/${book.id}`);
    await settleOn(`/book/${book.id}`);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    const search = paletteSearch(dialog);
    await user.keyboard("dark");
    const dark = await within(dialog).findByRole("option", { name: "Dark" });
    await arrowToAndChoose(user, dialog, search, dark);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("reaches a disabled Command by arrows, announces it disabled, and Enter does nothing", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");
    // Dictation switched off on this device: its toggle stays bound but disabled.
    act(() => useDictationStore.setState({ enabled: false }));

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    const search = paletteSearch(dialog);
    await user.keyboard("dictation");
    const toggle = await within(dialog).findByRole("option", {
      name: "Start or stop dictation",
    });

    // The active descendant follows typing after Autocomplete's 500 ms delay.
    const isActive = () => {
      const id = search.getAttribute("aria-activedescendant");
      return id !== null && document.getElementById(id) === toggle;
    };
    await waitFor(() => {
      const id = search.getAttribute("aria-activedescendant");
      const options = within(dialog).getAllByRole("option");
      expect(options.some((option) => option.id === id)).toBe(true);
    });
    for (let i = 0; i < 5 && !isActive(); i++) {
      const before = search.getAttribute("aria-activedescendant");
      await user.keyboard("{ArrowDown}");
      await waitFor(() => expect(search.getAttribute("aria-activedescendant")).not.toBe(before));
    }
    const activeId = search.getAttribute("aria-activedescendant");
    expect(activeId).not.toBeNull();
    expect(document.getElementById(activeId as string)).toBe(toggle);
    expect(toggle).toHaveAttribute("aria-disabled", "true");

    await user.keyboard("{Enter}");
    // Ordering witness: a typed character reaches the search only while the
    // palette is still open, so the value changing proves Enter was handled first.
    const searchBefore = (paletteSearch(dialog) as HTMLInputElement).value;
    await user.keyboard("q");
    await waitFor(() => expect(paletteSearch(dialog)).toHaveValue(`${searchBefore}q`));
    expect(screen.getByRole("dialog", { name: PALETTE_NAME })).toBeInTheDocument();
    expect(screen.queryByText(en("commandPalette.unavailable"))).toBeNull();
  });

  it("hides Commands from other screens", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    await user.keyboard("save version");

    // A Command bound only in the Book Editor is not offered on the Library.
    await within(dialog).findAllByRole("option");
    expect(within(dialog).queryByRole("option", { name: "Save version" })).toBeNull();
    // Everything offered here is a Settings row, never a Command.
    for (const option of within(dialog).getAllByRole("option")) {
      expect(option.getAttribute("data-key")).toContain("settingsRow:");
    }
  });

  it("lists a Note Item Command only with focus in the note, and runs it on that note", async () => {
    const note = await createNoteRow({ title: "Alpha", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp("/notes");
    await settleOn("/notes");

    const card = await screen.findByRole("row", { name: "Alpha" });
    act(() => {
      card.focus();
    });
    await openPaletteWithF1(user);
    const dialog = screen.getByRole("dialog", { name: PALETTE_NAME });
    const search = paletteSearch(dialog);
    await user.keyboard("duplicate");
    const duplicate = await within(dialog).findByRole("option", { name: "Duplicate note" });
    await arrowToAndChoose(user, dialog, search, duplicate);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(useNoteStore.getState().notes).toHaveLength(2));
    expect(useNoteStore.getState().notes.some((entry) => entry.title === "Alpha (copy)")).toBe(
      true
    );
    expect(note).toBeDefined();
  });

  it("leaves Note Item Commands out when the palette opens from the search field", async () => {
    await createNoteRow({ title: "Alpha", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp("/notes");
    await settleOn("/notes");

    screen.getByPlaceholderText("Search notes...").focus();
    await openPaletteWithF1(user);
    const dialog = screen.getByRole("dialog", { name: PALETTE_NAME });
    await user.keyboard("duplicate");

    // Settings rows still answer "duplicate", but the Note Item Command does not.
    await within(dialog).findAllByRole("option");
    expect(within(dialog).queryByRole("option", { name: "Duplicate note" })).toBeNull();
  });

  it("toasts when the Command is gone by the time it runs", async () => {
    const note = await createNoteRow({ title: "Beta", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp("/notes");
    await settleOn("/notes");

    const card = await screen.findByRole("row", { name: "Beta" });
    act(() => {
      card.focus();
    });
    await openPaletteWithF1(user);
    const dialog = screen.getByRole("dialog", { name: PALETTE_NAME });
    await user.keyboard("duplicate");
    await within(dialog).findByRole("option", { name: "Duplicate note" });

    await useNoteStore.getState().deleteNote(note.id);
    await waitFor(() => expect(screen.queryByText("Beta")).toBeNull());

    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    expect(
      await screen.findByText("That command is not available here anymore")
    ).toBeInTheDocument();
  });

  it("refuses to open during a Tutorial run", async () => {
    librarySwitch.setTutorialRunInProgress(true);
    try {
      const user = userEvent.setup();
      renderApp("/");
      await settleOn("/");

      await user.keyboard("{F1}");
      // Ordering witness: "?" opens the shortcuts dialog after the refused F1.
      await user.keyboard("?");
      await screen.findByRole("dialog", { name: en("shortcuts.title") });
      expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull();
    } finally {
      librarySwitch.resetLibrarySwitchForTests();
    }
  });

  it("stays closed while another dialog is open", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("?");
    await screen.findByRole("dialog", { name: en("shortcuts.title") });
    await user.keyboard("{F1}");
    // Ordering witness: Escape closes the top dialog. If F1 had opened the
    // palette above the shortcuts dialog, Escape would close only the palette
    // and the shortcuts dialog would stay open.
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: en("shortcuts.title") })).toBeNull()
    );
    expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull();
  });

  it("is absent on the embed route", async () => {
    const user = userEvent.setup();
    renderApp("/embed");
    await waitFor(() => expect(path).toBe("/embed"));

    // The embed route mounts no global shortcuts, so the witness is the Editor:
    // a character typed into it lands only if F1 did not move focus to a palette.
    const editor = await screen.findByRole("textbox");
    await user.click(editor);
    await user.keyboard("{F1}");
    await user.keyboard("x");
    await waitFor(() => expect(editor).toHaveTextContent("x"));
    expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull();
  });

  it("removes Recent rows with Shift+Delete and the X button, announcing each removal", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    // Two runs: the most recent run lists first.
    await user.keyboard("{F1}");
    let dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    let search = paletteSearch(dialog);
    await user.keyboard("dark");
    const dark = await within(dialog).findByRole("option", { name: "Dark" });
    await arrowToAndChoose(user, dialog, search, dark);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());

    await user.keyboard("{F1}");
    dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    search = paletteSearch(dialog);
    await user.keyboard("light");
    const light = await within(dialog).findByRole("option", { name: "Light" });
    await arrowToAndChoose(user, dialog, search, light);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());

    await user.keyboard("{F1}");
    dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    search = paletteSearch(dialog);
    let options = sectionOptions(dialog, "Recent");
    expect(options.map((option) => option.textContent)).toEqual(["Light", "Dark"]);

    await user.keyboard("{ArrowDown}");
    const removed = activeResultLabel(search);
    expect(["Light", "Dark"]).toContain(removed);
    const survivor = removed === "Light" ? "Dark" : "Light";

    await user.keyboard("{Shift>}{Delete}{/Shift}");
    await within(dialog).findByText("Removed from recent");
    await waitFor(() => expect(sectionOptions(dialog, "Recent")).toHaveLength(1));
    options = sectionOptions(dialog, "Recent");
    expect(options[0]).toHaveTextContent(survivor);
    // The highlight moved to the row that survived.
    await waitFor(() => expect(activeResultLabel(search)).toContain(survivor));

    await user.click(
      within(dialog).getByRole("button", { name: `Remove ${survivor} from recent` })
    );
    await waitFor(() => expect(within(dialog).queryByRole("group", { name: "Recent" })).toBeNull());
    // With Recent empty the palette still lists something to choose.
    expect(sectionOptions(dialog, "Suggested").length).toBeGreaterThan(0);
    expect(useCommandPaletteRecentStore.getState().keys).toEqual([]);
  });

  it("prunes Recent keys that are no longer listed", async () => {
    useCommandPaletteRecentStore.setState({
      keys: ["command:global.themeDark", "command:noteItem.duplicate"],
    });
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("{F1}");
    await screen.findByRole("dialog", { name: PALETTE_NAME });
    await waitFor(() =>
      expect(useCommandPaletteRecentStore.getState().keys).toEqual(["command:global.themeDark"])
    );
  });

  it("binds removeRecent while open and the opener on /", async () => {
    useCommandPaletteRecentStore.setState({ keys: ["command:global.themeDark"] });

    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");
    expect(useBoundShortcutStore.getState().counts["global.openCommandPalette"]).toBeGreaterThan(0);

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    paletteSearch(dialog);
    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(
        useBoundShortcutStore.getState().counts["commandPalette.removeRecent"]
      ).toBeGreaterThan(0)
    );
  });

  it("runs Bold from the palette on the chapter selection and returns focus to the editor", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    try {
      const book = await createBookRow({ title: "Format", authorName: "Author" }, "local");
      const chapter = await createChapterRow({ bookId: book.id, title: "Chapter" }, "local");
      await updateChapterRow(chapter.id, { content: "<p>Hello world</p>" }, "local");

      const user = userEvent.setup();
      renderApp(`/book/${book.id}`);
      await settleOn(`/book/${book.id}`);

      const editorDom = await waitFor(() => {
        const element = document.querySelector(
          '[data-focus-pane="editor-main"] .tiptap'
        ) as HTMLElement | null;
        expect(element).not.toBeNull();
        return element as HTMLElement;
      });
      act(() => {
        editorDom.focus();
      });
      const editor = lastFocusedEditor();
      expect(editor).not.toBeNull();
      act(() => {
        editor?.commands.setTextSelection({ from: 7, to: 12 });
      });

      await user.keyboard("{F1}");
      const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
      const search = paletteSearch(dialog);
      await user.keyboard("bold");
      const bold = await within(dialog).findByRole("option", { name: "Bold" });
      await arrowToAndChoose(user, dialog, search, bold);

      await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
      await waitFor(() => expect(editor?.getHTML()).toContain("<strong>world</strong>"));
      expect(editor?.view.dom.contains(document.activeElement)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Command Palette entities and pages", () => {
  it("lists a Book by title under Books and Enter opens the Book Editor", async () => {
    await createBookRow({ title: "Alpha", authorName: "Author" }, "local");
    await createBookRow({ title: "Beta", authorName: "Author" }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Alpha");
    const book = await within(dialog).findByRole("option", { name: "Alpha" });
    expect(within(dialog).getByText("Books")).toBeInTheDocument();
    await arrowToAndChoose(user, dialog, search, book);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(bookEditorTitle()).toBe("Alpha"));
    expect(path).toBe(`/book/${(useBookStore.getState().books[0] as { id: string }).id}`);
  });

  it("finds a Chapter of another Book, shows its Book, and opens that Book at it", async () => {
    const mine = await createBookRow({ title: "Home Book", authorName: "Author" }, "local");
    const otherBook = await createBookRow({ title: "Other Book", authorName: "Author" }, "local");
    const otherChapter = await createChapterRow(
      { bookId: otherBook.id, title: "Prologue" },
      "local"
    );
    const mineChapter = await createChapterRow({ bookId: mine.id, title: "Prologue" }, "local");
    await updateChapterRow(otherChapter.id, { content: "<p>Far away</p>" }, "local");
    await updateChapterRow(mineChapter.id, { content: "<p>Right here</p>" }, "local");

    const user = userEvent.setup();
    renderApp(`/book/${mine.id}`);
    await settleOn(`/book/${mine.id}`);

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Prologue");
    const options = await within(dialog).findAllByRole("option", { name: "Prologue" });
    expect(options).toHaveLength(2);
    const byBook = new Map(options.map((option) => [option.textContent ?? "", option] as const));
    const theirs = [...byBook.entries()].find(([text]) => text.includes("Other Book"))?.[1];
    const mineOption = [...byBook.entries()].find(([text]) => text.includes("Home Book"))?.[1];
    expect(theirs).toBeDefined();
    expect(mineOption).toBeDefined();

    await arrowToAndChoose(user, dialog, search, theirs as HTMLElement);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    // The palette navigates only after the open Chapter's text has landed, so
    // the move trails the dialog closing.
    await waitFor(() => expect(path).toBe(`/book/${otherBook.id}`));
    await waitFor(() => expect(openChapterTitle()).toBe("Prologue"));
    // The Chapter that opened is the other Book's, not this one's.
    await waitFor(() =>
      expect(document.querySelector(".tiptap")?.textContent ?? "").toContain("Far away")
    );
  });

  it("ranks the open Book's Chapters above another Book's", async () => {
    const mine = await createBookRow({ title: "Open One", authorName: "Author" }, "local");
    const other = await createBookRow({ title: "Other One", authorName: "Author" }, "local");
    await createChapterRow({ bookId: mine.id, title: "Shared Title" }, "local");
    await createChapterRow({ bookId: other.id, title: "Shared Title" }, "local");

    const user = userEvent.setup();
    renderApp(`/book/${mine.id}`);
    await settleOn(`/book/${mine.id}`);

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Shared Title");
    await waitFor(() => expect(within(dialog).getAllByRole("option").length).toBeGreaterThan(1));

    await waitFor(() => expect(search.getAttribute("aria-activedescendant")).toContain("chapter:"));
    // The first result is one of the two identical-titled Chapters, and it is
    // the open Book's: its detail says which Book it belongs to.
    const firstId = search.getAttribute("aria-activedescendant") as string;
    const first = document.getElementById(firstId) as HTMLElement;
    expect(first.textContent).toContain("Open One");

    await arrowToAndChoose(user, dialog, search, first);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    expect(path).toBe(`/book/${mine.id}`);
  });

  it("lists only the open Book's Chapters on the Open Chapter… page, and Backspace leaves it", async () => {
    const mine = await createBookRow({ title: "Open One", authorName: "Author" }, "local");
    const other = await createBookRow({ title: "Other One", authorName: "Author" }, "local");
    await createChapterRow({ bookId: mine.id, title: "Mine Only" }, "local");
    await createChapterRow({ bookId: other.id, title: "Theirs Only" }, "local");

    const user = userEvent.setup();
    renderApp(`/book/${mine.id}`);
    await settleOn(`/book/${mine.id}`);

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Open Chapter");
    const page = await within(dialog).findByRole("option", { name: "Open Chapter…" });
    await arrowToAndChoose(user, dialog, search, page);

    // The palette stays open, narrowed, with the chip naming the page.
    expect(screen.getByRole("dialog", { name: PALETTE_NAME })).toBeInTheDocument();
    expect(paletteSearch(dialog)).toHaveValue("");
    expect(within(dialog).getByText("Open Chapter")).toBeInTheDocument();
    expect(await within(dialog).findByText("Showing Open Chapter")).toBeInTheDocument();

    // The row carries the Book as its description, so compare names, not text.
    expect(within(dialog).getAllByRole("option").map(optionLabel)).toEqual(["Mine Only"]);

    // Backspace on the empty field steps back out to the root page.
    await user.keyboard("{Backspace}");
    await waitFor(() => expect(within(dialog).queryByText("Open Chapter")).toBeNull());
    // Root with an empty query lists the pages, nothing has been chosen yet.
    expect(within(dialog).queryByRole("group", { name: "Recent" })).toBeNull();
    expect(sectionOptions(dialog, "Pages").map(optionLabel)).toContain("Open Chapter…");
    // The other Book's Chapter is reachable again, which the narrowed page hid.
    await user.keyboard("Theirs");
    const theirs = await within(dialog).findByRole("option", { name: "Theirs Only" });
    expect(theirs.textContent).toContain("Other One");
  });

  it("offers the four nested pages in Library Search on every screen", async () => {
    const book = await createBookRow({ title: "Only Book", authorName: "Author" }, "local");
    await createChapterRow({ bookId: book.id, title: "Prologue" }, "local");

    const user = userEvent.setup();
    renderApp("/notes");
    await settleOn("/notes");

    const dialog = await openLibrarySearch(user);
    // Nothing typed: the four pages are how the author browses each kind.
    expect(sectionOptions(dialog, "Pages").map(optionLabel)).toEqual([
      "Open Chapter…",
      "Go to Book…",
      "Open Note…",
      "Open Canvas…",
    ]);
    const search = paletteSearch(dialog);
    await user.keyboard("Open ");
    await within(dialog).findByRole("option", { name: "Open Note…" });
    await within(dialog).findByRole("option", { name: "Open Canvas…" });
    // Outside the Book Editor the Chapters page lists every Chapter.
    await within(dialog).findByRole("option", { name: "Open Chapter…" });
    expect(search).toHaveValue("Open ");
  });

  it("narrows to Books, Chapters, Notes, and Canvases on their pages", async () => {
    const book = await createBookRow({ title: "Paged Book", authorName: "Author" }, "local");
    await createChapterRow({ bookId: book.id, title: "Paged Chapter" }, "local");
    await createNoteRow({ title: "Paged Note", bookId: null }, "local");
    await createCanvasRow({ title: "Paged Canvas" }, "local");

    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);

    for (const [pageLabel, chip, expected] of [
      ["Open Chapter…", "Open Chapter", ["Paged Chapter"]],
      ["Go to Book…", "Go to Book", ["Paged Book"]],
      ["Open Note…", "Open Note", ["Paged Note"]],
      ["Open Canvas…", "Open Canvas", ["Paged Canvas"]],
    ] as const) {
      await user.clear(search);
      await user.keyboard(pageLabel);
      const page = await within(dialog).findByRole("option", { name: pageLabel });
      await arrowToAndChoose(user, dialog, search, page);
      expect(within(dialog).getByText(chip)).toBeInTheDocument();
      await waitFor(() =>
        expect(within(dialog).getAllByRole("option").map(optionLabel)).toEqual(expected)
      );
      // Backspace on the empty field steps back out to the root page.
      await user.keyboard("{Backspace}");
      await waitFor(() => expect(within(dialog).queryByText(chip)).toBeNull());
    }
  });

  it("finds the theme row by its keywords and lands on Settings with it focused", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openPaletteWithF1(user);
    const search = paletteSearch(dialog);
    // "dark" is a keyword of the theme row, not any part of its label.
    await user.keyboard("dark");
    const theme = await within(dialog).findByRole("option", { name: "Theme" });
    expect(within(dialog).getByText("Settings")).toBeInTheDocument();
    await arrowToAndChoose(user, dialog, search, theme);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(path).toBe("/settings"));
    await waitFor(() =>
      expect(document.activeElement?.closest('[data-settings-row="theme"]')).not.toBeNull()
    );
    expect(document.activeElement).toBe(
      document.querySelector('[data-settings-row="theme"] button')
    );
  });

  it("reveals a row inside the collapsed Advanced block and focuses it", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openPaletteWithF1(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Export Database");
    const row = await within(dialog).findByRole("option", { name: "Export Database" });
    await arrowToAndChoose(user, dialog, search, row);

    await waitFor(() => expect(path).toBe("/settings"));
    // The block is collapsed on arrival and the result opened it to focus the row.
    await waitFor(() =>
      expect(document.activeElement?.closest('[data-settings-row="exportDatabase"]')).not.toBeNull()
    );
    expect(useSettingsRevealStore.getState().advancedOpen).toBe(true);
    expect(useSettingsRevealStore.getState().pendingRowId).toBeNull();
  });

  it("hides desktop-only Settings rows on the web build", async () => {
    web.value = true;
    platform.desktop = false;
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openPaletteWithF1(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Launch on startup");
    await within(dialog).findByText("No results");
    expect(within(dialog).queryByRole("option", { name: "Launch on startup" })).toBeNull();

    // A row every platform has is still there.
    await user.clear(search);
    await user.keyboard(">Choose your preferred theme");
    expect(await within(dialog).findByRole("option", { name: "Theme" })).toBeInTheDocument();
  });

  it("drops a deleted Note from Recent on the next open, without an error", async () => {
    const keep = await createNoteRow({ title: "Keeper", bookId: null }, "local");
    const doomed = await createNoteRow({ title: "Doomed", bookId: null }, "local");
    useCommandPaletteRecentStore.setState({ keys: [`note:${keep.id}`, `note:${doomed.id}`] });

    const user = userEvent.setup();
    renderApp("/notes");
    await settleOn("/notes");

    // Deleted through the Notes write path, the same one the Item Menu uses.
    await act(() => useNoteStore.getState().deleteNote(doomed.id));

    await openLibrarySearch(user);
    const dialog = screen.getByRole("dialog", { name: PALETTE_NAME });
    await waitFor(() =>
      expect(sectionOptions(dialog, "Recent").map(optionLabel)).toEqual(["Keeper"])
    );
    await waitFor(() =>
      expect(useCommandPaletteRecentStore.getState().keys).toEqual([`note:${keep.id}`])
    );
    expect(screen.queryByText("Doomed")).toBeNull();
  });

  it("lists the four pages when nothing is recent, and choosing one narrows", async () => {
    await createNoteRow({ title: "Findable", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    expect(within(dialog).queryByRole("group", { name: "Recent" })).toBeNull();
    expect(sectionOptions(dialog, "Pages").map(optionLabel)).toEqual([
      "Open Chapter…",
      "Go to Book…",
      "Open Note…",
      "Open Canvas…",
    ]);

    // Nothing is active until the first arrow: the list opens on the pages.
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(activeResultLabel(search)).toContain("Open Chapter…"));
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(activeResultLabel(search)).toContain("Go to Book…"));
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(activeResultLabel(search)).toContain("Open Note…"));
    await user.keyboard("{Enter}");
    expect(await within(dialog).findByText("Showing Open Note")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("option").map(optionLabel)).toEqual(["Findable"]);
  });

  it("lands the open editor's text before navigating away to a Note", async () => {
    const book = await createBookRow({ title: "Unsaved", authorName: "Author" }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "Draft" }, "local");
    const note = await createNoteRow({ title: "Destination", bookId: null }, "local");

    const user = userEvent.setup();
    renderApp(`/book/${book.id}`);
    await settleOn(`/book/${book.id}`);
    const editorDom = await waitFor(() => {
      const element = document.querySelector('[data-focus-pane="editor-main"] .tiptap');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    act(() => {
      editorDom.focus();
    });

    await user.keyboard("Typed straight through");
    // The debounced save has not run: the Library has no trace of the text yet.
    const before = await getDatabase();
    const beforeRows = await before.select<{ content: string | null }[]>(
      "SELECT content FROM chapters WHERE id = ?",
      [chapter.id]
    );
    expect(beforeRows[0]?.content ?? "").not.toContain("Typed straight through");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Destination");
    const row = await within(dialog).findByRole("option", { name: "Destination" });
    await arrowToAndChoose(user, dialog, search, row);

    await waitFor(() => expect(path).toBe(`/notes/${note.id}`));
    const after = await getDatabase();
    const afterRows = await after.select<{ content: string | null }[]>(
      "SELECT content FROM chapters WHERE id = ?",
      [chapter.id]
    );
    expect(afterRows[0]?.content ?? "").toContain("Typed straight through");
  });

  it("opens an Unfiled Note from the palette", async () => {
    await createNoteRow({ title: "Loose Thought", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Loose");
    const note = await within(dialog).findByRole("option", { name: "Loose Thought" });
    await arrowToAndChoose(user, dialog, search, note);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(path).toBe(`/notes/${useNoteStore.getState().notes[0]?.id}`));
    await waitFor(() => expect(bookEditorTitle()).toBe("Loose Thought"));
  });

  it("opens a Canvas from the palette", async () => {
    const canvas = await createCanvasRow({ title: "Story Arcs" }, "local");
    const user = userEvent.setup();
    renderApp("/canvas");
    await settleOn("/canvas");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Story Arcs");
    const row = await within(dialog).findByRole("option", { name: "Story Arcs" });
    await arrowToAndChoose(user, dialog, search, row);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(path).toBe(`/canvas/${canvas.id}`));
  });
});

describe("Command Palette modes", () => {
  it("switches to Commands mode on a leading > and back to Library Search when it goes", async () => {
    await createBookRow({ title: "Paged Book", authorName: "Author" }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Paged");
    await within(dialog).findByRole("option", { name: "Paged Book" });
    expect(within(dialog).getByText("Books")).toBeInTheDocument();

    // A leading > asks for Commands, and says so.
    await user.clear(search);
    await user.keyboard(">");
    await waitFor(() =>
      expect(within(dialog).getByRole("status")).toHaveTextContent(
        en("commandPalette.modes.commands")
      )
    );
    await user.keyboard("Paged");
    await waitFor(() =>
      expect(within(dialog).queryByRole("option", { name: "Paged Book" })).toBeNull()
    );
    expect(within(dialog).queryByText("Books")).toBeNull();

    // Deleting the prefix goes back to Library Search, and says so.
    await user.clear(search);
    await waitFor(() =>
      expect(within(dialog).getByRole("status")).toHaveTextContent(
        en("commandPalette.modes.library")
      )
    );
    await user.keyboard("Paged");
    expect(await within(dialog).findByRole("option", { name: "Paged Book" })).toBeInTheDocument();
  });

  it("Backspace on a lone > switches to Library Search instead of closing", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openPaletteWithF1(user);
    const search = paletteSearch(dialog);
    expect(search).toHaveValue(COMMANDS_PREFIX);

    await user.keyboard("{Backspace}");

    // Still open, empty, and searching the Library.
    expect(screen.getByRole("dialog", { name: PALETTE_NAME })).toBeInTheDocument();
    expect(search).toHaveValue("");
    expect(sectionOptions(dialog, "Pages").map(optionLabel)).toEqual([
      "Open Chapter…",
      "Go to Book…",
      "Open Note…",
      "Open Canvas…",
    ]);
    await waitFor(() =>
      expect(within(dialog).getByRole("status")).toHaveTextContent(
        en("commandPalette.modes.library")
      )
    );
  });

  it("typing > inside a nested page leaves it for Commands mode", async () => {
    await createNoteRow({ title: "Nested Note", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Open Note");
    const page = await within(dialog).findByRole("option", { name: "Open Note…" });
    await arrowToAndChoose(user, dialog, search, page);
    expect(await within(dialog).findByText("Showing Open Note")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("option").map(optionLabel)).toEqual(["Nested Note"]);

    // > always means Commands, so it leaves the page instead of searching it.
    await user.keyboard(">");
    await waitFor(() => expect(within(dialog).queryByText("Showing Open Note")).toBeNull());
    expect(search).toHaveValue(COMMANDS_PREFIX);
    await waitFor(() => expect(sectionOptions(dialog, "Suggested").length).toBeGreaterThan(0));
    expect(within(dialog).queryByRole("option", { name: "Nested Note" })).toBeNull();
  });

  it("lists recent Commands and Settings rows, then suggested Commands, with nothing typed", async () => {
    useCommandPaletteRecentStore.setState({
      keys: ["command:global.themeDark", "settingsRow:theme"],
    });
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openPaletteWithF1(user);
    expect(sectionOptions(dialog, "Recent").map(optionLabel)).toEqual(["Dark", "Theme"]);
    const suggested = sectionOptions(dialog, "Suggested").map(optionLabel);
    expect(suggested.length).toBeGreaterThan(0);
    expect(suggested).toContain("Create new book");
    // Commands mode has no Library pages to browse.
    expect(within(dialog).queryByRole("group", { name: "Pages" })).toBeNull();
  });

  it("lists recent Library items, then the four pages, with nothing typed", async () => {
    const book = await createBookRow({ title: "Recent Book", authorName: "Author" }, "local");
    useCommandPaletteRecentStore.setState({
      keys: [`book:${book.id}`, "command:global.themeDark"],
    });
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    await waitFor(() =>
      expect(sectionOptions(dialog, "Recent").map(optionLabel)).toEqual(["Recent Book"])
    );
    expect(sectionOptions(dialog, "Pages").map(optionLabel)).toEqual([
      "Open Chapter…",
      "Go to Book…",
      "Open Note…",
      "Open Canvas…",
    ]);
    // Library Search has no Commands to suggest.
    expect(within(dialog).queryByRole("group", { name: "Suggested" })).toBeNull();
  });

  it("keeps one recent list, filtered per mode, and removes from it in both", async () => {
    const note = await createNoteRow({ title: "Recent Note", bookId: null }, "local");
    useCommandPaletteRecentStore.setState({
      keys: ["command:global.themeDark", `note:${note.id}`],
    });
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    // Commands mode shows only the Command of the two.
    let dialog = await openPaletteWithF1(user);
    await waitFor(() =>
      expect(sectionOptions(dialog, "Recent").map(optionLabel)).toEqual(["Dark"])
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());

    // Library Search shows only the Note; removing it leaves the Command.
    dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await waitFor(() =>
      expect(sectionOptions(dialog, "Recent").map(optionLabel)).toEqual(["Recent Note"])
    );
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(activeResultLabel(search)).toContain("Recent Note"));
    await user.keyboard("{Shift>}{Delete}{/Shift}");
    await waitFor(() => expect(within(dialog).queryByRole("group", { name: "Recent" })).toBeNull());
    expect(useCommandPaletteRecentStore.getState().keys).toEqual(["command:global.themeDark"]);

    // The Command's own mode still lists it, and removes it too.
    await user.keyboard("{Escape}");
    dialog = await openPaletteWithF1(user);
    expect(sectionOptions(dialog, "Recent").map(optionLabel)).toEqual(["Dark"]);
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Shift>}{Delete}{/Shift}");
    await waitFor(() => expect(useCommandPaletteRecentStore.getState().keys).toEqual([]));
    await waitFor(() => expect(within(dialog).queryByRole("group", { name: "Recent" })).toBeNull());
    expect(sectionOptions(dialog, "Suggested").length).toBeGreaterThan(0);
  });
});

describe("Command Palette search switches", () => {
  const MATCH_CASE = "Match Case";
  const WHOLE_WORD = "Match Whole Word";
  const REGEX = "Use Regular Expression";

  function switchButton(dialog: HTMLElement, name: string): HTMLElement {
    return within(dialog).getByRole("button", { name });
  }

  const switches = () => useSearchSwitchesStore.getState();

  it("shows its three switches in Library Search only", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    // Commands mode stays plain.
    let dialog = await openPaletteWithF1(user);
    for (const name of [MATCH_CASE, WHOLE_WORD, REGEX]) {
      expect(within(dialog).queryByRole("button", { name })).toBeNull();
    }
    // Its switch keys are inert there: no invisible state to flip.
    await user.keyboard("{Alt>}c{/Alt}");
    expect(switches().matchCase).toBe(false);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());

    dialog = await openLibrarySearch(user);
    for (const name of [MATCH_CASE, WHOLE_WORD, REGEX]) {
      expect(switchButton(dialog, name)).toBeVisible();
    }
  });

  it("toggles each switch with Alt+C, Alt+W and Alt+R and keeps the typed query", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Cat");
    expect(search).toHaveValue("Cat");

    await user.keyboard("{Alt>}c{/Alt}");
    await waitFor(() => expect(switches().matchCase).toBe(true));
    await user.keyboard("{Alt>}w{/Alt}");
    await waitFor(() => expect(switches().wholeWord).toBe(true));
    await user.keyboard("{Alt>}r{/Alt}");
    await waitFor(() => expect(switches().regex).toBe(true));

    // The switch keys are not typed into the field.
    expect(search).toHaveValue("Cat");
  });

  it("renders the switches inside the search field's wrapper", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const input = paletteSearch(dialog);
    const field = switchButton(dialog, MATCH_CASE).closest(".relative");
    expect(field).not.toBeNull();
    expect(field).toContainElement(input);
    for (const name of [MATCH_CASE, WHOLE_WORD, REGEX]) {
      expect(field).toContainElement(switchButton(dialog, name));
    }
  });

  it("tabs from the search field to Match case, and Space flips it", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const input = paletteSearch(dialog);
    await waitFor(() => expect(input).toHaveFocus());

    await user.tab();
    const matchCase = switchButton(dialog, MATCH_CASE);
    expect(matchCase).toHaveFocus();
    expect(matchCase).toHaveAttribute("aria-pressed", "false");

    await user.keyboard(" ");
    await waitFor(() => expect(switches().matchCase).toBe(true));
    expect(matchCase).toHaveAttribute("aria-pressed", "true");
  });

  it("flips a switch back with its own key", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await openLibrarySearch(user);
    await user.keyboard("{Alt>}c{/Alt}");
    await waitFor(() => expect(switches().matchCase).toBe(true));

    await user.keyboard("{Alt>}c{/Alt}");
    await waitFor(() => expect(switches().matchCase).toBe(false));
  });

  it("toggles from a press, so the switches work without a keyboard", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    await user.click(switchButton(dialog, WHOLE_WORD));
    await waitFor(() => expect(switches().wholeWord).toBe(true));

    await user.click(switchButton(dialog, WHOLE_WORD));
    await waitFor(() => expect(switches().wholeWord).toBe(false));
  });

  it("shows each Shortcut while the field is empty and hides it once the author types", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    for (const name of [MATCH_CASE, WHOLE_WORD, REGEX]) {
      expect(switchButton(dialog, name).textContent ?? "").toContain("Alt");
    }

    await user.keyboard("a");
    for (const name of [MATCH_CASE, WHOLE_WORD, REGEX]) {
      expect(switchButton(dialog, name).textContent ?? "").not.toContain("Alt");
    }
  });

  it("remembers the switches when the palette reopens", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    let dialog = await openLibrarySearch(user);
    await user.keyboard("{Alt>}c{/Alt}");
    await waitFor(() => expect(switches().matchCase).toBe(true));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());

    dialog = await openLibrarySearch(user);
    expect(switches().matchCase).toBe(true);
    // The reopened palette's buttons still carry the state.
    expect(switchButton(dialog, MATCH_CASE)).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the switches across a simulated reload from this device's storage", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await openLibrarySearch(user);
    await user.keyboard("{Alt>}w{/Alt}");
    await waitFor(() => expect(switches().wholeWord).toBe(true));
    await user.keyboard("{Escape}");

    const saved = localStorage.getItem(SEARCH_SWITCHES_STORAGE_KEY) ?? "";
    expect(saved).not.toBe("");

    // A reload starts from the defaults and reads the device's blob back.
    useSearchSwitchesStore.setState({ matchCase: false, wholeWord: false, regex: false });
    localStorage.setItem(SEARCH_SWITCHES_STORAGE_KEY, saved);
    await useSearchSwitchesStore.persist.rehydrate();
    expect(switches().wholeWord).toBe(true);

    const dialog = await openLibrarySearch(user);
    expect(switchButton(dialog, WHOLE_WORD)).toHaveAttribute("aria-pressed", "true");
  });

  it("flips the same switches from the Notes editor, with no palette open", async () => {
    const note = await createNoteRow({ title: "Switch Note", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp(`/notes/${note.id}`);
    await settleOn(`/notes/${note.id}`);

    await user.keyboard("{Alt>}c{/Alt}");
    await waitFor(() => expect(switches().matchCase).toBe(true));

    await user.keyboard("{Alt>}w{/Alt}");
    await waitFor(() => expect(switches().wholeWord).toBe(true));

    await user.keyboard("{Alt>}r{/Alt}");
    await waitFor(() => expect(switches().regex).toBe(true));
  });
});

describe("Command Palette text results", () => {
  async function seedHarbour() {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "Lookout" }, "local");
    await updateChapterRow(
      chapter.id,
      { content: "<p>The harbour light blinked, harbour dark</p>" },
      "local"
    );
    const note = await createNoteRow(
      { title: "Marginalia", content: "<p>harbour gossip</p>" },
      "local"
    );
    return { book, chapter, note };
  }

  /** The Text group's options, by each one's accessible name. */
  function textOptionsByName(dialog: HTMLElement): Map<string, HTMLElement> {
    return new Map(
      sectionOptions(dialog, "Text").map(
        (option) => [option.getAttribute("aria-label") ?? "", option] as const
      )
    );
  }

  it("lists title matches first, then one Text row per item", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "Harbour Watch" }, "local");
    await updateChapterRow(
      chapter.id,
      { content: "<p>The harbour light blinked, harbour dark</p>" },
      "local"
    );
    await createNoteRow({ title: "Marginalia", content: "<p>harbour gossip</p>" }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    await user.keyboard("harbour");

    const textGroup = await within(dialog).findByRole("group", { name: "Text" });
    // The Text section trails every title section.
    const chaptersGroup = within(dialog).getByRole("group", { name: "Chapters" });
    expect(
      chaptersGroup.compareDocumentPosition(textGroup) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // One row per item, however many times the item matched.
    expect(sectionOptions(dialog, "Text")).toHaveLength(2);
    // Two matches fit well under the cap, so no refine line.
    expect(within(dialog).queryByText(en("commandPalette.textRefine"))).toBeNull();
  });

  it("highlights the snippet, names the Book, says how many more, and announces it all", async () => {
    await seedHarbour();
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    await user.keyboard("harbour");
    await within(dialog).findByRole("group", { name: "Text" });

    const byName = textOptionsByName(dialog);
    const chapterName = [...byName.keys()].find((name) => name.includes("Lookout"));
    expect(chapterName).toBeDefined();
    const chapterOption = byName.get(chapterName as string) as HTMLElement;
    // The accessible name carries kind, title, Book, and snippet text.
    expect(chapterName).toContain("Chapter");
    expect(chapterName).toContain("Lookout");
    expect(chapterName).toContain("Atlas");
    expect(chapterName).toContain("harbour");
    // The match is highlighted where it stands.
    const mark = chapterOption.querySelector("mark");
    expect(mark?.textContent).toBe("harbour");
    // The Book is the detail, and two matches say one more.
    expect(chapterOption.textContent).toContain("Atlas");
    expect(chapterOption.textContent).toContain(en("commandPalette.textMore", { count: 1 }));

    // The single-match Note names no "+N more".
    const noteName = [...byName.keys()].find((name) => name.includes("Marginalia"));
    expect(noteName).toBeDefined();
    expect(noteName).toContain("Note");
    expect(noteName).toContain("harbour");
    expect((byName.get(noteName as string) as HTMLElement).textContent).not.toContain("+");
  });

  it("announces the result count with the text results in it", async () => {
    await seedHarbour();
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    await user.keyboard("harbour");
    await within(dialog).findByRole("group", { name: "Text" });

    // No title matches "harbour": the two text rows are the whole count.
    await waitFor(() =>
      expect(within(dialog).getByRole("status")).toHaveTextContent(
        en("commandPalette.resultCount", { count: 2 })
      )
    );
  });

  it("caps the Text section at 50 rows with a line asking to refine", async () => {
    for (let index = 0; index < 55; index += 1) {
      await createNoteRow(
        { title: `Cap Note ${index}`, content: "<p>capybara meadow</p>" },
        "local"
      );
    }
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    await user.keyboard("capybara");

    await within(dialog).findByRole("group", { name: "Text" });
    // The list virtualizes to its viewport, so jsdom mounts only the visible
    // rows: the cap shows as the refine line, which renders only when the
    // module reports more than the Text section's 50 rows.
    expect(await within(dialog).findByText(en("commandPalette.textRefine"))).toBeInTheDocument();
    const rendered = sectionOptions(dialog, "Text");
    expect(rendered.length).toBeGreaterThan(2);
    expect(rendered.length).toBeLessThanOrEqual(50);
  });

  it("narrows the text results on a nested page", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    await createChapterRow({ bookId: book.id, title: "Lookout" }, "local").then((chapter) =>
      updateChapterRow(chapter.id, { content: "<p>sharedword in a chapter</p>" }, "local")
    );
    await createNoteRow({ title: "Marginalia", content: "<p>sharedword in a note</p>" }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Open Note");
    const page = await within(dialog).findByRole("option", { name: "Open Note…" });
    await arrowToAndChoose(user, dialog, search, page);
    expect(await within(dialog).findByText("Showing Open Note")).toBeInTheDocument();

    await user.keyboard("sharedword");
    await within(dialog).findByRole("group", { name: "Text" });
    await waitFor(() => expect(sectionOptions(dialog, "Text")).toHaveLength(1));
    const names = [...textOptionsByName(dialog).keys()];
    expect(names.some((name) => name.includes("Marginalia"))).toBe(true);
    expect(names.some((name) => name.includes("Lookout"))).toBe(false);
  });

  it("follows Match case: toggling it changes the text results", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "Felines" }, "local");
    await updateChapterRow(chapter.id, { content: "<p>Cat cat</p>" }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    await user.keyboard("Cat");
    await within(dialog).findByRole("group", { name: "Text" });
    // Case ignored: both fall on one row with one more.
    await waitFor(() =>
      expect(sectionOptions(dialog, "Text")[0].textContent).toContain(
        en("commandPalette.textMore", { count: 1 })
      )
    );

    await user.keyboard("{Alt>}c{/Alt}");
    // Case matched: one match left, so the "+N more" goes.
    await waitFor(() =>
      expect(sectionOptions(dialog, "Text")[0].textContent).not.toContain(
        en("commandPalette.textMore", { count: 1 })
      )
    );
    expect(sectionOptions(dialog, "Text")).toHaveLength(1);
  });

  it("shows an error line instead of text results for an invalid Regex", async () => {
    await seedHarbour();
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    // Alt+R keeps focus in the field; a click would leave it on the button.
    await user.keyboard("{Alt>}r{/Alt}");
    // "[" would read as user-event's repeat syntax; "(" is an invalid Regex
    // all the same and types literally.
    await user.keyboard("(unclosed");

    expect(
      await within(dialog).findByText(en("commandPalette.textInvalidRegex"), { exact: false })
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("group", { name: "Text" })).toBeNull();
  });

  it("shows Indexing… while a rebuild runs, with the results found so far", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "Lookout" }, "local");
    await updateChapterRow(chapter.id, { content: "<p>The harbour light blinked</p>" }, "local");

    // Stall the rebuild inside its first write: the flag stays up while the
    // text search (plain SELECTs) still answers.
    const adapter = authorDb.current as DatabaseAdapter;
    const realExecuteAtomic = adapter.executeAtomic.bind(adapter);
    let releaseRebuild!: () => void;
    const rebuildGate = new Promise<void>((resolve) => {
      releaseRebuild = resolve;
    });
    adapter.executeAtomic = (async (statements) => {
      await rebuildGate;
      return realExecuteAtomic(statements);
    }) as DatabaseAdapter["executeAtomic"];
    const rebuildPromise = requestSearchRebuild();
    try {
      const user = userEvent.setup();
      renderApp("/");
      await settleOn("/");

      const dialog = await openLibrarySearch(user);
      await user.keyboard("harbour");
      expect(
        await within(dialog).findByText(en("commandPalette.textIndexing"))
      ).toBeInTheDocument();
      expect(await within(dialog).findByRole("group", { name: "Text" })).toBeInTheDocument();
    } finally {
      releaseRebuild();
      await rebuildPromise;
      resetSearchIndexForTests();
      adapter.executeAtomic = realExecuteAtomic;
    }
  });

  it("reruns the Text query when a rebuild ends, with no further keystroke", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "Lookout" }, "local");
    await updateChapterRow(chapter.id, { content: "<p>The harbour light blinked</p>" }, "local");

    // The index answers nothing while the rebuild runs, then the match appears
    // once it ends. Nothing types after the rebuild ends.
    indexBlank.value = true;
    const adapter = authorDb.current as DatabaseAdapter;
    const realExecuteAtomic = adapter.executeAtomic.bind(adapter);
    let releaseRebuild!: () => void;
    const rebuildGate = new Promise<void>((resolve) => {
      releaseRebuild = resolve;
    });
    adapter.executeAtomic = (async (statements) => {
      await rebuildGate;
      return realExecuteAtomic(statements);
    }) as DatabaseAdapter["executeAtomic"];
    const rebuildPromise = requestSearchRebuild();
    try {
      const user = userEvent.setup();
      renderApp("/");
      await settleOn("/");

      const dialog = await openLibrarySearch(user);
      await user.keyboard("harbour");
      expect(
        await within(dialog).findByText(en("commandPalette.textIndexing"))
      ).toBeInTheDocument();
      expect(within(dialog).queryByRole("group", { name: "Text" })).toBeNull();

      indexBlank.value = false;
      releaseRebuild();
      await rebuildPromise;
      expect(await within(dialog).findByRole("group", { name: "Text" })).toBeInTheDocument();
    } finally {
      indexBlank.value = false;
      releaseRebuild();
      await rebuildPromise;
      resetSearchIndexForTests();
      adapter.executeAtomic = realExecuteAtomic;
    }
  });

  it("ignores a stale scan: el then quickly ela shows only the latest", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const short = await createChapterRow({ bookId: book.id, title: "Gato" }, "local");
    await updateChapterRow(short.id, { content: "<p>el gato duerme</p>" }, "local");
    const long = await createChapterRow({ bookId: book.id, title: "Elastico" }, "local");
    await updateChapterRow(long.id, { content: "<p>material elastico</p>" }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    // "el" scans, so it waits for a pause; "ela" queries at once and drops it.
    await user.keyboard("el");
    await user.keyboard("a");
    expect(search).toHaveValue("ela");

    await within(dialog).findByRole("group", { name: "Text" });
    await waitFor(() => {
      const names = [...textOptionsByName(dialog).keys()];
      expect(names.some((name) => name.includes("Elastico"))).toBe(true);
      expect(names.some((name) => name.includes("Gato"))).toBe(false);
    });
  });

  it("opens a text row on the same item its title row would open", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "Beacon" }, "local");
    await updateChapterRow(chapter.id, { content: "<p>The lighthouse keeper waits</p>" }, "local");
    const user = userEvent.setup();
    renderApp(`/book/${book.id}`);
    await settleOn(`/book/${book.id}`);

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("lighthouse");
    const options = await waitFor(() => {
      const found = sectionOptions(dialog, "Text");
      expect(found).toHaveLength(1);
      return found;
    });
    expect(options[0].getAttribute("aria-label")).toContain("Beacon");
    await arrowToAndChoose(user, dialog, search, options[0]);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(path).toBe(`/book/${book.id}`));
    await waitFor(() => expect(openChapterTitle()).toBe("Beacon"));
    expect(chapter).toBeDefined();
  });
});

describe("Command Palette entry buttons", () => {
  const BUTTON_NAME = en("shortcuts.openCommandPalette");

  /**
   * Every always-visible entry point, outside inert drawers and sheets. The
   * sidebars mount twice (desktop plus the closed mobile drawer), so the
   * inert copy is skipped: only the reachable button counts.
   */
  function visiblePaletteButtons(): HTMLElement[] {
    return screen
      .getAllByRole("button", { name: BUTTON_NAME })
      .filter((button) => button.closest("[inert]") === null);
  }

  /** Tabs from the body until the entry button holds focus; keyboard only. */
  async function tabToEntryButton(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    for (let i = 0; i < 250; i++) {
      const focused = visiblePaletteButtons().find((button) => button === document.activeElement);
      if (focused) return focused;
      await user.tab();
    }
    throw new Error("the palette entry button never took focus");
  }

  /** Enter opens the palette; Escape closes it and focus returns to the button. */
  async function openFromButton(user: ReturnType<typeof userEvent.setup>, button: HTMLElement) {
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    expect(paletteSearch(dialog)).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    expect(button).toHaveFocus();
  }

  it("opens from the main sidebar footer on / and returns focus to it", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    expect(visiblePaletteButtons()).toHaveLength(1);
    await openFromButton(user, await tabToEntryButton(user));
  });

  it("opens from the Chapter list footer in the Book Editor", async () => {
    const book = await createBookRow({ title: "Footer Book", authorName: "Author" }, "local");
    await createChapterRow({ bookId: book.id, title: "Only Chapter" }, "local");
    const user = userEvent.setup();
    renderApp(`/book/${book.id}`);
    await settleOn(`/book/${book.id}`);

    expect(visiblePaletteButtons()).toHaveLength(1);
    // Focus starts in the Chapter text, where Tab indents instead of moving:
    // Escape leaves for the chapter list first.
    await user.keyboard("{Escape}");
    await openFromButton(user, await tabToEntryButton(user));
  });

  it("keeps the Notes footer and button with zero pinned Notes and no pinned text", async () => {
    useSettingsStore.setState({ notesListView: "list" });
    const note = await createNoteRow({ title: "Solo", bookId: null }, "local");
    const user = userEvent.setup();
    renderApp(`/notes/${note.id}`);
    await waitFor(() => expect(path).toBe(`/notes/${note.id}`));
    await screen.findByRole("row", { name: "Solo" });

    expect(visiblePaletteButtons()).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/\d+ pinned/);
    await openFromButton(user, await tabToEntryButton(user));
  });

  it("shows '1 pinned' in list view with one pinned Note", async () => {
    useSettingsStore.setState({ notesListView: "list" });
    const note = await createNoteRow({ title: "Pinned One", bookId: null, pinned: true }, "local");
    const user = userEvent.setup();
    renderApp(`/notes/${note.id}`);
    await waitFor(() => expect(path).toBe(`/notes/${note.id}`));

    expect(await screen.findByText("1 pinned")).toBeInTheDocument();
    expect(visiblePaletteButtons()).toHaveLength(1);
    await openFromButton(user, await tabToEntryButton(user));
  });

  /**
   * The Layers breakpoint the Cover Designer answers to. The suite polyfill
   * reports every query as not matching, so wide must be stubbed per query.
   */
  function stubLayersMedia(wide: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: wide && query === "(min-width: 768px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }));
  }

  it("opens from the Layers sidebar footer in a wide Cover Designer", async () => {
    stubLayersMedia(true);
    try {
      const book = await createBookRow({ title: "Cover Book", authorName: "Author" }, "local");
      const user = userEvent.setup();
      renderApp(`/book/${book.id}/cover`);
      await settleOn(`/book/${book.id}/cover`);

      // The sidebar (inside main) carries the one button; the toolbar has none.
      const buttons = visiblePaletteButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0].closest("main")).not.toBeNull();
      await openFromButton(user, await tabToEntryButton(user));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders only the toolbar button in a narrow Cover Designer", async () => {
    stubLayersMedia(false);
    try {
      const book = await createBookRow({ title: "Narrow Cover", authorName: "Author" }, "local");
      const user = userEvent.setup();
      renderApp(`/book/${book.id}/cover`);
      await settleOn(`/book/${book.id}/cover`);

      // The sidebar footer stays unrendered; the toolbar carries the one button.
      const buttons = visiblePaletteButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0].closest("main")).toBeNull();
      await openFromButton(user, await tabToEntryButton(user));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens from the last button of the Canvas tool column", async () => {
    const canvas = await createCanvasRow({ title: "Tool Column" }, "local");
    const user = userEvent.setup();
    renderApp(`/canvas/${canvas.id}`);
    await settleOn(`/canvas/${canvas.id}`);

    const buttons = visiblePaletteButtons();
    expect(buttons).toHaveLength(1);
    const entry = buttons[0];
    // The React Aria Toolbar owns arrow-key travel: Tab enters the column,
    // then ArrowDown moves between its buttons. Tab alone must not be used
    // to reach the last button (the toolbar's Tab handler parks focus and
    // remembers a stale button, so a later dialog restore would land there).
    for (let i = 0; i < 250; i++) {
      const focused = document.activeElement as HTMLElement | null;
      if (focused && focused.closest?.('[role="toolbar"]')) break;
      await user.tab();
    }
    expect(document.activeElement?.closest?.('[role="toolbar"]')).not.toBeNull();
    for (let i = 0; i < 20; i++) {
      if (document.activeElement === entry) break;
      await user.keyboard("{ArrowDown}");
    }
    await openFromButton(user, entry);
  });
});
