import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import type { BookSnapshot } from "@/features/sync/types";
import type { RemoteObject, RemoteVersionMeta } from "@/features/sync/client";
import { SyncCryptoError } from "@/features/sync/crypto";
import { createTestDatabase } from "@/test/support/db-test-context";
import { insertSplitVersionStatements } from "@/features/versions/content-store";
import { retainVersions } from "@/features/versions/retention";

const {
  mockGetDatabase,
  mockListRemoteVersions,
  mockListDeletedObjects,
  mockListObjects,
  mockPullVersionBlob,
  mockPushVersionBlob,
  mockSoftDeleteObject,
  mockEncryptToBuffer,
  mockDecryptBufferToText,
} = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
  mockListRemoteVersions: vi.fn(),
  mockListDeletedObjects: vi.fn(),
  mockListObjects: vi.fn(),
  mockPullVersionBlob: vi.fn(),
  mockPushVersionBlob: vi.fn(),
  mockSoftDeleteObject: vi.fn(),
  mockEncryptToBuffer: vi.fn(),
  mockDecryptBufferToText: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("@/features/sync/serializer", () => ({
  serializeBook: vi.fn(),
  applyBookSnapshot: vi.fn(),
}));

vi.mock("@/features/sync/client", () => ({
  listRemoteVersions: mockListRemoteVersions,
  listDeletedObjects: mockListDeletedObjects,
  listObjects: mockListObjects,
  pullVersionBlob: mockPullVersionBlob,
  pushVersionBlob: mockPushVersionBlob,
  softDeleteObject: mockSoftDeleteObject,
}));

vi.mock("@/features/sync/sync-codec", () => ({
  encryptToBuffer: mockEncryptToBuffer,
  decryptBufferToText: mockDecryptBufferToText,
}));

const { syncVersions, tombstoneVersionsOfDeletedBooks } = await import(
  "@/features/sync/version-sync"
);

const BOOK_ID = "book-1";
// Retention bins are UTC days and weeks counted from the epoch, so every
// seeded age is measured against this fixed instant.
const NOW_MS = Date.UTC(2026, 9, 22, 12, 0, 0);
const NOW = NOW_MS / 1000;
const DAY = 24 * 60 * 60;
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** A one-chapter Book whose text names its Version, so every Version owns its own content. */
function makeSnapshot(versionId: string): BookSnapshot {
  return {
    book: {
      id: BOOK_ID,
      title: "Test Book",
      subtitle: null,
      authorName: "Author",
      description: null,
      genre: null,
      language: "en",
      coverImagePath: null,
      coverData: null,
      wordCount: 1000,
      targetWordCount: null,
      status: "draft",
      createdAt: 1000,
      updatedAt: 1000,
      lastOpenedAt: null,
      lastChapterId: null,
    },
    chapters: [
      {
        id: `ch-${versionId}`,
        bookId: BOOK_ID,
        title: "Chapter",
        content: `<p>text of ${versionId}</p>`,
        synopsis: null,
        order: 0,
        parentId: null,
        chapterType: "chapter",
        wordCount: 1000,
        status: "draft",
        isIncludedInExport: true,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
  };
}

interface Candidate {
  id: string;
  triggerType: string;
  createdAt: number;
}

/** One automatic Version per day, newest first: the shape a long-lived Book accumulates. */
function dailyAutoCandidates(count: number): Candidate[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `v-${i}`,
    triggerType: "auto-idle",
    createdAt: NOW - i * DAY,
  }));
}

function remoteVersion(candidate: Candidate, name: string | null = null): RemoteVersionMeta {
  return {
    remoteId: `rem-${candidate.id}`,
    versionId: candidate.id,
    bookId: BOOK_ID,
    checksum: `chk-${candidate.id}`,
    name,
    triggerType: candidate.triggerType,
    createdAt: candidate.createdAt,
    wordCount: 1000,
  };
}

function remoteRow(kind: string, key: string, group = ""): RemoteObject {
  return {
    remoteId: `obj-${kind}-${key}`,
    kind: kind as RemoteObject["kind"],
    key,
    group,
    checksum: "",
    deleted: true,
    meta: "",
    updatedAt: 0,
    updatedIso: "",
  };
}

describe("Version sync (ADR 0033)", () => {
  let testDb: DatabaseAdapter;

  /** Stores a split Version the way a local save does, and returns the Book it saved. */
  async function seedLocalVersion(
    id: string,
    triggerType: string,
    createdAt: number,
    name: string | null = null
  ): Promise<BookSnapshot> {
    const snapshot = makeSnapshot(id);
    const statements = await insertSplitVersionStatements(
      testDb,
      {
        id,
        bookId: BOOK_ID,
        name,
        wordCount: 1000,
        checksum: `chk-${id}`,
        triggerType,
        createdAt,
        syncedAt: null,
      },
      snapshot
    );
    await testDb.executeAtomic(statements);
    return snapshot;
  }

  async function localIds(): Promise<string[]> {
    const rows = await testDb.select<{ id: string }[]>(
      "SELECT id FROM book_versions WHERE book_id = ?",
      [BOOK_ID]
    );
    return rows.map((row) => row.id).sort();
  }

  async function pendingTombstoneIds(): Promise<string[]> {
    const rows = await testDb.select<{ version_id: string }[]>(
      "SELECT version_id FROM version_tombstones WHERE book_id = ?",
      [BOOK_ID]
    );
    return rows.map((row) => row.version_id).sort();
  }

  /** Version ids passed to pushVersionBlob, sorted. */
  function pushedIds(): string[] {
    return mockPushVersionBlob.mock.calls
      .map(([meta]) => (meta as { versionId: string }).versionId)
      .sort();
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await testDb.execute(
      "INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [BOOK_ID, "Test Book", "Author", NOW, NOW]
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);

    // Defaults: nothing on the server, and blobs round-trip as plain UTF-8 JSON.
    mockListRemoteVersions.mockResolvedValue([]);
    mockListDeletedObjects.mockResolvedValue([]);
    mockListObjects.mockResolvedValue([]);
    mockPushVersionBlob.mockResolvedValue(undefined);
    mockSoftDeleteObject.mockResolvedValue(undefined);
    mockPullVersionBlob.mockImplementation(async (remoteId: string) => ({
      data: ENCODER.encode(JSON.stringify(makeSnapshot(remoteId.slice("rem-".length)))),
    }));
    mockEncryptToBuffer.mockImplementation(async (text: string) => ENCODER.encode(text));
    mockDecryptBufferToText.mockImplementation(async (data: Uint8Array) => DECODER.decode(data));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("pulls only the Versions retention keeps, and downloads none it drops", async () => {
    const candidates = dailyAutoCandidates(30);
    mockListRemoteVersions.mockResolvedValue(candidates.map((c) => remoteVersion(c)));

    await syncVersions(BOOK_ID, "pass", { push: false, pull: true });

    const keep = retainVersions(candidates, NOW);
    // Retention must drop some of the 30 for this case to mean anything.
    expect(keep.size).toBeLessThan(candidates.length);
    expect(mockPullVersionBlob.mock.calls.map(([remoteId]) => remoteId).sort()).toEqual(
      [...keep].map((id) => `rem-${id}`).sort()
    );
    const rows = await testDb.select<{ id: string; format: string }[]>(
      "SELECT id, format FROM book_versions WHERE book_id = ? ORDER BY id",
      [BOOK_ID]
    );
    expect(rows.map((row) => row.id)).toEqual([...keep].sort());
    expect(rows.every((row) => row.format === "split")).toBe(true);
  });

  it("tombstones remote Versions that retention drops when pushing", async () => {
    const candidates = dailyAutoCandidates(30);
    mockListRemoteVersions.mockResolvedValue(candidates.map((c) => remoteVersion(c)));

    await syncVersions(BOOK_ID, "pass", { push: true, pull: false });

    const keep = retainVersions(candidates, NOW);
    const dropped = candidates.map((c) => c.id).filter((id) => !keep.has(id));
    expect(dropped.length).toBeGreaterThan(0);
    const tombstoned = mockSoftDeleteObject.mock.calls.map(([kind, id]) => {
      expect(kind).toBe("version");
      return id as string;
    });
    expect(tombstoned.sort()).toEqual(dropped.sort());
  });

  it("never tombstones remote Versions when pushing is disabled", async () => {
    const candidates = dailyAutoCandidates(30);
    mockListRemoteVersions.mockResolvedValue(candidates.map((c) => remoteVersion(c)));

    await syncVersions(BOOK_ID, "pass", { push: false, pull: true });

    expect(mockSoftDeleteObject).not.toHaveBeenCalled();
    expect(mockPushVersionBlob).not.toHaveBeenCalled();
  });

  it("deletes local Versions that retention drops, with their manifests and content, and never pushes them", async () => {
    const candidates = dailyAutoCandidates(30);
    for (const candidate of candidates) {
      await seedLocalVersion(candidate.id, candidate.triggerType, candidate.createdAt);
    }
    const keep = retainVersions(candidates, NOW);
    expect(keep.size).toBeLessThan(candidates.length);

    await syncVersions(BOOK_ID, "pass", { push: true, pull: false });

    expect(await localIds()).toEqual([...keep].sort());
    const chapterOwners = await testDb.select<{ version_id: string }[]>(
      "SELECT version_id FROM book_version_chapters"
    );
    expect(chapterOwners.map((row) => row.version_id).sort()).toEqual([...keep].sort());
    // Each Version owns its own text, so the dropped ones take their blobs with them.
    const blobs = await testDb.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM version_blobs");
    expect(blobs[0].n).toBe(keep.size);
    // Only kept Versions reach the server, and they are not tombstoned.
    expect(pushedIds()).toEqual([...keep].sort());
    expect(mockSoftDeleteObject).not.toHaveBeenCalled();
  });

  it("keeps pruned Versions gone once the server lists them as deleted", async () => {
    const candidates = dailyAutoCandidates(30);
    const remotes = candidates.map((c) => remoteVersion(c));
    mockListRemoteVersions.mockResolvedValue(remotes);
    await syncVersions(BOOK_ID, "pass", { push: true, pull: true });

    const keep = retainVersions(candidates, NOW);
    const dropped = candidates.map((c) => c.id).filter((id) => !keep.has(id));
    expect(await localIds()).toEqual([...keep].sort());
    // The first sync tombstoned what it dropped. The server now reports those
    // rows as deleted and no longer lists them as live.
    mockListDeletedObjects.mockResolvedValue(
      dropped.map((id) => remoteRow("version", id, BOOK_ID))
    );
    mockListRemoteVersions.mockResolvedValue(
      remotes.filter((remote) => keep.has(remote.versionId))
    );
    mockPullVersionBlob.mockClear();
    mockPushVersionBlob.mockClear();

    await syncVersions(BOOK_ID, "pass", { push: true, pull: true });

    expect(mockPullVersionBlob).not.toHaveBeenCalled();
    expect(mockPushVersionBlob).not.toHaveBeenCalled();
    expect(await localIds()).toEqual([...keep].sort());
  });

  it("deletes a local Version that a remote tombstone names, even when retention keeps it", async () => {
    await seedLocalVersion("ver-manual", "manual", NOW - 5 * DAY, "Named");
    mockListDeletedObjects.mockResolvedValue([remoteRow("version", "ver-manual", BOOK_ID)]);

    await syncVersions(BOOK_ID, "pass", { push: true, pull: true });

    expect(await localIds()).toEqual([]);
    const blobs = await testDb.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM version_blobs");
    expect(blobs[0].n).toBe(0);
    expect(mockPushVersionBlob).not.toHaveBeenCalled();
    expect(mockSoftDeleteObject).not.toHaveBeenCalled();
  });

  it("tombstones a pending local Version on the server and removes its row once it succeeds", async () => {
    await testDb.execute(
      "INSERT INTO version_tombstones (version_id, book_id, deleted_at) VALUES (?, ?, ?)",
      ["ver-gone", BOOK_ID, NOW]
    );
    await syncVersions(BOOK_ID, "pass", { push: true, pull: true });

    expect(mockSoftDeleteObject).toHaveBeenCalledWith("version", "ver-gone", undefined, BOOK_ID);
    expect(await pendingTombstoneIds()).toEqual([]);
    expect(mockPullVersionBlob).not.toHaveBeenCalled();
  });

  it("keeps a pending tombstone whose server call fails and still finishes the sync", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const id of ["ver-a", "ver-b"]) {
      await testDb.execute(
        "INSERT INTO version_tombstones (version_id, book_id, deleted_at) VALUES (?, ?, ?)",
        [id, BOOK_ID, NOW]
      );
    }
    await seedLocalVersion("ver-keep", "manual", NOW - DAY);
    mockSoftDeleteObject.mockImplementation(async (_kind: string, id: string) => {
      if (id === "ver-a") throw new Error("offline");
    });

    await expect(
      syncVersions(BOOK_ID, "pass", { push: true, pull: true })
    ).resolves.toBeUndefined();

    expect(mockSoftDeleteObject).toHaveBeenCalledWith("version", "ver-b", undefined, BOOK_ID);
    expect(await pendingTombstoneIds()).toEqual(["ver-a"]);
    expect(pushedIds()).toEqual(["ver-keep"]);
  });

  it("pushes a kept local Version the server lacks, with its full snapshot, and stamps synced_at", async () => {
    const snapshot = await seedLocalVersion("ver-local", "manual", NOW - 3 * DAY, "Draft");

    await syncVersions(BOOK_ID, "pass", { push: true, pull: false });

    expect(mockPushVersionBlob).toHaveBeenCalledTimes(1);
    const [meta, blob] = mockPushVersionBlob.mock.calls[0];
    expect(meta).toEqual({
      versionId: "ver-local",
      bookId: BOOK_ID,
      checksum: "chk-ver-local",
      name: "Draft",
      triggerType: "manual",
      createdAt: NOW - 3 * DAY,
      wordCount: 1000,
    });
    expect(JSON.parse(await (blob as Blob).text())).toEqual(snapshot);
    const rows = await testDb.select<{ synced_at: number | null }[]>(
      "SELECT synced_at FROM book_versions WHERE id = ?",
      ["ver-local"]
    );
    expect(rows[0].synced_at).toBe(NOW);
  });

  it("rethrows an invalid passphrase and pulls nothing", async () => {
    mockListRemoteVersions.mockResolvedValue([
      remoteVersion({ id: "ver-remote", triggerType: "manual", createdAt: NOW - DAY }),
    ]);
    const passphraseError = new SyncCryptoError("INVALID_PASSPHRASE", "bad passphrase");
    mockDecryptBufferToText.mockRejectedValue(passphraseError);

    await expect(syncVersions(BOOK_ID, "pass", { push: false, pull: true })).rejects.toBe(
      passphraseError
    );
    expect(await localIds()).toEqual([]);
  });

  it("skips a Version that fails to decrypt for another reason and keeps syncing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockListRemoteVersions.mockResolvedValue([
      remoteVersion({ id: "ver-bad", triggerType: "manual", createdAt: NOW - DAY }),
      remoteVersion({ id: "ver-good", triggerType: "manual", createdAt: NOW - 2 * DAY }),
    ]);
    mockDecryptBufferToText.mockImplementation(async (data: Uint8Array) => {
      const text = DECODER.decode(data);
      if (text.includes("text of ver-bad")) throw new Error("corrupt blob");
      return text;
    });

    await expect(
      syncVersions(BOOK_ID, "pass", { push: false, pull: true })
    ).resolves.toBeUndefined();

    expect(await localIds()).toEqual(["ver-good"]);
  });

  it("tombstones the remote Versions of Books deleted remotely, and no others", async () => {
    mockListObjects.mockImplementation(async (kind: string) => {
      if (kind === "version") {
        return [
          remoteRow("version", "v1", "b1"),
          remoteRow("version", "v2", "b1"),
          remoteRow("version", "v3", "b2"),
          remoteRow("version", "v4", "b3"),
        ];
      }
      if (kind === "book") return [remoteRow("book", "b2", "b2"), remoteRow("book", "b3", "b3")];
      return [];
    });
    mockListDeletedObjects.mockImplementation(async (kind: string) =>
      kind === "book" ? [remoteRow("book", "b1"), remoteRow("book", "b3")] : []
    );

    await tombstoneVersionsOfDeletedBooks();

    // b3 was deleted and then revived, so its live row wins and its Versions stay.
    // Each tombstone carries its Book as the group, so the server keeps it.
    expect(mockSoftDeleteObject.mock.calls).toEqual([
      ["version", "v1", undefined, "b1"],
      ["version", "v2", undefined, "b1"],
    ]);
  });

  it("makes no client call at all while an inline Version awaits the upgrade", async () => {
    // A raw INSERT keeps the default format 'inline': the upgrade has not run.
    await testDb.execute(
      `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "ver-inline",
        BOOK_ID,
        null,
        JSON.stringify(makeSnapshot("inline")),
        1000,
        "chk-inline",
        "manual",
        NOW - DAY,
        null,
      ]
    );
    await testDb.execute(
      "INSERT INTO version_tombstones (version_id, book_id, deleted_at) VALUES (?, ?, ?)",
      ["ver-gone", BOOK_ID, NOW]
    );
    mockListRemoteVersions.mockResolvedValue([
      remoteVersion({ id: "ver-remote", triggerType: "manual", createdAt: NOW - DAY }),
    ]);
    mockListDeletedObjects.mockResolvedValue([remoteRow("version", "ver-remote", BOOK_ID)]);

    await syncVersions(BOOK_ID, "pass", { push: true, pull: true });

    expect(mockListRemoteVersions).not.toHaveBeenCalled();
    expect(mockListDeletedObjects).not.toHaveBeenCalled();
    expect(mockSoftDeleteObject).not.toHaveBeenCalled();
    expect(mockPushVersionBlob).not.toHaveBeenCalled();
    expect(mockPullVersionBlob).not.toHaveBeenCalled();
    // Nothing was dropped or tombstoned locally either.
    expect(await localIds()).toEqual(["ver-inline"]);
    expect(await pendingTombstoneIds()).toEqual(["ver-gone"]);
  });
});
