import { getDatabase } from "../../lib/db";
import { encrypt, decrypt, computeChecksum } from "./crypto";
import { serializeBook, applyBookSnapshot } from "./serializer";
import {
  pushBookBlob,
  pullBookBlob,
  listRemoteBooks,
  refreshAuth as pbRefreshAuth,
} from "./client";
import type { BookSnapshot, SyncItemMeta, SingleSyncResult, BatchSyncResult } from "./types";
import type { SyncAction, ConflictResolver } from "./types";
import { createBackup } from "../../lib/platform";
import { BackupService } from "../backup/backup-service";
import { useSettingsStore } from "../settings/store";
import { useSyncStore } from "./store";

let isSyncing = false;
const PRE_SYNC_BACKUP_ERROR = "Could not create a safety backup. Sync aborted. Free up disk space and try again.";

async function decryptSnapshot(
  data: Uint8Array,
  passphrase: string,
): Promise<BookSnapshot> {
  const decrypted = await decrypt(data, passphrase);
  try {
    return JSON.parse(decrypted) as BookSnapshot;
  } catch {
    throw new Error("Synced payload is invalid or corrupted");
  }
}

function assertOnline(): void {
  if (!navigator.onLine) {
    throw new Error("No internet connection");
  }
}

function toBlobPart(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

interface EffectiveTimestamp {
  updated_at: number;
}

async function getLocalUpdatedAt(bookId: string): Promise<number> {
  const db = await getDatabase();
  const rows = await db.select<EffectiveTimestamp[]>(
    `SELECT COALESCE(MAX(ts), 0) AS updated_at FROM (
      SELECT updated_at AS ts FROM books WHERE id = ?
      UNION ALL
      SELECT updated_at AS ts FROM chapters WHERE book_id = ?
    )`,
    [bookId, bookId],
  );
  return rows[0]?.updated_at ?? 0;
}

async function getBookTitle(bookId: string): Promise<string> {
  const db = await getDatabase();
  const rows = await db.select<{ title: string }[]>(
    "SELECT title FROM books WHERE id = ?",
    [bookId],
  );
  return rows[0]?.title ?? bookId;
}

function assertNotSyncing(): void {
  if (isSyncing) {
    throw new Error("A sync operation is already in progress");
  }
}

async function createPreSyncBackupOrThrow(): Promise<void> {
  try {
    const adapter = await createBackup(useSettingsStore.getState().backupDirectory);
    const backupService = new BackupService(adapter);
    await backupService.createBackup("pre-sync");
  } catch {
    throw new Error(PRE_SYNC_BACKUP_ERROR);
  }
}

async function ensureAuth(): Promise<void> {
  if (useSyncStore.getState().authVerified) return;

  try {
    const result = await pbRefreshAuth();
    useSyncStore.setState({
      authStatus: "logged-in",
      userEmail: result.email,
      authToken: result.token,
      authVerified: true,
    });
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status === 401) {
      useSyncStore.setState({
        authStatus: "logged-out",
        userEmail: null,
        authToken: null,
        authVerified: false,
      });
      throw new Error("sync.sessionExpired");
    }
    throw error;
  }
}

async function syncBookInBatch(
  bookId: string,
  passphrase: string,
  onConflict: ConflictResolver,
  remoteBooks?: SyncItemMeta[],
  precomputedLocalUpdatedAt?: number,
): Promise<SyncAction> {
  assertOnline();

  const json = await serializeBook(bookId);
  const localChecksum = await computeChecksum(json);
  // Reuse the timestamp from syncAllBooks' GROUP BY query when available,
  // avoiding a redundant per-book MAX query.
  const localUpdatedAt = precomputedLocalUpdatedAt ?? await getLocalUpdatedAt(bookId);

  const remotes = remoteBooks ?? await listRemoteBooks();
  const remote = remotes.find((r) => r.bookId === bookId);

  if (!remote) {
    const encrypted = await encrypt(json, passphrase);
    await pushBookBlob(bookId, new Blob([toBlobPart(encrypted)]), localChecksum);
    return "pushed";
  }

  if (remote.checksum === localChecksum) {
    return "skipped";
  }

  // Checksums differ — compare timestamps
  if (localUpdatedAt > remote.updatedAt) {
    // Local is strictly newer — push
    const encrypted = await encrypt(json, passphrase);
    await pushBookBlob(bookId, new Blob([toBlobPart(encrypted)]), localChecksum);
    return "pushed";
  }

  // Remote is newer or equal timestamps — ask user
  const bookTitle = await getBookTitle(bookId);
  const choice = await onConflict({
    bookId,
    bookTitle,
    localUpdatedAt,
    remoteUpdatedAt: remote.updatedAt,
  });

  if (choice === "cancel") {
    return "cancelled";
  }

  if (choice === "push") {
    const encrypted = await encrypt(json, passphrase);
    await pushBookBlob(bookId, new Blob([toBlobPart(encrypted)]), localChecksum);
    return "pushed";
  }

  // choice === "pull"
  const pulled = await pullBookBlob(bookId);
  if (!pulled) return "skipped";

  const snapshot = await decryptSnapshot(pulled.data, passphrase);
  await applyBookSnapshot(snapshot);
  return "pulled";
}

export async function syncBook(
  bookId: string,
  passphrase: string,
  onConflict: ConflictResolver,
): Promise<SingleSyncResult> {
  assertNotSyncing();
  isSyncing = true;
  try {
    await ensureAuth();
    await createPreSyncBackupOrThrow();

    const action = await syncBookInBatch(bookId, passphrase, onConflict);
    return {
      outcome: action === "cancelled" ? "cancelled" : "success",
      action,
    };
  } finally {
    isSyncing = false;
  }
}

interface BookTimestampRow {
  id: string;
  updated_at: number;
}

export async function syncAllBooks(
  passphrase: string,
  onConflict: ConflictResolver,
): Promise<BatchSyncResult> {
  assertNotSyncing();
  isSyncing = true;
  try {
    await ensureAuth();
    assertOnline();
    const actions: SyncAction[] = [];

    await createPreSyncBackupOrThrow();

    const db = await getDatabase();
    const localBooks = await db.select<BookTimestampRow[]>(
      `SELECT b.id, MAX(b.updated_at, COALESCE(MAX(c.updated_at), 0)) AS updated_at
       FROM books b
       LEFT JOIN chapters c ON c.book_id = b.id
       GROUP BY b.id`
    );
    const localBookIds = new Set(localBooks.map((b) => b.id));

    const remoteBooks = await listRemoteBooks();

    for (const book of localBooks) {
      const action = await syncBookInBatch(book.id, passphrase, onConflict, remoteBooks, book.updated_at);
      actions.push(action);
      if (action === "cancelled") {
        return {
          outcome: actions.some((entry) => entry !== "cancelled") ? "partial" : "cancelled",
          actions,
        };
      }
    }

    // Pull remote-only books (no local data — auto-pull, no conflict dialog)
    for (const remote of remoteBooks) {
      if (localBookIds.has(remote.bookId)) continue;

      const pulled = await pullBookBlob(remote.bookId);
      if (!pulled) continue;

      const snapshot = await decryptSnapshot(pulled.data, passphrase);
      await applyBookSnapshot(snapshot);
      actions.push("pulled");
    }

    return { outcome: "success", actions };
  } finally {
    isSyncing = false;
  }
}

export function resetSyncEngineForTests(): void {
  isSyncing = false;
}
