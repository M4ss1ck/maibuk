import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest, PluginPermissionId } from "@/features/plugins/types";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { connectPluginBroker } from "@/test/support/plugin-broker";

// The demo Plugin of #588, part 5: one fixture Plugin source under
// src/test/support/plugins/, run once through the real broker over the
// in-memory Library, the way the other fixture Plugins are driven. The run
// creates a Chapter, reorders it to the front, sets its title, Chapter Type,
// and Chapter Status, takes a Checkpoint with the "plugin" Version Trigger, and
// deletes a Note. Every step then has to show in the Library itself: the
// Chapter at the moved position with its metadata, one Version with the
// trigger and label, and the Note gone.
//
// jsdom has no Worker, so the sandbox cannot run here; the fixture's own code
// is handed the same SDK client over the real broker the other #588 suites use
// (see the CONCERNS line in the unit report).

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

const { useNoteStore } = await import("@/features/notes/store");
const { useVersionStore } = await import("@/features/versions/store");
const { installViewRefresh, resetViewRefreshForTests } = await import(
  "@/features/sync/view-refresh"
);
const { resetPendingEditsForTests } = await import("@/features/sync/pending-edits");
const { resetChangeFeedForTests } = await import("@/features/sync/change-feed");

const { runLibraryDemo } = await import("@/test/support/plugins/fixture-library-demo");
const demoManifestJson = (await import("@/test/support/plugins/fixture-library-demo/manifest.json"))
  .default;

/** The manifest the demo fixture ships, parsed with the real validator. */
function demoManifest(): PluginManifest {
  const result = parsePluginManifest(JSON.stringify(demoManifestJson));
  if (!result.ok) throw new Error(`manifest.json: ${JSON.stringify(result.problems, null, 2)}`);
  return result.manifest;
}

const DEMO_MANIFEST = demoManifest();

async function seedBook(id: string): Promise<void> {
  await testDb.execute(
    `INSERT INTO books (id, title, author_name, language, created_at, updated_at, content_updated_at)
     VALUES (?, ?, 'Author', 'en', 1000, 1000, 1000)`,
    [id, `Book ${id}`]
  );
}

async function seedChapter(id: string, bookId: string, order: number): Promise<void> {
  await testDb.execute(
    `INSERT INTO chapters (id, book_id, title, content, "order", chapter_type, word_count, status, is_included_in_export, created_at, updated_at)
     VALUES (?, ?, ?, '<p>Stored</p>', ?, 'chapter', 1, 'draft', 1, 1000, 1000)`,
    [id, bookId, `Title ${id}`, order]
  );
}

async function seedNote(id: string): Promise<void> {
  await testDb.execute(
    `INSERT INTO notes (id, title, content, language, tags, pinned, "order", word_count, collapsed_headings, created_at, updated_at)
     VALUES (?, ?, '<p>Stored</p>', 'en', '[]', 0, 0, 1, '[]', 1000, 1000)`,
    [id, `Note ${id}`]
  );
}

interface ChapterRow {
  title: string;
  order: number;
  chapter_type: string;
  status: string;
}

async function chapterRow(id: string): Promise<ChapterRow | null> {
  const rows = await testDb.select<ChapterRow[]>(
    'SELECT title, "order", chapter_type, status FROM chapters WHERE id = ?',
    [id]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function chapterIds(bookId: string): Promise<string[]> {
  const rows = await testDb.select<{ id: string }[]>(
    'SELECT id FROM chapters WHERE book_id = ? ORDER BY "order" ASC',
    [bookId]
  );
  return rows.map((row) => row.id);
}

interface VersionRow {
  id: string;
  name: string | null;
  trigger_type: string;
}

async function versionRows(bookId: string): Promise<VersionRow[]> {
  return testDb.select<VersionRow[]>(
    "SELECT id, name, trigger_type FROM book_versions WHERE book_id = ? ORDER BY created_at ASC, id ASC",
    [bookId]
  );
}

async function noteIds(): Promise<string[]> {
  const rows = await testDb.select<{ id: string }[]>("SELECT id FROM notes ORDER BY id ASC");
  return rows.map((row) => row.id);
}

beforeEach(async () => {
  testDb = await createTestDatabase();
  mockGetDatabase.mockReset().mockImplementation(() => Promise.resolve(testDb));
  mockReindex.mockReset().mockResolvedValue(undefined);
  resetChangeFeedForTests();
  resetViewRefreshForTests();
  resetPendingEditsForTests();
  installViewRefresh();
  useNoteStore.setState({ notes: [], currentNote: null, isLoading: false, error: null });
  useVersionStore.setState({
    versions: [],
    totalCount: 0,
    currentBookId: null,
    currentPage: 1,
    pageSize: 10,
    isLoading: false,
    error: null,
  });
});

afterEach(() => {
  resetViewRefreshForTests();
  resetChangeFeedForTests();
  resetPendingEditsForTests();
});

describe("the #588 demo Plugin", () => {
  it("changes the Library in one run: a moved Chapter, a Plugin Checkpoint, and a deleted Note", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0);
    await seedChapter("ch-2", "book-1", 1);
    await seedNote("note-1");

    const declared = [
      ...DEMO_MANIFEST.permissions.required,
      ...DEMO_MANIFEST.permissions.optional,
    ] as PluginPermissionId[];
    const { client, close } = connectPluginBroker({
      manifest: DEMO_MANIFEST,
      declared,
      granted: () => declared,
    });
    let chapterId: string;
    let versionId: string | null;
    try {
      ({ chapterId, versionId } = await runLibraryDemo(client, {
        bookId: "book-1",
        noteId: "note-1",
        chapterTitle: "Demo Chapter",
        checkpointLabel: "Before the demo changed the Book",
      }));
    } finally {
      close();
    }

    // The new Chapter sits first, at the position chapters.reorder moved it to,
    // with what chapters.update set.
    expect(await chapterIds("book-1")).toEqual([chapterId, "ch-1", "ch-2"]);
    expect(await chapterRow(chapterId)).toMatchObject({
      title: "Demo Chapter, revised",
      order: 0,
      chapter_type: "prologue",
      status: "revised",
    });

    // books.checkpoint took one Version, with the Plugin Version Trigger and
    // the label as its name.
    expect(versionId).toEqual(expect.any(String));
    expect(await versionRows("book-1")).toEqual([
      {
        id: versionId,
        name: "Before the demo changed the Book",
        trigger_type: "plugin",
      },
    ]);

    // notes.delete took the Note off the Library.
    expect(await noteIds()).toEqual([]);
  });
});
