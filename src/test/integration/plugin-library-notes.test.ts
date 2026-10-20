import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Change } from "@/features/sync/change-feed";
import type { SyncAction, SyncDeletionReviewItem } from "@/features/sync/types";
import type { PluginApiInput } from "@/features/plugins/types";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { connectLibraryWritePlugin } from "@/test/support/plugin-broker";

// Data-safety integration tests for the Plugin Note writes (#588, part 4),
// driven through the real handler entry a Plugin calls, over the in-memory
// Library. Each write is a local write from outside the open view's store
// (ADR 0026): it Flushes the open editors first, refuses when a save fails,
// emits on the Change Feed, and the open view refreshes on the local Change
// (#430). Setup mirrors `plugin-library-chapters.test.ts`, the prior art for
// the Chapter writes of the same issue.
//
// The Deletion Review block holds the promise for Notes, which ARE Synced
// Items: a Note a Plugin deletes leaves exactly the state an author delete
// leaves, tombstone row and Change included, so sync and Deletion Review carry
// it the way they carry the author's own delete.

let testDb: DatabaseAdapter;

const { mockGetDatabase, mockReindex } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
  mockReindex: vi.fn(),
}));

vi.mock("../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../features/links/link-index", () => ({
  reindexSource: mockReindex,
}));

const { createPluginHandlers } = await import("@/features/plugins/handlers");
const { PLUGIN_MANIFEST } = await import("@/test/support/plugin-fixtures");
const { useNoteStore } = await import("@/features/notes/store");
const { installViewRefresh, resetViewRefreshForTests } = await import(
  "@/features/sync/view-refresh"
);
const { registerPendingEditsFlush, resetPendingEditsForTests } = await import(
  "@/features/sync/pending-edits"
);
const { isEntityChange, onChange, resetChangeFeedForTests } = await import(
  "@/features/sync/change-feed"
);
const { listPendingTombstones } = await import("@/features/sync/tombstones");
const { processPendingDeletions } = await import("@/features/sync/entity-sync");
const librarySwitch = await import("@/features/tutorial/library-switch");

const handlers = createPluginHandlers(PLUGIN_MANIFEST);
const context = { pluginId: "tracer" };

function updateNote(input: PluginApiInput<"library.notes.update">) {
  const write = handlers["library.notes.update"];
  if (!write) throw new Error("library.notes.update is not wired");
  return write(input, context);
}

function deleteNote(noteId: string) {
  const write = handlers["library.notes.delete"];
  if (!write) throw new Error("library.notes.delete is not wired");
  return write({ noteId }, context);
}

function readNote(noteId: string) {
  const read = handlers["library.notes.get"];
  if (!read) throw new Error("library.notes.get is not wired");
  return read({ noteId }, context);
}

function readNotes(bookId?: string) {
  const read = handlers["library.notes.list"];
  if (!read) throw new Error("library.notes.list is not wired");
  return read(bookId === undefined ? {} : { bookId }, context);
}

async function seedBook(id: string): Promise<void> {
  await testDb.execute(
    `INSERT INTO books (id, title, author_name, language, created_at, updated_at, content_updated_at)
     VALUES (?, ?, 'Author', 'en', 1000, 1000, 1000)`,
    [id, `Book ${id}`]
  );
}

async function seedNote(
  id: string,
  bookId: string | null = null,
  fields: { tags?: string[]; content?: string } = {}
): Promise<void> {
  await testDb.execute(
    `INSERT INTO notes (id, book_id, title, content, language, tags, pinned, "order", word_count, collapsed_headings, created_at, updated_at, content_updated_at)
     VALUES (?, ?, ?, ?, 'en', ?, 0, 0, 1, '[]', 1000, 1000, 1000)`,
    [id, bookId, `Note ${id}`, fields.content ?? "<p>Stored</p>", JSON.stringify(fields.tags ?? [])]
  );
}

interface NoteRow {
  book_id: string | null;
  title: string;
  content: string | null;
  tags: string;
}

async function noteRow(id: string): Promise<NoteRow | null> {
  const rows = await testDb.select<NoteRow[]>(
    "SELECT book_id, title, content, tags FROM notes WHERE id = ?",
    [id]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function noteIds(bookId?: string): Promise<string[]> {
  const rows = await testDb.select<{ id: string }[]>(
    bookId === undefined
      ? 'SELECT id FROM notes ORDER BY pinned DESC, "order" ASC, updated_at DESC'
      : 'SELECT id FROM notes WHERE book_id = ? ORDER BY pinned DESC, "order" ASC, updated_at DESC',
    bookId === undefined ? [] : [bookId]
  );
  return rows.map((row) => row.id);
}

beforeEach(async () => {
  testDb = await createTestDatabase();
  // Read through the variable on every call, so the Deletion Review test can
  // put each delete path in front of its own identically seeded Library.
  mockGetDatabase.mockReset().mockImplementation(() => Promise.resolve(testDb));
  mockReindex.mockReset().mockResolvedValue(undefined);
  resetChangeFeedForTests();
  resetViewRefreshForTests();
  resetPendingEditsForTests();
  installViewRefresh();
  useNoteStore.setState({ notes: [], currentNote: null, isLoading: false, error: null });
});

afterEach(() => {
  resetViewRefreshForTests();
  resetChangeFeedForTests();
  resetPendingEditsForTests();
  librarySwitch.resetLibrarySwitchForTests();
});

describe("library.notes.update (#588)", () => {
  it("sets a Note's Tags the way the Note UI stores them, readable back through the Library", async () => {
    await seedBook("book-1");
    await seedNote("note-1", "book-1");

    await expect(
      updateNote({ noteId: "note-1", tags: ["  pacing ", "Pacing", "", "voice", "pacing"] })
    ).resolves.toBeNull();

    // Trimmed, empty dropped, duplicates dropped in the order they were given:
    // the Tag Editor's own rule. Case is kept, as the author typed it.
    expect(await noteRow("note-1")).toMatchObject({
      title: "Note note-1",
      content: "<p>Stored</p>",
      tags: JSON.stringify(["pacing", "Pacing", "voice"]),
    });
    expect(await readNote("note-1")).toMatchObject({ id: "note-1", tags: ["pacing", "Pacing", "voice"] });
    expect(await readNotes("book-1")).toEqual([
      expect.objectContaining({ id: "note-1", tags: ["pacing", "Pacing", "voice"] }),
    ]);
  });

  it("moves a Note to another Book, and to Unfiled with null", async () => {
    await seedBook("book-1");
    await seedBook("book-2");
    await seedNote("note-1", "book-1");

    await updateNote({ noteId: "note-1", bookId: "book-2" });
    expect((await noteRow("note-1"))?.book_id).toBe("book-2");
    expect(await readNote("note-1")).toMatchObject({ id: "note-1", bookId: "book-2" });
    expect(await noteIds("book-1")).toEqual([]);
    expect(await readNotes("book-2")).toEqual([expect.objectContaining({ id: "note-1" })]);

    // null is Unfiled: no Book association at all.
    await updateNote({ noteId: "note-1", bookId: null });
    expect((await noteRow("note-1"))?.book_id).toBeNull();
    expect(await readNote("note-1")).toMatchObject({ id: "note-1", bookId: null });
    expect(await noteIds("book-2")).toEqual([]);
  });

  it("keeps updating a Note's title and content as before, tags preserved", async () => {
    await seedNote("note-1", null, { tags: ["voice"] });

    await updateNote({
      noteId: "note-1",
      title: "Renamed",
      content: { text: "First line\n\nSecond line" },
    });

    const row = await noteRow("note-1");
    expect(row).toMatchObject({ title: "Renamed", tags: JSON.stringify(["voice"]) });
    expect(row?.content).toContain("<p>First line</p>");
    expect(await readNote("note-1")).toMatchObject({
      title: "Renamed",
      content: { text: "First line\n\nSecond line" },
    });
  });

  it("refuses a bookId that names no Book and writes nothing", async () => {
    await seedBook("book-1");
    await seedNote("note-1", "book-1");

    await expect(updateNote({ noteId: "note-1", bookId: "absent" })).rejects.toMatchObject({
      name: "PluginApiError",
      code: "invalid-params",
      message: "Book absent does not exist",
    });
    expect((await noteRow("note-1"))?.book_id).toBe("book-1");
  });

  it("refuses an unknown Note", async () => {
    await expect(updateNote({ noteId: "absent", tags: ["voice"] })).rejects.toMatchObject({
      name: "PluginApiError",
      code: "invalid-params",
      message: "Note absent does not exist",
    });
  });
});

describe("library.notes.delete (#588)", () => {
  it("deletes a Note through the normal Delete path", async () => {
    await seedNote("note-1");
    await seedNote("note-2");

    await expect(deleteNote("note-1")).resolves.toBeNull();

    expect(await noteRow("note-1")).toBeNull();
    expect(await readNotes()).toEqual([expect.objectContaining({ id: "note-2" })]);
    expect(await readNote("note-1")).toBeNull();
  });

  it("refuses an unknown Note", async () => {
    await expect(deleteNote("absent")).rejects.toMatchObject({
      name: "PluginApiError",
      code: "invalid-params",
      message: "Note absent does not exist",
    });
  });
});

// A local write from outside the open view flushes the editors first. When an
// open editor cannot save, the write is refused before anything lands.
describe("Note writes refuse when an open editor cannot save (#588)", () => {
  type LibraryClient = ReturnType<typeof connectLibraryWritePlugin>["client"];
  const cases: [string, (client: LibraryClient) => Promise<unknown>][] = [
    [
      "library.notes.update tags",
      (client) => client.library.notes.update({ noteId: "note-1", tags: ["voice", "voice"] }),
    ],
    [
      "library.notes.update bookId",
      (client) => client.library.notes.update({ noteId: "note-1", bookId: "book-2" }),
    ],
    ["library.notes.delete", (client) => client.library.notes.delete({ noteId: "note-1" })],
  ];

  it.each(cases)("%s refuses and writes nothing", async (_method, call) => {
    await seedBook("book-2");
    await seedNote("note-1");
    // `flushPendingEdits` wraps this rejection in `PendingEditsFlushError`.
    const off = registerPendingEditsFlush(() => {
      throw new Error("disk full");
    });
    const { client, close } = connectLibraryWritePlugin({ granted: ["library:write"] });
    try {
      await expect(call(client)).rejects.toMatchObject({ code: "library-unavailable" });
    } finally {
      close();
      off();
    }
    expect(await noteIds()).toEqual(["note-1"]);
    expect(await noteRow("note-1")).toMatchObject({
      book_id: null,
      title: "Note note-1",
      tags: "[]",
    });
  });
});

// Every new write is refused by the broker before its handler runs: without
// `library:write`, and while the Tutorial makes the Library unavailable. The
// prior art for the same issue proves the Book and Chapter writes this way.
describe("Note writes refuse without the Permission or the Library (#588)", () => {
  const calls = (client: ReturnType<typeof connectLibraryWritePlugin>["client"]) => [
    () => client.library.notes.update({ noteId: "note-1", tags: ["voice"] }),
    () => client.library.notes.update({ noteId: "note-1", bookId: null }),
    () => client.library.notes.delete({ noteId: "note-1" }),
  ];

  it("refuses every Note write without library:write", async () => {
    await seedNote("note-1");

    const { client, close } = connectLibraryWritePlugin({ granted: ["library:read"] });
    try {
      for (const call of calls(client)) {
        await expect(call()).rejects.toMatchObject({
          code: "permission-denied",
          permission: "library:write",
        });
      }
    } finally {
      close();
    }
    expect(await noteIds()).toEqual(["note-1"]);
  });

  it("refuses every Note write with the real Tutorial Library switch", async () => {
    await seedNote("note-1");
    librarySwitch.activateTutorialDatabase(testDb);

    const { client, close } = connectLibraryWritePlugin({
      granted: ["library:write"],
      isLibraryAvailable: () => !librarySwitch.isTutorialLibraryActive(),
    });
    try {
      for (const call of calls(client)) {
        await expect(call()).rejects.toMatchObject({ code: "library-unavailable" });
      }
    } finally {
      close();
    }
    // Nothing was tagged, filed, or deleted.
    expect(await noteIds()).toEqual(["note-1"]);
    expect(await noteRow("note-1")).toMatchObject({
      book_id: null,
      title: "Note note-1",
      tags: "[]",
    });
  });
});

// Deletion Review: a Note IS a Synced Item, so a Plugin delete must leave the
// same tombstone row and the same Change the author's delete leaves, and sync
// must queue and push it exactly the same way.
describe("a Plugin Note delete is the author's Delete path (#588)", () => {
  interface TombstoneRow {
    id: string;
    entity_type: string;
    entity_id: string;
    title: string;
    deleted_at: number;
    confirmed_at: number | null;
    pushed_at: number | null;
  }

  interface DeleteObservation {
    /** Whether the Note row is still there. */
    noteExists: boolean;
    /** The tombstone rows Deletion Review reads, as stored. */
    tombstones: TombstoneRow[];
    /** The Change the delete emitted. */
    changes: Change[];
    /** What Deletion Review queues before the author confirms. */
    held: SyncDeletionReviewItem[];
    /** What a confirmed review pushes to the server. */
    pushed: SyncAction[];
    remoteDeletes: string[];
    /** Tombstones still pending after the confirmed push. */
    pendingAfter: number;
  }

  /** Seeds one Book with one Note, runs the delete, and reads what sync sees. */
  async function observeDelete(remove: () => unknown): Promise<DeleteObservation> {
    testDb = await createTestDatabase();
    await seedBook("book-1");
    await seedNote("note-1", "book-1", { tags: ["voice"] });

    resetChangeFeedForTests();
    const changes: Change[] = [];
    const offFeed = onChange((signal) => {
      if (isEntityChange(signal)) changes.push(signal);
    });
    try {
      await remove();
    } finally {
      offFeed();
    }

    const tombstones = await testDb.select<TombstoneRow[]>(
      "SELECT id, entity_type, entity_id, title, deleted_at, confirmed_at, pushed_at FROM sync_tombstones ORDER BY id ASC"
    );

    // The Deletion Review path over this Library: first the pending list, then
    // the push a confirmed review makes. Both go through the real dispatcher.
    const remoteDeletes: string[] = [];
    const registry = {
      note: {
        deleteRemote: async (entityId: string) => {
          remoteDeletes.push(entityId);
        },
      },
    };
    const options = { scope: "all" as const, direction: "bidirectional" as const };
    const held = await processPendingDeletions(registry, ["note"], options, () => {});
    const pushed = await processPendingDeletions(
      registry,
      ["note"],
      { ...options, confirmedDeletionIds: ["note:note-1"] },
      () => {}
    );

    return {
      noteExists: (await noteRow("note-1")) !== null,
      tombstones,
      changes,
      held: held.pendingDeletions,
      pushed: pushed.actions,
      remoteDeletes,
      pendingAfter: (await listPendingTombstones(["note"])).length,
    };
  }

  it("leaves exactly the state the author delete leaves, as Deletion Review reads it", async () => {
    const viaPlugin = await observeDelete(() => deleteNote("note-1"));
    const viaAuthor = await observeDelete(() => useNoteStore.getState().deleteNote("note-1"));

    // The Note is gone on both paths.
    expect(viaPlugin.noteExists).toBe(false);
    expect(viaAuthor.noteExists).toBe(false);

    // One tombstone row, field for field the same; only the deletion clock
    // differs, because the two deletes ran at different moments.
    expect(viaPlugin.tombstones).toHaveLength(1);
    expect(viaAuthor.tombstones).toHaveLength(1);
    const [pluginTombstone] = viaPlugin.tombstones;
    const [authorTombstone] = viaAuthor.tombstones;
    expect(pluginTombstone).toMatchObject({
      id: authorTombstone.id,
      entity_type: authorTombstone.entity_type,
      entity_id: authorTombstone.entity_id,
      title: authorTombstone.title,
      confirmed_at: authorTombstone.confirmed_at,
      pushed_at: authorTombstone.pushed_at,
    });
    expect(pluginTombstone).toMatchObject({
      id: "note:note-1",
      entity_type: "note",
      entity_id: "note-1",
      title: "Note note-1",
      confirmed_at: null,
      pushed_at: null,
    });
    expect(pluginTombstone.deleted_at).toBeGreaterThan(0);

    // Sync and Auto Sync react to the same local Change either way.
    expect(viaPlugin.changes).toEqual([
      { entity: "note", id: "note-1", origin: "local", kind: "content" },
    ]);
    expect(viaPlugin.changes).toEqual(viaAuthor.changes);

    // Deletion Review queues the same item before the author confirms, and the
    // confirmed review pushes the same deletion to the server.
    expect(viaPlugin.held).toHaveLength(1);
    expect(viaAuthor.held).toHaveLength(1);
    expect(viaPlugin.held[0]).toMatchObject({
      id: "note:note-1",
      entityType: viaAuthor.held[0].entityType,
      entityId: viaAuthor.held[0].entityId,
      title: viaAuthor.held[0].title,
    });
    expect(viaPlugin.pushed).toEqual(viaAuthor.pushed);
    expect(viaPlugin.pushed).toEqual(["pushed"]);
    expect(viaPlugin.remoteDeletes).toEqual(["note-1"]);
    expect(viaPlugin.remoteDeletes).toEqual(viaAuthor.remoteDeletes);
    expect(viaPlugin.pendingAfter).toBe(0);
    expect(viaAuthor.pendingAfter).toBe(0);
  });

  it("emits on the Change Feed before the call returns and refreshes the open view", async () => {
    await seedNote("note-1");
    await seedNote("note-2");
    await useNoteStore.getState().loadNotes();
    await useNoteStore.getState().loadNote("note-1");

    await deleteNote("note-1");

    // The open view already dropped the Note the Plugin deleted.
    expect(useNoteStore.getState().notes.map((note) => note.id)).toEqual(["note-2"]);
    expect(useNoteStore.getState().currentNote).toBeNull();
  });
});
