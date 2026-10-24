import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { mockVirtualizerLayout } from "@/test/support/virtualizer-layout";

// The handoff a Library Search text row carries to its destination, driven
// with real keys over a real in-memory Library seeded through the write
// paths. Only what jsdom cannot run is stubbed: the Fabric cover stage, React
// Flow's canvas surface, the metrics worker, Dictation, and the update check.
// Prior art: CommandPalette.test.tsx.
const { authorDb, platform, web } = vi.hoisted(() => ({
  authorDb: { current: null as DatabaseAdapter | null },
  platform: { desktop: true },
  web: { value: false },
}));

const flowMocks = vi.hoisted(() => ({
  setCenter: vi.fn(),
}));

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
  setLaunchStartup: vi.fn(async () => undefined),
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
    setCenter: flowMocks.setCenter,
    getNode: () => undefined,
    screenToFlowPosition: (point: { x: number; y: number }) => point,
    flowToScreenPosition: (point: { x: number; y: number }) => point,
    getZoom: () => 1,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: vi.fn(),
  }),
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ transform: [0, 0, 0.1 + 0.9], width: 800, height: 600 }),
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
const { createCanvasRow, updateCanvasDocRow } = await import("@/features/canvas/write");
const { createDefaultCanvasDoc } = await import("@/features/canvas/types");
const { CANVAS_TEXT_NODE_DEFAULT_WIDTH } = await import("@/constants");
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
const { useSearchSwitchesStore } = await import("@/features/search/switches");
const { DEFAULT_SHORTCUT_SETTINGS } = await import("@/lib/shortcut-resolve");
const { resetSyncEngineForTests } = await import("@/features/sync/sync-engine");
const { resetAutoSyncForTests } = await import("@/features/sync/auto-sync");
void getDatabase;

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

// Back/Forward through the router's own history, the way the browser buttons do.
let goByDelta: ((delta: number) => void) | null = null;
function NavProbe() {
  const navigate = useNavigate();
  useEffect(() => {
    goByDelta = navigate;
  }, [navigate]);
  return null;
}

function renderApp(initialPath = "/") {
  path = initialPath;
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
      <LocationProbe />
      <NavProbe />
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

/** Opens the palette straight into Library Search, as the Search Library Command does. */
async function openLibrarySearch(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Control>}{Alt>}p{/Alt}{/Control}");
  return screen.findByRole("dialog", { name: PALETTE_NAME });
}

function paletteSearch(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("searchbox", { name: "Find by name" });
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

/** The options of one titled section of the results, e.g. "Text". */
function sectionOptions(dialog: HTMLElement, name: string): HTMLElement[] {
  return within(within(dialog).getByRole("group", { name })).getAllByRole("option");
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

function findInput(): HTMLElement | null {
  return screen.queryByPlaceholderText(en("editor.find"));
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
  flowMocks.setCenter.mockClear();
});

afterEach(() => {
  web.value = false;
});

describe("Library Search text handoff", () => {
  it("opens a chapter text row with Find and Replace on the query, steps matches, and stays shut across Back/Forward", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    await createChapterRow({ bookId: book.id, title: "Lookout" }, "local").then((chapter) =>
      updateChapterRow(
        chapter.id,
        { content: "<p>The harbour light blinked, harbour dark</p>" },
        "local"
      )
    );
    const user = userEvent.setup();
    renderApp(`/book/${book.id}`);
    await settleOn(`/book/${book.id}`);

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("harbour");
    const options = await waitFor(() => {
      const found = sectionOptions(dialog, "Text");
      expect(found).toHaveLength(1);
      return found;
    });
    await arrowToAndChoose(user, dialog, search, options[0]);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(path).toBe(`/book/${book.id}`));
    await waitFor(() => expect(openChapterTitle()).toBe("Lookout"));

    // Find and Replace opened with the query, at the first of two matches.
    const find = await screen.findByPlaceholderText(en("editor.find"));
    expect(find).toHaveValue("harbour");
    expect(await screen.findByText(en("editor.matchesOf", { current: 1, total: 2 }))).toBeVisible();
    // The shared switches arrive as they were: everything off.
    expect(useSearchSwitchesStore.getState()).toMatchObject({
      matchCase: false,
      wholeWord: false,
      regex: false,
    });

    // Enter steps to the next match, all by keyboard.
    await user.click(find);
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByText(en("editor.matchesOf", { current: 2, total: 2 }))).toBeVisible()
    );

    // The history entry carries no handoff once consumed: closing, then Back
    // and Forward, never reopens Find and Replace.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(findInput()).toBeNull());

    await act(async () => {
      goByDelta?.(-1);
    });
    await waitFor(() => expect(findInput()).toBeNull());
    await act(async () => {
      goByDelta?.(1);
    });
    await waitFor(() => expect(findInput()).toBeNull());
  });

  it("opens a note text row with the query and switches, steps matches, and stays shut across Back/Forward", async () => {
    const note = await createNoteRow(
      { title: "Marginalia", content: "<p>Harbour light, harbour dark</p>" },
      "local"
    );
    const user = userEvent.setup();
    renderApp("/notes");
    await settleOn("/notes");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("Harbour");
    // Case ignored: two matches on one row.
    await within(dialog).findByRole("group", { name: "Text" });
    await user.keyboard("{Alt>}c{/Alt}");
    // Case matched: one match left, so Find and Replace must show it with the switch on.
    const options = await waitFor(() => {
      const found = sectionOptions(dialog, "Text");
      expect(found).toHaveLength(1);
      return found;
    });
    expect(options[0].textContent).not.toContain("+");
    await arrowToAndChoose(user, dialog, search, options[0]);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(path).toBe(`/notes/${note.id}`));

    const find = await screen.findByPlaceholderText(en("editor.find"));
    expect(find).toHaveValue("Harbour");
    expect(await screen.findByText(en("editor.matchesOf", { current: 1, total: 1 }))).toBeVisible();
    expect(useSearchSwitchesStore.getState().matchCase).toBe(true);

    await user.click(find);
    await user.keyboard("{Enter}");
    // A single match wraps to itself.
    await waitFor(() =>
      expect(screen.getByText(en("editor.matchesOf", { current: 1, total: 1 }))).toBeVisible()
    );

    await user.keyboard("{Escape}");
    await waitFor(() => expect(findInput()).toBeNull());

    await act(async () => {
      goByDelta?.(-1);
    });
    await waitFor(() => expect(path).toBe("/notes"));
    await act(async () => {
      goByDelta?.(1);
    });
    await waitFor(() => expect(path).toBe(`/notes/${note.id}`));
    await waitFor(() => expect(findInput()).toBeNull());
  });

  it("opens a stale text row normally, with the real count and no error", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "Lookout" }, "local");
    await updateChapterRow(
      chapter.id,
      { content: "<p>The harbour light blinked, harbour dark</p>" },
      "local"
    );
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("harbour");
    const options = await waitFor(() => {
      const found = sectionOptions(dialog, "Text");
      expect(found).toHaveLength(1);
      return found;
    });

    // The item's text changes after the row was listed: the match is gone.
    await updateChapterRow(chapter.id, { content: "<p>Calm seas under a new moon</p>" }, "local");
    await arrowToAndChoose(user, dialog, search, options[0]);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(path).toBe(`/book/${book.id}`));
    await waitFor(() => expect(openChapterTitle()).toBe("Lookout"));

    // It still opens, with the query and the real (empty) count, and no error.
    const find = await screen.findByPlaceholderText(en("editor.find"));
    expect(find).toHaveValue("harbour");
    expect(await screen.findByText(en("editor.noMatches"))).toBeVisible();
    expect(screen.queryByText(en("editor.invalidRegex"))).toBeNull();
  });

  it("opens a canvas text row centered on the card, with the card selected", async () => {
    const canvas = await createCanvasRow({ title: "Map" }, "local");
    await updateCanvasDocRow(
      canvas.id,
      {
        ...createDefaultCanvasDoc(),
        nodes: [
          { id: "card-1", kind: "text", position: { x: 0, y: 0 }, html: "<p>unrelated</p>" },
          {
            id: "card-2",
            kind: "text",
            position: { x: 400, y: 300 },
            html: "<p>alpha signal</p>",
          },
        ],
      },
      "local"
    );
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    const dialog = await openLibrarySearch(user);
    const search = paletteSearch(dialog);
    await user.keyboard("alpha");
    const options = await waitFor(() => {
      const found = sectionOptions(dialog, "Text");
      expect(found).toHaveLength(1);
      return found;
    });
    await arrowToAndChoose(user, dialog, search, options[0]);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(path).toBe(`/canvas/${canvas.id}`));
    // The card is selected in the canvas's public state...
    await waitFor(() => expect(useCanvasStore.getState().selectedNodeId).toBe("card-2"));
    // ...and the viewport centers on it, keeping its zoom.
    expect(flowMocks.setCenter).toHaveBeenCalledWith(
      400 + CANVAS_TEXT_NODE_DEFAULT_WIDTH / 2,
      300,
      { zoom: 1, duration: 0 }
    );
  });

  it("opens a book field row on the book, and a title row without Find and Replace", async () => {
    const book = await createBookRow(
      {
        title: "Sunrise",
        subtitle: "A quiet harbour",
        description: "Fog lifts over the water",
        authorName: "Author",
      },
      "local"
    );
    const chapter = await createChapterRow({ bookId: book.id, title: "Beacon" }, "local");
    await updateChapterRow(chapter.id, { content: "<p>calm seas</p>" }, "local");
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    // The description match is a text row of the book: choosing it opens the book.
    const dialog = await openLibrarySearch(user);
    let search = paletteSearch(dialog);
    await user.keyboard("Fog");
    const textOptions = await waitFor(() => {
      const found = sectionOptions(dialog, "Text");
      expect(found).toHaveLength(1);
      return found;
    });
    await arrowToAndChoose(user, dialog, search, textOptions[0]);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(path).toBe(`/book/${book.id}`));
    expect(findInput()).toBeNull();

    // A title row keeps its behavior: the chapter opens with no Find and Replace.
    const reopened = await openLibrarySearch(user);
    search = paletteSearch(reopened);
    await user.keyboard("Beacon");
    const titleOptions = await waitFor(() => {
      const found = sectionOptions(reopened, "Chapters");
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    await arrowToAndChoose(user, reopened, search, titleOptions[0]);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull());
    await waitFor(() => expect(openChapterTitle()).toBe("Beacon"));
    expect(findInput()).toBeNull();
  });
});
