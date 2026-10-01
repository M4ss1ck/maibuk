import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

// The palette dialog over the real app on a real in-memory Library, driven
// with real keys. Only what jsdom cannot run is stubbed: the Fabric cover
// stage, React Flow's canvas surface, the metrics worker, Dictation, and the
// update check. Prior art: tutorial-app.test.tsx, navigating-commands.test.tsx.
const { authorDb, platform, web } = vi.hoisted(() => ({
  authorDb: { current: null as DatabaseAdapter | null },
  platform: { desktop: true },
  web: { value: false },
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

vi.mock("@/features/version", () => ({
  useVersionCheck: () => ({ latestVersion: null, isOutdated: false }),
}));

vi.mock("@/features/backup/lifecycle", () => ({
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
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 900 },
    clientHeight: { configurable: true, get: () => 4000 },
  });
  Element.prototype.getBoundingClientRect = () => measuredRect as DOMRect;
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

const i18n = (await import("@/i18n")).default;
const App = (await import("@/App")).default;
const { closeDatabase } = await import("@/lib/db");
const { createBookRow } = await import("@/features/books/write");
const { createChapterRow, updateChapterRow } = await import("@/features/chapters/write");
const { createNoteRow } = await import("@/features/notes/write");
const librarySwitch = await import("@/features/tutorial/library-switch");
const { useTutorialStore, EMPTY_TUTORIAL_PROGRESS } = await import("@/features/tutorial");
const { useSettingsStore } = await import("@/features/settings/store");
const { useBookStore } = await import("@/features/books/store");
const { useNoteStore } = await import("@/features/notes/store");
const { useCanvasStore } = await import("@/features/canvas/store");
const { useEphemeralStore } = await import("@/features/ephemeral/store");
const { useThemeStore } = await import("@/features/theme/store");
const { useDictationStore } = await import("@/features/dictation/store");
const { useShortcutSettingsStore } = await import("@/features/settings/shortcut-store");
const { useBoundShortcutStore } = await import("@/lib/bound-shortcuts");
const { useModalStore } = await import("@/components/ui/modal-store");
const { useCommandPaletteStore } = await import("@/features/command-palette/store");
const { useCommandPaletteRecentStore } =
  await import("@/features/command-palette/recent-store");
const { DEFAULT_SHORTCUT_SETTINGS } = await import("@/lib/shortcut-resolve");
const { resetSyncEngineForTests } = await import("@/features/sync/sync-engine");
const { resetAutoSyncForTests } = await import("@/features/sync/auto-sync");
const { lastFocusedEditor } = await import("@/components/editor/editor-command-source");

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
  await waitFor(() => expect(path).toBe(screenPath), { timeout: 10_000 });
  await waitFor(() => expect(document.querySelector("[data-route-heading]")).not.toBeNull(), {
    timeout: 10_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
}

const PALETTE_NAME = "Command palette";

async function openPaletteWithF1(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{F1}");
  return screen.findByRole("dialog", { name: PALETTE_NAME }, { timeout: 10_000 });
}

function paletteSearch(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("searchbox", { name: "Search commands" });
}

/** The label of the result React Aria currently holds focused, if any. */
function activeResultLabel(search: HTMLElement): string | null {
  const id = search.getAttribute("aria-activedescendant");
  const element = id ? document.getElementById(id) : null;
  return element?.textContent ?? null;
}

async function settleEffects() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
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
  useCanvasStore.setState({ canvases: [] });
  useEphemeralStore.setState({ content: "", wordCount: 0 });
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  useCommandPaletteStore.setState({ isOpen: false, opener: null, snapshot: new Map() });
  useCommandPaletteRecentStore.setState({ keys: [] });
  useThemeStore.setState({ theme: "system" });
  document.documentElement.classList.remove("dark");
  useDictationStore.setState({ enabled: true, support: null });
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
  useBoundShortcutStore.setState({ counts: {} });
});

afterEach(() => {
  web.value = false;
});

describe("Command Palette", { timeout: 60_000 }, () => {
  it("opens with F1 with focus in the search field", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    expect(paletteSearch(dialog)).toHaveFocus();
  });

  it("opens with Mod+Shift+P on desktop", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("{Control>}{Shift>}p{/Shift}{/Control}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    expect(paletteSearch(dialog)).toHaveFocus();
  });

  it("answers to F1 only on the web build", async () => {
    web.value = true;
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    await user.keyboard("{Control>}{Shift>}p{/Shift}{/Control}");
    await settleEffects();
    expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull();

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

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull()
    );
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

    await waitFor(() =>
      expect(within(dialog).getAllByRole("option").length).toBeGreaterThan(0)
    );
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
    await waitFor(() => expect(activeOption()).toContain("command:global.toggleTheme"), {
      timeout: 2000,
    });
    const first = activeOption();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(activeOption()).not.toBe(first), { timeout: 2000 });
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
    await user.keyboard("dark");
    await within(dialog).findByRole("option", { name: "Dark" });
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull()
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(useCommandPaletteRecentStore.getState().keys).toEqual(["command:global.themeDark"]);

    // Reopening with an empty query shows only the Recent Command.
    await user.keyboard("{F1}");
    const reopened = await screen.findByRole("dialog", { name: PALETTE_NAME });
    expect(within(reopened).getByText("Recent")).toBeInTheDocument();
    const options = within(reopened).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Dark");
    expect(within(reopened).queryByText("Commands")).toBeNull();
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
    await waitFor(
      () => {
        const id = search.getAttribute("aria-activedescendant");
        const options = within(dialog).getAllByRole("option");
        expect(options.some((option) => option.id === id)).toBe(true);
      },
      { timeout: 2000 }
    );
    for (let i = 0; i < 5 && !isActive(); i++) {
      const before = search.getAttribute("aria-activedescendant");
      await user.keyboard("{ArrowDown}");
      await waitFor(() => expect(search.getAttribute("aria-activedescendant")).not.toBe(before), {
        timeout: 2000,
      });
    }
    const activeId = search.getAttribute("aria-activedescendant");
    expect(activeId).not.toBeNull();
    expect(document.getElementById(activeId as string)).toBe(toggle);
    expect(toggle).toHaveAttribute("aria-disabled", "true");

    await user.keyboard("{Enter}");
    await settleEffects();
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

    await within(dialog).findByText("No results");
    expect(within(dialog).queryByRole("option")).toBeNull();
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
    await user.keyboard("duplicate");
    await within(dialog).findByRole("option", { name: "Duplicate note" });
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull()
    );
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

    await within(dialog).findByText("No results");
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
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull()
    );
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
      await settleEffects();
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
    await settleEffects();
    expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: en("shortcuts.title") })).toBeNull()
    );
  });

  it("is absent on the embed route", async () => {
    const user = userEvent.setup();
    renderApp("/embed");
    await waitFor(() => expect(path).toBe("/embed"), { timeout: 10_000 });
    await settleEffects();

    await user.keyboard("{F1}");
    await settleEffects();
    expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull();
  });

  it("removes Recent rows with Shift+Delete and the X button, announcing each removal", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");

    // Two runs: the most recent run lists first.
    await user.keyboard("{F1}");
    let dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    await user.keyboard("dark");
    await within(dialog).findByRole("option", { name: "Dark" });
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull()
    );

    await user.keyboard("{F1}");
    dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    await user.keyboard("light");
    await within(dialog).findByRole("option", { name: "Light" });
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull()
    );

    await user.keyboard("{F1}");
    dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    const search = paletteSearch(dialog);
    let options = within(dialog).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Light", "Dark"]);

    await user.keyboard("{ArrowDown}");
    const removed = activeResultLabel(search);
    expect(["Light", "Dark"]).toContain(removed);
    const survivor = removed === "Light" ? "Dark" : "Light";

    await user.keyboard("{Shift>}{Delete}{/Shift}");
    await within(dialog).findByText("Removed from recent");
    await waitFor(() => expect(within(dialog).getAllByRole("option")).toHaveLength(1));
    options = within(dialog).getAllByRole("option");
    expect(options[0]).toHaveTextContent(survivor);
    // The highlight moved to the row that survived.
    await waitFor(() => expect(activeResultLabel(search)).toContain(survivor));

    await user.click(
      within(dialog).getByRole("button", { name: `Remove ${survivor} from recent` })
    );
    await within(dialog).findByText("Type to find a command");
    expect(within(dialog).queryByRole("option")).toBeNull();
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
      expect(useCommandPaletteRecentStore.getState().keys).toEqual([
        "command:global.themeDark",
      ])
    );
  });

  it("binds removeRecent while open and the opener on /", async () => {
    useCommandPaletteRecentStore.setState({ keys: ["command:global.themeDark"] });

    const user = userEvent.setup();
    renderApp("/");
    await settleOn("/");
    expect(useBoundShortcutStore.getState().counts["global.openCommandPalette"]).toBeGreaterThan(
      0
    );

    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: PALETTE_NAME });
    paletteSearch(dialog);
    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(
        useBoundShortcutStore.getState().counts["commandPalette.removeRecent"]
      ).toBeGreaterThan(0),
      { timeout: 2000 }
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

      const editorDom = await waitFor(
        () => {
          const element = document.querySelector(
            '[data-focus-pane="editor-main"] .tiptap'
          ) as HTMLElement | null;
          expect(element).not.toBeNull();
          return element as HTMLElement;
        },
        { timeout: 10_000 }
      );
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
      await user.keyboard("bold");
      await within(dialog).findByRole("option", { name: "Bold" });
      await user.keyboard("{ArrowDown}{Enter}");

      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: PALETTE_NAME })).toBeNull()
      );
      await waitFor(() => expect(editor?.getHTML()).toContain("<strong>world</strong>"));
      expect(editor?.view.dom.contains(document.activeElement)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
