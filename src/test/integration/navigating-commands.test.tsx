import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

// The Tutorial app's full-route setup: the real App on a real in-memory
// Library, with only what jsdom cannot run stubbed. A navigating Command is
// only visible here, where its runner really changes the route.
const { authorDb, platform } = vi.hoisted(() => ({
  authorDb: { current: null as DatabaseAdapter | null },
  platform: { desktop: true },
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

// The launch check would reach GitHub; release-check.test.ts covers it.
vi.mock("@/features/releases/release-check", () => ({ installReleaseCheck: () => () => {} }));

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

vi.mock("@/components/settings/MetricsSection", () => ({
  MetricsSection: () => <h2>Metrics</h2>,
}));
vi.mock("@/components/settings/BackupSection", () => ({
  BackupSection: () => <h2>Backups</h2>,
}));
vi.mock("@/components/settings/AsciiBanner", () => ({ AsciiBanner: () => null }));
vi.mock("@/components/settings/AsciiFieldBackground", () => ({ AsciiFieldBackground: () => null }));

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

// jsdom cannot scroll: lists scroll their selection into view.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
// Reading Position probes the caret's coordinates; jsdom has no layout.
(document as Document & { elementFromPoint?: () => null }).elementFromPoint ??= () => null;

const App = (await import("@/App")).default;
const { closeDatabase } = await import("@/lib/db");
const { createBookRow } = await import("@/features/books/write");
const { createNoteRow } = await import("@/features/notes/write");
const { createCanvasRow } = await import("@/features/canvas/write");
const librarySwitch = await import("@/features/tutorial/library-switch");
const { useTutorialStore, EMPTY_TUTORIAL_PROGRESS } = await import("@/features/tutorial");
const { useSettingsStore } = await import("@/features/settings/store");
const { useBookStore } = await import("@/features/books/store");
const { useNoteStore } = await import("@/features/notes/store");
const { useCanvasStore } = await import("@/features/canvas/store");
const { useEphemeralStore } = await import("@/features/ephemeral/store");
const { useBoundShortcutStore } = await import("@/lib/bound-shortcuts");
const { useModalStore } = await import("@/components/ui/modal-store");
const { COMMANDS, getCommand } = await import("@/lib/shortcut-registry");
import type { CommandId } from "@/lib/shortcut-registry";
const { runCommand } = await import("@/lib/command-runner");
const { resetSyncEngineForTests } = await import("@/features/sync/sync-engine");
const { resetAutoSyncForTests } = await import("@/features/sync/auto-sync");

let path = "/";
let navigateTo: (to: string) => void = () => {};
function LocationProbe() {
  path = useLocation().pathname;
  const navigate = useNavigate();
  navigateTo = (to: string) => navigate(to);
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
  // Let bindings mount and stores load from the Library.
  await waitFor(() => expect(document.querySelector("[data-route-heading]")).not.toBeNull());
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function closeLeftoverDialogs() {
  for (let i = 0; i < 5; i++) {
    const { modalIds, closers } = useModalStore.getState();
    if (modalIds.length === 0) return;
    const topmost = modalIds[modalIds.length - 1];
    const close = closers[topmost];
    if (!close) break;
    close();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const { modalIds } = useModalStore.getState();
  if (modalIds.length > 0) {
    // A scope with no close path (a mobile drawer): clear the gate so later
    // runs are judged on navigation alone. The UI stays as it is.
    useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  }
}

// Commands with side effects no test may trigger, and why each is skipped.
const SKIP: Partial<Record<CommandId, string>> = {
  "bookList.importEpub": "opens the native file picker",
  "bookList.downloadApp": "opens the download page in a browser tab",
  "bookEditor.importFiles": "opens the native file picker",
  "editor.insertImage": "opens the file chooser",
  "editor.exportMarkdown": "saves a file through the native dialog",
  "editor.exportPdf": "saves a file through the native dialog",
  "editor.exportImage": "saves a file through the native dialog",
  "global.syncNow": "starts a network sync run",
  "global.toggleAlwaysOnTop": "calls the desktop window control",
  "global.startTutorial": "starts a Tutorial run, which would gate every later run",
  "dictation.toggle": "needs the microphone and a downloaded model",
  "dictation.cycleLanguage": "needs the dictation runtime",
  "chapterItem.delete": "destructive: deletes the seeded chapter",
  "noteItem.delete": "destructive: deletes the seeded note",
  "canvasNode.delete": "destructive: deletes canvas content",
  "editor.spellCheck": "toggles the spellcheck worker, which jsdom does not have",
};

// A goto Command on its own screen runs but stays: nothing to compare.
const GOTO_TARGET: Partial<Record<CommandId, string>> = {
  "global.gotoProjects": "/",
  "global.gotoNotes": "/notes",
  "global.gotoCanvas": "/canvas",
  "global.gotoEphemeral": "/ephemeral",
  "global.gotoMetrics": "/metrics",
  "global.gotoSettings": "/settings",
};

// Commands whose runner navigates from one screen but acts in place on
// another. notes.newNote opens the new note by navigation from the gallery,
// but on a note detail screen it swaps the open note without leaving the URL.
const IN_PLACE: Partial<Record<CommandId, (screen: string) => string | null>> = {
  "notes.newNote": (screen) =>
    screen.startsWith("/notes/") ? "swaps the open note without navigating" : null,
};

beforeEach(async () => {
  await closeDatabase();
  librarySwitch.resetLibrarySwitchForTests();
  resetSyncEngineForTests();
  resetAutoSyncForTests();
  authorDb.current = await createTestDatabase();
  platform.desktop = true;
  localStorage.clear();
  const i18n = (await import("@/i18n")).default;
  await i18n.changeLanguage("en");
  useTutorialStore.setState({ progress: EMPTY_TUTORIAL_PROGRESS, status: "idle", run: null });
  useSettingsStore.setState({
    lastPath: null,
    lastNoteId: null,
    autoSync: false,
    spellCheckEnabled: false,
  });
  useBookStore.setState({ books: [], currentBook: null, error: null });
  useNoteStore.setState({ notes: [], currentNote: null, error: null });
  useCanvasStore.setState({ canvases: [] });
  useEphemeralStore.setState({ content: "", wordCount: 0 });
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
});

// One test per screen and kind keeps each well inside the suite's time
// budget: the whole sweep in one test took 3.5 minutes on CI. The last test
// checks the union, so the file runs in order.
const exercised = new Set<CommandId>();
const seen = new Set<CommandId>();

// Beyond the spec's five screens, the detail screens bind the rest of the
// navigating Commands (backToGallery, addNoteToBook, createNote).
const SCREENS: {
  name: string;
  path: (ids: { book: string; note: string; canvas: string }) => string;
}[] = [
  { name: "Books", path: () => "/" },
  { name: "Notes", path: () => "/notes" },
  { name: "a Note", path: ({ note }) => `/notes/${note}` },
  { name: "Canvases", path: () => "/canvas" },
  { name: "a Canvas", path: ({ canvas }) => `/canvas/${canvas}` },
  { name: "Ephemeral", path: () => "/ephemeral" },
  { name: "Settings", path: () => "/settings" },
  { name: "a Book", path: ({ book }) => `/book/${book}` },
];
// Commands flagged navigates and the rest, apart: a screen binds ~70 of the
// rest, and each one waits for a move that must not come.
const CASES = SCREENS.flatMap((screen) =>
  (["flagged", "unflagged"] as const).map((kind) => ({ ...screen, kind }))
);

describe.sequential("navigating Commands (issue #319)", () => {
  it.each(
    CASES
  )("a run of a $kind Command on $name changes the route iff it is flagged navigates", async ({
    path: screenPath,
    kind,
  }) => {
    const book = await createBookRow({ title: "Nav Book", authorName: "Nav Author" }, "local");
    const note = await createNoteRow({ title: "Nav Note", bookId: null }, "local");
    const canvas = await createCanvasRow({ title: "Nav Canvas" }, "local");
    const screen = screenPath({ book: book.id, note: note.id, canvas: canvas.id });
    renderApp("/");

    navigateTo(screen);
    await settleOn(screen);
    // The Ephemeral create binding only exists with text in the buffer.
    if (screen === "/ephemeral") {
      useEphemeralStore.setState({ content: "<p>draft</p>", wordCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const bound = Object.keys(useBoundShortcutStore.getState().counts) as CommandId[];

    for (const id of bound) {
      const skipReason = SKIP[id];
      if (skipReason) continue;
      if ((getCommand(id).navigates === true) !== (kind === "flagged")) continue;
      if (GOTO_TARGET[id] === path) continue;
      if (id === "ephemeral.createNote") {
        useEphemeralStore.setState({ content: "<p>draft</p>", wordCount: 1 });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      // A previous run may have unbound this id (clearing the buffer
      // unbinds createNote); only judge live bindings.
      if (!(useBoundShortcutStore.getState().counts[id] ?? 0)) continue;
      seen.add(id);
      const before = path;
      const outcome = await runCommand(id, { source: "palette" });
      const inPlaceReason = IN_PLACE[id]?.(screen);
      // Note and canvas creation navigate once the write lands. An in-place
      // run never moves, so waiting for a move would only burn the timeout.
      if (getCommand(id).navigates === true && !inPlaceReason) {
        // time-budget: a Command that wrongly stays put must not wait 10 s per id.
        await waitFor(() => expect(path).not.toBe(before), { timeout: 5_000 }).catch(() => {});
      } else {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const after = path;
      const navigates = getCommand(id).navigates === true;
      if (outcome === "ran" && navigates && after !== before) exercised.add(id);
      expect(
        after !== before,
        `${id} on ${screen}: route ${before} -> ${after}, navigates=${navigates}, outcome=${outcome}${inPlaceReason ? ` (${inPlaceReason})` : ""}`
      ).toBe(inPlaceReason ? false : navigates);
      if (after !== before) {
        navigateTo(screen);
        await settleOn(screen);
      }
      await closeLeftoverDialogs();
    }
  });

  it("ran every flagged Command on some screen", () => {
    const flagged = (Object.keys(COMMANDS) as CommandId[]).filter(
      (id) => getCommand(id).navigates === true
    );
    for (const id of flagged) {
      expect(exercised.has(id) || seen.has(id), `${id} was never exercised`).toBe(true);
      expect(exercised, `${id} never ran`).toContain(id);
    }
  });
});
