import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

// Seam 2 (issue #189): the rendered app on real in-memory databases, driven
// with real keys from the offer to the end of a run. React Joyride is not
// mocked. Only what jsdom cannot run is stubbed: the Fabric cover stage,
// React Flow's canvas surface, the metrics worker, and the update check.

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
    listBackupsPage: async () => ({ entries: [], totalCount: 0, totalSizeBytes: 0, page: 1, pageSize: 10 }),
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

// The Tutorial must never start Dictation. The runtime is a spy whose model
// install and host start/load record any call; nothing here is a real engine.
const dictationRuntime = vi.hoisted(() => ({
  getDictation: vi.fn(),
  install: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  cancelInstall: vi.fn(),
  start: vi.fn(async () => {}),
  load: vi.fn(async () => {}),
}));

vi.mock("@/features/dictation/runtime", () => ({
  getDictation: dictationRuntime.getDictation,
  resetDictationForTests: vi.fn(),
}));

const EMPTY_LINE_SUMMARY = {
  lines: 0,
  medianLatencyMs: null,
  medianInterpreterMs: null,
  maxInterpreterMs: null,
  spokenPunctuationCount: 0,
  scratchCount: 0,
  voiceCommandCount: 0,
  voiceCommandUnavailableCount: 0,
  voiceCommandRefusedCount: 0,
};

dictationRuntime.getDictation.mockImplementation(async () => ({
  session: {
    toggle: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    setLanguage: vi.fn(async () => {}),
    getSnapshot: () => ({ status: "idle" }),
  },
  host: {
    start: dictationRuntime.start,
    load: dictationRuntime.load,
    inputDevice: async () => null,
  },
  install: dictationRuntime.install,
  remove: dictationRuntime.remove,
  cancelInstall: dictationRuntime.cancelInstall,
  setNotifier: vi.fn(),
  stats: { summary: () => EMPTY_LINE_SUMMARY },
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

const i18n = (await import("@/i18n")).default;
const App = (await import("@/App")).default;
const { closeDatabase } = await import("@/lib/db");
const { createNoteRow } = await import("@/features/notes/write");
const librarySwitch = await import("@/features/tutorial/library-switch");
const { useTutorialStore, EMPTY_TUTORIAL_PROGRESS, TUTORIAL_SECTIONS, isTutorialLibraryActive } =
  await import("@/features/tutorial");
const { useSettingsStore } = await import("@/features/settings/store");
const { useBookStore } = await import("@/features/books/store");
const { useNoteStore } = await import("@/features/notes/store");
const { useCanvasStore } = await import("@/features/canvas/store");
const { useBoundShortcutStore } = await import("@/lib/bound-shortcuts");
const { Modal } = await import("@/components/ui/Modal");
const { tutorialTargetSelector } = await import("@/components/tutorial/TutorialRunner");
const { resetSyncEngineForTests } = await import("@/features/sync/sync-engine");
const { resetAutoSyncForTests, runAutoSync } = await import("@/features/sync/auto-sync");
const { useSyncStore } = await import("@/features/sync/store");

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

// A Modal the test can open over a running Tutorial, like a Sync Conflict would.
let openInterruption: (() => void) | null = null;
function Interruption() {
  const [open, setOpen] = useState(false);
  openInterruption = () => setOpen(true);
  return (
    <Modal isOpen={open} onClose={() => setOpen(false)} title="Sync Conflict">
      <p>Which one wins?</p>
    </Modal>
  );
}

function renderApp(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
      <LocationProbe />
      <Interruption />
      <input aria-label="Probe field" />
    </MemoryRouter>
  );
}

const CARD_TIMEOUT = { timeout: 10_000 };

function card(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>("[data-tutorial-card]");
  if (!dialog) throw new Error("No Tutorial card is showing");
  return dialog;
}

async function findCard(stepId: string): Promise<HTMLElement> {
  const [section, step] = stepId.split(".");
  const title = en(`tutorial.steps.${section}.${step}.title`);
  try {
    return await screen.findByRole("dialog", { name: title }, CARD_TIMEOUT);
  } catch (error) {
    const anchors = [...document.querySelectorAll("[data-tutorial]")].map((el) =>
      el.getAttribute("data-tutorial")
    );
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No card for ${stepId} on ${path}; status ${useTutorialStore.getState().status}; anchors: ${anchors.join(", ")}\n${detail}`
    );
  }
}

type User = ReturnType<typeof userEvent.setup>;

/** Moves focus to `target` with Tab alone, as a keyboard author would. */
async function tabTo(user: User, target: HTMLElement) {
  for (let i = 0; i < 12 && document.activeElement !== target; i++) await user.tab();
  expect(document.activeElement).toBe(target);
}

/** Tabs to a card button by its visible label and presses it with Enter. */
async function pressCardButton(user: User, label: string) {
  await tabTo(user, within(card()).getByRole("button", { name: label }));
  await user.keyboard("{Enter}");
}

beforeEach(async () => {
  await closeDatabase();
  librarySwitch.resetLibrarySwitchForTests();
  resetSyncEngineForTests();
  resetAutoSyncForTests();
  authorDb.current = await createTestDatabase();
  platform.desktop = true;
  localStorage.clear();
  await i18n.changeLanguage("en");
  useTutorialStore.setState({ progress: EMPTY_TUTORIAL_PROGRESS, status: "idle", run: null });
  dictationRuntime.install.mockClear();
  dictationRuntime.remove.mockClear();
  dictationRuntime.cancelInstall.mockClear();
  dictationRuntime.start.mockClear();
  dictationRuntime.load.mockClear();
  // Spell Check runs in a worker jsdom does not have.
  useSettingsStore.setState({
    lastPath: null,
    lastNoteId: null,
    autoSync: false,
    spellCheckEnabled: false,
  });
  useBookStore.setState({ books: [], currentBook: null, error: null });
  useNoteStore.setState({ notes: [], currentNote: null, error: null });
  useCanvasStore.setState({ canvases: [] });
});

afterEach(async () => {
  if (isTutorialLibraryActive()) librarySwitch.deactivateTutorialDatabase();
  librarySwitch.resetLibrarySwitchForTests();
});

describe("the first-launch offer", () => {
  it("offers the Tutorial to a new author, then runs every step to Finish", async () => {
    const user = userEvent.setup();
    renderApp("/");

    const offer = await screen.findByRole("dialog", { name: en("tutorial.offer.title") }, CARD_TIMEOUT);
    expect(offer).toHaveTextContent("5 minutes");
    await tabTo(user, within(offer).getByRole("button", { name: en("tutorial.offer.start") }));
    await user.keyboard("{Enter}");

    const total = TUTORIAL_SECTIONS.reduce((count, section) => count + section.steps.length, 0);
    let shown = 0;
    for (const section of TUTORIAL_SECTIONS) {
      for (const [index, step] of section.steps.entries()) {
        const dialog = await findCard(step.id);
        shown += 1;

        // The card names its section and where the step sits inside it.
        expect(dialog).toHaveTextContent(en(section.nameKey));
        expect(dialog).toHaveTextContent(
          en("tutorial.card.progress", { current: index + 1, total: section.steps.length })
        );
        // Focus moves into the card on every step.
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
        // Anchor gate: the control this step points at is on this screen,
        // rendered from the Tutorial Library's sample content.
        expect(
          document.querySelector(tutorialTargetSelector(step.id)),
          `${step.id} has no target on ${path}`
        ).not.toBeNull();
        expect(path).toBe(step.route ?? section.route);

        // Next (Finish on the last step) holds focus, so Enter alone walks on.
        const isLast = shown === total;
        const next = within(dialog).getByRole("button", {
          name: en(isLast ? "tutorial.card.finish" : "tutorial.card.next"),
        });
        await waitFor(() => expect(document.activeElement).toBe(next));
        await user.keyboard("{Enter}");
      }
    }

    // Back in the author's own, empty Library, with focus on the Books heading.
    await waitFor(() => expect(isTutorialLibraryActive()).toBe(false), CARD_TIMEOUT);
    await waitFor(() => expect(path).toBe("/"));
    const heading = await screen.findByRole("heading", { level: 1, name: en("books.title") });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(useBookStore.getState().books).toEqual([]);
    expect(useTutorialStore.getState().progress.completedAt).not.toBeNull();
    expect(useSettingsStore.getState().lastPath).toBe("/");
  }, 120_000);

  it("waits for launch Auto Sync on a signed-in device before deciding", async () => {
    useSettingsStore.setState({ autoSync: true });
    useSyncStore.setState({ authStatus: "logged-in", authVerified: false, passphrase: null });
    try {
      renderApp("/");
      await screen.findByRole("heading", { level: 1, name: en("books.title") });
      await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
      expect(screen.queryByRole("dialog", { name: en("tutorial.offer.title") })).toBeNull();

      // The launch run ends (here it cannot sync: no Passphrase) and nothing was Pulled.
      await act(async () => {
        await runAutoSync("launch");
      });
      await screen.findByRole("dialog", { name: en("tutorial.offer.title") }, CARD_TIMEOUT);
    } finally {
      useSyncStore.setState({ authStatus: "logged-out" });
    }
  }, 30_000);

  it("is not offered to an author whose Library already has writing", async () => {
    await (async () => {
      const { getAuthorDatabase } = await import("@/lib/db");
      await getAuthorDatabase();
      await createNoteRow({ title: "Mine" }, "local");
    })();
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: en("books.title") });
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(screen.queryByRole("dialog", { name: en("tutorial.offer.title") })).toBeNull();
  });

  it("Not now dismisses it for good, says where to find it, and focuses the Books heading", async () => {
    const user = userEvent.setup();
    renderApp("/");
    const offer = await screen.findByRole("dialog", { name: en("tutorial.offer.title") }, CARD_TIMEOUT);
    expect(offer).toHaveTextContent(en("tutorial.relaunchHint"));

    await user.click(within(offer).getByRole("button", { name: en("tutorial.offer.notNow") }));

    expect(useTutorialStore.getState().progress.dismissedAt).not.toBeNull();
    expect(screen.getAllByText(en("tutorial.relaunchHint")).length).toBeGreaterThan(0);
    const heading = screen.getByRole("heading", { level: 1, name: en("books.title") });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  }, 30_000);
});

describe("the first-launch offer by keyboard", () => {
  it("Escape is Not now: dismissed for good, with focus on the Books heading", async () => {
    const user = userEvent.setup();
    renderApp("/");
    const offer = await screen.findByRole("dialog", { name: en("tutorial.offer.title") }, CARD_TIMEOUT);
    await waitFor(() => expect(offer.contains(document.activeElement)).toBe(true));

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: en("tutorial.offer.title") })).toBeNull());
    expect(useTutorialStore.getState().progress.dismissedAt).not.toBeNull();
    expect(useTutorialStore.getState().status).toBe("idle");
    const heading = screen.getByRole("heading", { level: 1, name: en("books.title") });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  }, 30_000);
});

describe("running the Tutorial again", () => {
  function dismissOffer() {
    useTutorialStore.getState().dismiss(1);
  }

  it("Skip by Escape returns to the starting control in Settings, changes nothing else, and says how to come back", async () => {
    dismissOffer();
    const user = userEvent.setup();
    renderApp("/settings");
    const start = await screen.findByRole("button", { name: en("tutorial.settings.startAll") });
    start.focus();
    await user.keyboard("{Enter}");

    await findCard("books.gallery");
    await pressCardButton(user, en("tutorial.card.next"));
    await findCard("books.new-book");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(isTutorialLibraryActive()).toBe(false), CARD_TIMEOUT);
    await waitFor(() => expect(path).toBe("/settings"));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: en("tutorial.settings.startAll") })
      )
    );
    expect(screen.getAllByText(en("tutorial.relaunchHint")).length).toBeGreaterThan(0);
    const { progress } = useTutorialStore.getState();
    expect(progress.dismissedAt).toBe(1);
    expect(progress.skippedAt).toEqual({ section: "books", step: 1 });
    expect(useSettingsStore.getState().lastPath).toBe("/settings");
  }, 60_000);

  it("runs one section from Settings with the arrow keys and Enter", async () => {
    dismissOffer();
    const user = userEvent.setup();
    renderApp("/settings");
    const list = await screen.findByRole("listbox", { name: en("tutorial.settings.sectionsLabel") });
    const options = within(list).getAllByRole("option");
    expect(options[1]).toHaveTextContent(
      `${en("tutorial.sections.book-editor")} · ${en("tutorial.settings.steps", { count: 11 })}`
    );
    options[0].focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement).toBe(options[2]);
    await user.keyboard("{Enter}");

    const dialog = await findCard("cover-designer.templates");
    expect(dialog).toHaveTextContent(en("tutorial.card.progress", { current: 1, total: 3 }));
    await pressCardButton(user, en("tutorial.card.next"));
    await findCard("cover-designer.size");
    // Back stays inside a single-section run's first step.
    await pressCardButton(user, en("tutorial.card.back"));
    const first = await findCard("cover-designer.templates");
    expect(within(first).queryByRole("button", { name: en("tutorial.card.back") })).toBeNull();
    await pressCardButton(user, en("tutorial.card.next"));
    await findCard("cover-designer.size");
    await pressCardButton(user, en("tutorial.card.next"));
    await findCard("cover-designer.export");
    await pressCardButton(user, en("tutorial.card.finish"));

    await waitFor(() => expect(path).toBe("/settings"), CARD_TIMEOUT);
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-tutorial-trigger")).toBe(
        "settings-section-cover-designer"
      )
    );
    const { progress } = useTutorialStore.getState();
    expect(progress.sections["cover-designer"]?.completedAt).toEqual(expect.any(Number));
    expect(progress.completedAt).toBeNull();
  }, 60_000);

  it("runs the Dictation section from Settings by keyboard; its steps point at the Dictation settings and never start the recognizer", async () => {
    dismissOffer();
    const user = userEvent.setup();
    renderApp("/settings");
    const list = await screen.findByRole("listbox", { name: en("tutorial.settings.sectionsLabel") });
    const options = within(list).getAllByRole("option");
    const dictation = TUTORIAL_SECTIONS.find((section) => section.id === "dictation");
    if (!dictation) throw new Error("no Dictation Tutorial section");
    const index = TUTORIAL_SECTIONS.indexOf(dictation);
    expect(options[index]).toHaveTextContent(
      `${en("tutorial.sections.dictation")} · ${en("tutorial.settings.steps", { count: dictation.steps.length })}`
    );

    options[0].focus();
    for (let i = 0; i < index; i++) await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(options[index]);
    await user.keyboard("{Enter}");

    for (const [stepIndex, step] of dictation.steps.entries()) {
      const dialog = await findCard(step.id);
      // The card names its section and where the step sits inside it.
      expect(dialog).toHaveTextContent(en("tutorial.sections.dictation"));
      expect(dialog).toHaveTextContent(
        en("tutorial.card.progress", { current: stepIndex + 1, total: dictation.steps.length })
      );
      // Anchor gate: every Dictation step points at its element on this screen.
      expect(
        document.querySelector(tutorialTargetSelector(step.id)),
        `${step.id} has no target on ${path}`
      ).not.toBeNull();
      const isLast = stepIndex === dictation.steps.length - 1;
      await pressCardButton(user, en(isLast ? "tutorial.card.finish" : "tutorial.card.next"));
    }

    await waitFor(() => expect(path).toBe("/settings"), CARD_TIMEOUT);
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-tutorial-trigger")).toBe(
        "settings-section-dictation"
      )
    );
    const { progress } = useTutorialStore.getState();
    expect(progress.sections.dictation?.completedAt).toEqual(expect.any(Number));
    expect(progress.completedAt).toBeNull();

    // Nothing in the run reached for the recognizer or a model download.
    expect(dictationRuntime.start).not.toHaveBeenCalled();
    expect(dictationRuntime.load).not.toHaveBeenCalled();
    expect(dictationRuntime.install).not.toHaveBeenCalled();
    expect(dictationRuntime.remove).not.toHaveBeenCalled();

    // A second run Skips by Escape and leaves the section Done.
    await user.keyboard("{Enter}");
    await findCard("dictation.overview");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(path).toBe("/settings"), CARD_TIMEOUT);
    expect(useTutorialStore.getState().progress.sections.dictation?.completedAt).toEqual(
      expect.any(Number)
    );
  }, 60_000);

  it("Back crosses into the previous section's last step", async () => {
    dismissOffer();
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: en("books.title") });
    await user.keyboard("gu");

    const books = TUTORIAL_SECTIONS[0];
    for (const step of books.steps) {
      await findCard(step.id);
      await pressCardButton(user, en("tutorial.card.next"));
    }
    await findCard("book-editor.chapters");
    expect(path).toBe("/book/tutorial-book-novel");

    await pressCardButton(user, en("tutorial.card.back"));
    await findCard("books.remember");
    expect(path).toBe("/");
  }, 60_000);

  it("g u starts it on the web, but not while the author types in a field", async () => {
    dismissOffer();
    platform.desktop = false;
    const user = userEvent.setup();
    renderApp("/notes");
    await screen.findByRole("heading", { level: 1, name: en("notes.title") });
    expect(useBoundShortcutStore.getState().counts["global.startTutorial"]).toBeGreaterThan(0);

    screen.getByRole("textbox", { name: "Probe field" }).focus();
    await user.keyboard("gu");
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(useTutorialStore.getState().status).toBe("idle");

    (document.activeElement as HTMLElement).blur();
    await user.keyboard("gu");
    await findCard("books.gallery");
    expect(useBoundShortcutStore.getState().counts["tutorial.skip"]).toBeGreaterThan(0);
  }, 60_000);

  it("starts this screen's section from the Keyboard shortcuts help", async () => {
    dismissOffer();
    const user = userEvent.setup();
    renderApp("/ephemeral");
    await screen.findByRole("heading", { level: 1 }, CARD_TIMEOUT).catch(() => null);
    (document.activeElement as HTMLElement).blur();
    await user.keyboard("?");
    const help = await screen.findByRole("dialog", { name: en("shortcuts.title") });
    await tabTo(user, within(help).getByRole("button", { name: en("tutorial.help.startForScreen") }));
    await user.keyboard("{Enter}");

    const dialog = await findCard("ephemeral.editor");
    expect(dialog).toHaveTextContent(en("tutorial.card.progress", { current: 1, total: 2 }));

    // The button that started it lived in a dialog that is gone: focus lands
    // on this screen's heading, back on the screen the run started from.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(isTutorialLibraryActive()).toBe(false), CARD_TIMEOUT);
    await waitFor(() => expect(path).toBe("/ephemeral"));
    const heading = await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  }, 60_000);

  it("keeps every other shortcut inert and Tab inside the card while it runs", async () => {
    dismissOffer();
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: en("books.title") });
    await user.keyboard("gu");
    const dialog = await findCard("books.gallery");

    // g then s would open Settings; Ctrl+N would open New Book.
    await user.keyboard("gs");
    await user.keyboard("{Control>}n{/Control}");
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(path).toBe("/");
    expect(screen.queryByRole("dialog", { name: en("books.newBook") })).toBeNull();
    expect(useBoundShortcutStore.getState().counts["global.gotoSettings"]).toBeUndefined();

    const visited = new Set<Element | null>();
    for (let i = 0; i < 8; i++) {
      await user.tab();
      visited.add(document.activeElement);
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 4; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    expect(visited.size).toBe(2); // Skip and Next on the first step.
  }, 60_000);

  it("pauses while a Modal is open and resumes on the same step", async () => {
    dismissOffer();
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: en("books.title") });
    await user.keyboard("gu");
    await findCard("books.gallery");
    await pressCardButton(user, en("tutorial.card.next"));
    await findCard("books.new-book");

    act(() => openInterruption?.());
    const modal = await screen.findByRole("dialog", { name: "Sync Conflict" });
    await waitFor(() => expect(document.querySelector("[data-tutorial-card]")).toBeNull());
    // Escape belongs to the Modal: it closes it and leaves the Tutorial running.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(modal).not.toBeInTheDocument());

    const resumed = await findCard("books.new-book");
    await waitFor(() => expect(resumed.contains(document.activeElement)).toBe(true));
    expect(useTutorialStore.getState().status).toBe("running");
  }, 60_000);
});

describe("the Android back button", () => {
  it("Skips the Tutorial", async () => {
    useTutorialStore.getState().dismiss(1);
    const user = userEvent.setup();
    const { runTopBackDismiss } = await import("@/lib/platform/backDismiss");
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: en("books.title") });
    await user.keyboard("gu");
    await findCard("books.gallery");

    act(() => {
      expect(runTopBackDismiss()).toBe(true);
    });

    await waitFor(() => expect(isTutorialLibraryActive()).toBe(false), CARD_TIMEOUT);
    expect(useTutorialStore.getState().progress.skippedAt).toEqual({ section: "books", step: 0 });
  }, 60_000);
});
