import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

// Seam 1 (issue #189): the Tutorial module interface on real in-memory
// databases. The author's Library is a sql.js database behind the real
// getDatabase(); the Tutorial Library is the real in-memory one the switch
// creates. Nothing below mocks a write path, a store, or the switch.

const { authorDb } = vi.hoisted(() => ({ authorDb: { current: null as DatabaseAdapter | null } }));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  createDatabase: vi.fn(async () => authorDb.current),
}));

const { closeDatabase, getDatabase } = await import("@/lib/db");
const { createBookRow } = await import("@/features/books/write");
const { createNoteRow } = await import("@/features/notes/write");
const { useBookStore } = await import("@/features/books/store");
const { useNoteStore } = await import("@/features/notes/store");
const { useCanvasStore } = await import("@/features/canvas/store");
const { useChapterStore } = await import("@/features/chapters/store");
const { useVersionStore } = await import("@/features/versions/store");
const { useEphemeralStore } = await import("@/features/ephemeral/store");
const { registerPendingEditsFlush, PendingEditsFlushError } = await import(
  "@/features/sync/pending-edits"
);
const { runBetweenSyncRuns, resetSyncEngineForTests } = await import(
  "@/features/sync/sync-engine"
);
const { getBacklinksForNote } = await import("@/features/links/link-index");
const librarySwitch = await import("@/features/tutorial/library-switch");
const tutorial = await import("@/features/tutorial");
const { useTutorialStore, EMPTY_TUTORIAL_PROGRESS } = tutorial;
const i18n = (await import("@/i18n")).default;

/** Every row of every table, including the ones Backups leave out (metrics, sync state). */
async function dump(db: DatabaseAdapter): Promise<string> {
  const tables = await db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  );
  const out: Record<string, unknown[]> = {};
  for (const { name } of tables) {
    out[name] = await db.select(`SELECT * FROM "${name}" ORDER BY rowid`);
  }
  return JSON.stringify(out);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const START = { origin: "settings" as const, returnTo: "/" };

beforeEach(async () => {
  await closeDatabase();
  librarySwitch.resetLibrarySwitchForTests();
  resetSyncEngineForTests();
  authorDb.current = await createTestDatabase();
  useTutorialStore.setState({ progress: EMPTY_TUTORIAL_PROGRESS, status: "idle", run: null });
  useBookStore.setState({ books: [], currentBook: null, error: null });
  useNoteStore.setState({ notes: [], currentNote: null, error: null });
  useCanvasStore.setState({ canvases: [] });
  useEphemeralStore.setState({ content: "", wordCount: 0 });
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  if (tutorial.isTutorialLibraryActive()) await tutorial.exitTutorial("closed");
  tutorial.releaseTutorialRun();
});

describe("entering the Tutorial Library", () => {
  it("switches every read to sample content built through the write paths", async () => {
    await createBookRow({ title: "My real book", authorName: "Me" }, "local");

    expect(await tutorial.startTutorial(START)).toBe(true);

    expect(tutorial.isTutorialLibraryActive()).toBe(true);
    const db = await getDatabase();
    expect(db).not.toBe(authorDb.current);

    const books = await db.select<{ id: string; title: string; status: string; cover_data: string | null }[]>(
      "SELECT id, title, status, cover_data FROM books ORDER BY id"
    );
    expect(books.map((book) => [book.id, book.status])).toEqual([
      ["tutorial-book-archived", "archived"],
      ["tutorial-book-completed", "completed"],
      ["tutorial-book-novel", "in-progress"],
    ]);
    expect(books.some((book) => book.title === "My real book")).toBe(false);
    const cover = JSON.parse(books[2].cover_data ?? "null");
    expect(cover.layers.map((layer: { role?: string }) => layer.role)).toEqual(["title", "author"]);
    expect(cover.doc.presetId).toBe("6x9");

    const chapters = await db.select<{ id: string; chapter_type: string; content: string }[]>(
      `SELECT id, chapter_type, content FROM chapters WHERE book_id = 'tutorial-book-novel' ORDER BY "order"`
    );
    expect(chapters.map((chapter) => chapter.chapter_type)).toEqual([
      "prologue",
      "part",
      "chapter",
      "chapter",
    ]);
    const chapterOne = chapters[2].content;
    expect(chapterOne).toMatch(/<h2[^>]*>Morning<\/h2>/);
    expect(chapterOne).toContain("data-scene-break");
    expect(chapterOne).toContain("data-footnote");

    const versions = await db.select<{ trigger_type: string; name: string | null }[]>(
      "SELECT trigger_type, name FROM book_versions ORDER BY created_at, trigger_type"
    );
    expect(versions).toEqual(
      expect.arrayContaining([
        { trigger_type: "auto-idle", name: null },
        { trigger_type: "manual", name: "First full draft" },
      ])
    );

    const notes = await db.select<{ id: string; book_id: string | null; pinned: number; tags: string; content: string }[]>(
      "SELECT id, book_id, pinned, tags, content FROM notes ORDER BY \"order\""
    );
    expect(notes.map((note) => [note.id, note.book_id, note.pinned])).toEqual([
      ["tutorial-note-characters", "tutorial-book-novel", 1],
      ["tutorial-note-research", "tutorial-book-novel", 0],
      ["tutorial-note-ideas", null, 0],
      ["tutorial-note-checklist", null, 0],
    ]);
    expect(JSON.parse(notes[0].tags)).toEqual(["characters"]);
    expect(notes[1].content).toContain('data-type="taskList"');
    expect(await getBacklinksForNote("tutorial-note-research")).toEqual([
      { sourceId: "tutorial-note-ideas", title: "Ideas for the ending" },
    ]);

    const [canvas] = await db.select<{ id: string; doc: string }[]>("SELECT id, doc FROM canvases");
    const doc = JSON.parse(canvas.doc);
    expect(canvas.id).toBe("tutorial-canvas-plot");
    expect(doc.nodes.map((node: { kind: string }) => node.kind).sort()).toEqual([
      "noteRef",
      "text",
      "text",
    ]);
    expect(doc.edges).toHaveLength(1);
    expect(doc.strokes).toHaveLength(1);

    const sessions = await db.select<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM metrics_events WHERE event_type = 'session.ended'"
    );
    expect(sessions[0].n).toBe(3);

    // Every sample row carries the prefix the write paths refuse outside the Tutorial.
    for (const table of ["books", "chapters", "notes", "canvases"]) {
      const leaks = await db.select<{ id: string }[]>(
        `SELECT id FROM ${table} WHERE id NOT LIKE 'tutorial-%'`
      );
      expect(leaks, table).toEqual([]);
    }
  });

  it("reloads every view that caches Library rows", async () => {
    await createBookRow({ title: "My real book", authorName: "Me" }, "local");
    await useBookStore.getState().refreshBooks();
    useChapterStore.setState({ currentBookId: "real", chapters: [] });
    useVersionStore.setState({ currentBookId: "real", totalCount: 9 });

    await tutorial.startTutorial(START);

    expect(tutorial.LIBRARY_VIEWS.map((view) => view.name)).toEqual([
      "books",
      "chapters",
      "notes",
      "canvases",
      "versions",
    ]);
    expect(useBookStore.getState().books.map((book) => book.id)).toContain("tutorial-book-novel");
    expect(useBookStore.getState().books.some((book) => book.title === "My real book")).toBe(false);
    expect(useNoteStore.getState().notes).toHaveLength(4);
    expect(useCanvasStore.getState().canvases.map((canvas) => canvas.id)).toEqual([
      "tutorial-canvas-plot",
    ]);
    expect(useChapterStore.getState().currentBookId).toBeNull();
    expect(useVersionStore.getState()).toMatchObject({ currentBookId: null, totalCount: 0 });
  });

  it("builds the sample content in Spanish when the app speaks Spanish", async () => {
    await i18n.changeLanguage("es");
    await tutorial.startTutorial(START);

    const db = await getDatabase();
    const [novel] = await db.select<{ title: string; language: string }[]>(
      "SELECT title, language FROM books WHERE id = 'tutorial-book-novel'"
    );
    expect(novel).toEqual({ title: "El guardián del faro", language: "es" });
    const [named] = await db.select<{ name: string }[]>(
      "SELECT name FROM book_versions WHERE trigger_type = 'manual'"
    );
    expect(named.name).toBe("Primer borrador completo");
    const [note] = await db.select<{ tags: string }[]>(
      "SELECT tags FROM notes WHERE id = 'tutorial-note-research'"
    );
    expect(JSON.parse(note.tags)).toEqual(["investigación"]);
  });

  it("stops with nothing switched when an open editor cannot save", async () => {
    await createBookRow({ title: "My real book", authorName: "Me" }, "local");
    const before = await dump(authorDb.current!);
    const unregister = registerPendingEditsFlush(async () => {
      throw new Error("disk full");
    });

    await expect(tutorial.startTutorial(START)).rejects.toBeInstanceOf(PendingEditsFlushError);

    unregister();
    expect(tutorial.isTutorialLibraryActive()).toBe(false);
    expect(tutorial.isTutorialRunInProgress()).toBe(false);
    expect(useTutorialStore.getState()).toMatchObject({ status: "idle", run: null });
    expect(await getDatabase()).toBe(authorDb.current);
    expect(await dump(authorDb.current!)).toBe(before);
  });

  it("switches back to the author's Library when a view fails to reload after the switch", async () => {
    await createBookRow({ title: "My real book", authorName: "Me" }, "local");
    useEphemeralStore.setState({ content: "<p>my scratch</p>", wordCount: 2 });
    const before = await dump(authorDb.current!);
    const refreshNotes = vi
      .spyOn(useNoteStore.getState(), "refreshNotes")
      .mockRejectedValueOnce(new Error("read failed"));

    await expect(tutorial.startTutorial(START)).rejects.toThrow("read failed");

    refreshNotes.mockRestore();
    expect(tutorial.isTutorialLibraryActive()).toBe(false);
    expect(tutorial.isTutorialRunInProgress()).toBe(false);
    expect(useTutorialStore.getState()).toMatchObject({ status: "idle", run: null });
    expect(await getDatabase()).toBe(authorDb.current);
    expect(useEphemeralStore.getState()).toMatchObject({
      content: "<p>my scratch</p>",
      wordCount: 2,
    });
    expect(useBookStore.getState().books.map((book) => book.title)).toEqual(["My real book"]);
    expect(await dump(authorDb.current!)).toBe(before);
  });

  it("lands pending edits in the author's Library before switching", async () => {
    const note = await createNoteRow({ title: "Draft" }, "local");
    const unregister = registerPendingEditsFlush(async () => {
      const { updateNoteRow } = await import("@/features/notes/write");
      await updateNoteRow({ id: note.id, content: "<p>typed just now</p>" }, "local");
    });

    await tutorial.startTutorial(START);
    unregister();

    const [row] = await authorDb.current!.select<{ content: string }[]>(
      "SELECT content FROM notes WHERE id = ?",
      [note.id]
    );
    expect(row.content).toBe("<p>typed just now</p>");
    const sampleNotes = await (await getDatabase()).select<{ id: string }[]>(
      "SELECT id FROM notes WHERE id = ?",
      [note.id]
    );
    expect(sampleNotes).toEqual([]);
  });

  it("waits for a running sync to finish before switching", async () => {
    const sync = deferred();
    const running = runBetweenSyncRuns(() => sync.promise);

    const entering = tutorial.startTutorial(START);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(tutorial.isTutorialLibraryActive()).toBe(false);

    sync.resolve();
    await running;
    await entering;
    expect(tutorial.isTutorialLibraryActive()).toBe(true);
  });

  it("waits for an editor's close work on the author's Library before switching", async () => {
    const closing = deferred();
    let activeWhenClosed: boolean | null = null;
    void librarySwitch.trackAuthorLibraryWork(
      closing.promise.then(() => {
        activeWhenClosed = librarySwitch.isTutorialLibraryActive();
      })
    );

    const entering = tutorial.startTutorial(START);
    await new Promise((resolve) => setTimeout(resolve, 20));
    closing.resolve();
    await entering;

    expect(activeWhenClosed).toBe(false);
  });

  it("does not start a second run while one is under way", async () => {
    await tutorial.startTutorial(START);
    expect(await tutorial.startTutorial(START)).toBe(false);
  });
});

describe("leaving the Tutorial Library", () => {
  it("leaves the author's Library exactly as it was", async () => {
    await createBookRow({ title: "My real book", authorName: "Me" }, "local");
    await createNoteRow({ title: "My real note", tags: ["mine"] }, "local");
    const before = await dump(authorDb.current!);

    await tutorial.startTutorial(START);
    // Work done inside the Tutorial lands in the Tutorial Library only.
    await createBookRow({ title: "Made during the Tutorial", authorName: "Me" }, "local");
    const returnTo = await tutorial.exitTutorial("finished");
    tutorial.releaseTutorialRun();

    expect(returnTo).toBe("/");
    expect(tutorial.isTutorialLibraryActive()).toBe(false);
    expect(await getDatabase()).toBe(authorDb.current);
    expect(await dump(authorDb.current!)).toBe(before);
    expect(useBookStore.getState().books.map((book) => book.title)).toEqual(["My real book"]);
    expect(useNoteStore.getState().notes.map((note) => note.title)).toEqual(["My real note"]);
    expect(useCanvasStore.getState().canvases).toEqual([]);
  });

  it("shows the sample Ephemeral text with its word count", async () => {
    await tutorial.startTutorial(START);
    const sample = i18n.t("tutorial.sample.ephemeral");
    expect(useEphemeralStore.getState().wordCount).toBe(sample.trim().split(/\s+/).length);
  });

  it("gives the author's Ephemeral text back", async () => {
    useEphemeralStore.setState({ content: "<p>my scratch</p>", wordCount: 2 });

    await tutorial.startTutorial(START);
    expect(useEphemeralStore.getState().content).toContain("never saved");
    await tutorial.exitTutorial("skipped");

    expect(useEphemeralStore.getState()).toMatchObject({
      content: "<p>my scratch</p>",
      wordCount: 2,
    });
  });
});

describe("Tutorial state on this device", () => {
  it("records per-section completion and a finished full run", async () => {
    await tutorial.startTutorial(START);
    let moves = 0;
    while (tutorial.goToNextStep() === "moved") moves += 1;
    expect(moves).toBe(tutorial.totalStepCount() - 1);
    await tutorial.exitTutorial("finished");

    const { progress } = useTutorialStore.getState();
    expect(progress.completedAt).not.toBeNull();
    expect(Object.keys(progress.sections).sort()).toEqual([...tutorial.TUTORIAL_SECTION_IDS].sort());
    expect(progress).toMatchObject({ dismissedAt: null, lastSection: null, lastStep: null });
  });

  it("runs a single section and completes only that one", async () => {
    await tutorial.startTutorial({ ...START, section: "canvas" });
    expect(useTutorialStore.getState().run?.position).toEqual({ section: "canvas", step: 0 });
    while (tutorial.goToNextStep() === "moved");
    await tutorial.exitTutorial("finished");

    const { progress } = useTutorialStore.getState();
    expect(Object.keys(progress.sections)).toEqual(["canvas"]);
    expect(progress.completedAt).toBeNull();
  });

  it("moves Back across a section boundary to the previous section's last step", async () => {
    await tutorial.startTutorial(START);
    const books = tutorial.getSection("books");
    for (let i = 0; i < books.steps.length; i++) tutorial.goToNextStep();
    expect(useTutorialStore.getState().run?.position).toEqual({ section: "book-editor", step: 0 });

    tutorial.goToPreviousStep();
    expect(useTutorialStore.getState().run?.position).toEqual({
      section: "books",
      step: books.steps.length - 1,
    });
  });

  it("treats Skip of the offered run as a dismiss and records where it happened", async () => {
    await tutorial.startTutorial({ ...START, origin: "offer" });
    tutorial.goToNextStep();
    await tutorial.exitTutorial("skipped");

    const { progress } = useTutorialStore.getState();
    expect(progress.dismissedAt).not.toBeNull();
    expect(progress.skippedAt).toEqual({ section: "books", step: 1 });
    expect(tutorial.decideTutorialOffer(true)).toBeNull();
  });

  it("never changes the dismissed state from a relaunched run", async () => {
    await tutorial.startTutorial({ ...START, origin: "shortcut" });
    await tutorial.exitTutorial("skipped");
    expect(useTutorialStore.getState().progress.dismissedAt).toBeNull();

    useTutorialStore.getState().dismiss(1234);
    await tutorial.startTutorial({ ...START, origin: "settings" });
    await tutorial.exitTutorial("finished");
    expect(useTutorialStore.getState().progress.dismissedAt).toBe(1234);
  });

  it("keeps an unfinished run for the next launch and offers to continue it", async () => {
    await tutorial.startTutorial({ ...START, origin: "offer" });
    const books = tutorial.getSection("books");
    for (let i = 0; i < books.steps.length + 2; i++) tutorial.goToNextStep();
    // The app closes: the persisted state is all that survives.
    const persisted = useTutorialStore.getState().progress;
    await tutorial.exitTutorial("closed");
    useTutorialStore.setState({ progress: persisted, status: "idle", run: null });

    expect(tutorial.decideTutorialOffer(false)).toEqual({
      kind: "continue",
      position: { section: "book-editor", step: 0 },
    });
  });

  it("offers nothing on the next launch after a single-section run is left open", async () => {
    await tutorial.startTutorial({ ...START, section: "notes" });
    tutorial.goToNextStep();
    const persisted = useTutorialStore.getState().progress;
    await tutorial.exitTutorial("closed");
    useTutorialStore.setState({ progress: persisted, status: "idle", run: null });

    expect(persisted.lastSection).toBeNull();
    expect(tutorial.decideTutorialOffer(false)).toBeNull();
  });

  it("forgets everything on reset", () => {
    useTutorialStore.getState().dismiss();
    useTutorialStore.getState().resetProgress();
    expect(useTutorialStore.getState().progress).toEqual(EMPTY_TUTORIAL_PROGRESS);
  });
});

describe("the first-launch offer", () => {
  it("is offered to a new author with an empty Library and no Tutorial state", async () => {
    expect(await tutorial.authorLibraryIsEmpty()).toBe(true);
    expect(tutorial.decideTutorialOffer(true)).toEqual({ kind: "start" });
  });

  it("is not offered to an upgrader whose Library already has writing", async () => {
    await createNoteRow({ title: "Old note" }, "local");
    expect(await tutorial.authorLibraryIsEmpty()).toBe(false);
    expect(tutorial.decideTutorialOffer(false)).toBeNull();
  });

  it("is not offered on a second device once its Library has been Pulled", async () => {
    // A Pull writes through the same paths as a local write.
    const { applyBookSnapshotData } = await import("@/features/books/write");
    const now = Math.floor(Date.now() / 1000);
    await applyBookSnapshotData(
      {
        book: {
          id: "pulled-book",
          title: "From my laptop",
          subtitle: null,
          authorName: "Me",
          description: null,
          genre: null,
          language: "en",
          coverImagePath: null,
          coverData: null,
          wordCount: 0,
          targetWordCount: null,
          status: "draft",
          createdAt: now,
          updatedAt: now,
          lastOpenedAt: null,
          lastChapterId: null,
        },
        chapters: [],
      },
      "remote"
    );
    expect(await tutorial.authorLibraryIsEmpty()).toBe(false);
  });

  it("reads the author's Library even while the Tutorial Library is active", async () => {
    await tutorial.startTutorial(START);
    expect(await tutorial.authorLibraryIsEmpty()).toBe(true);
  });

  it("is not offered again after Not now", () => {
    useTutorialStore.getState().dismiss();
    expect(tutorial.decideTutorialOffer(true)).toBeNull();
  });

  it("is not offered once the Tutorial was finished or a section was run", () => {
    useTutorialStore.getState().markSectionCompleted("canvas");
    expect(tutorial.decideTutorialOffer(true)).toBeNull();
  });
});
