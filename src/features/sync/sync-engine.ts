import { getDatabase } from "../../lib/db";
import { encrypt, decrypt, computeChecksum } from "./crypto";
import { serializeBook, applyBookSnapshot } from "./serializer";
import {
  pushBookBlob,
  pullBookBlob,
  listRemoteBooks,
} from "./client";
import type { BookSnapshot } from "./types";

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

interface BookIdRow {
  id: string;
  updated_at: number;
}

function toBlobPart(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

export async function syncBook(
  bookId: string,
  passphrase: string,
): Promise<void> {
  assertOnline();

  // 1. Serialize local book
  const json = await serializeBook(bookId);
  const localChecksum = await computeChecksum(json);

  // 2. Get local updatedAt
  const db = await getDatabase();
  const rows = await db.select<BookIdRow[]>(
    "SELECT id, updated_at FROM books WHERE id = ?",
    [bookId],
  );
  const localUpdatedAt = rows[0]?.updated_at ?? 0;

  // 3. Fetch remote metadata
  const remoteBooks = await listRemoteBooks();
  const remote = remoteBooks.find((r) => r.bookId === bookId);

  if (!remote) {
    // No remote — push
    const encrypted = await encrypt(json, passphrase);
    await pushBookBlob(bookId, new Blob([toBlobPart(encrypted)]), localChecksum);
    return;
  }

  if (remote.checksum === localChecksum) {
    // Already synced
    return;
  }

  // Checksums differ — compare timestamps
  if (localUpdatedAt >= remote.updatedAt) {
    // Local is newer or same — push
    const encrypted = await encrypt(json, passphrase);
    await pushBookBlob(bookId, new Blob([toBlobPart(encrypted)]), localChecksum);
  } else {
    // Remote is newer — pull
    const pulled = await pullBookBlob(bookId);
    if (!pulled) return;

    const snapshot = await decryptSnapshot(pulled.data, passphrase);
    await applyBookSnapshot(snapshot);
  }
}

export async function syncAllBooks(
  passphrase: string,
): Promise<void> {
  assertOnline();

  const db = await getDatabase();

  // Get all local book IDs
  const localBooks = await db.select<BookIdRow[]>(
    "SELECT id, updated_at FROM books",
  );
  const localBookIds = new Set(localBooks.map((b) => b.id));

  // Get all remote metadata
  const remoteBooks = await listRemoteBooks();

  // Sync each local book
  for (const book of localBooks) {
    await syncBook(book.id, passphrase);
  }

  // Pull remote-only books (exist on server but not locally)
  for (const remote of remoteBooks) {
    if (localBookIds.has(remote.bookId)) continue;

    const pulled = await pullBookBlob(remote.bookId);
    if (!pulled) continue;

    const snapshot = await decryptSnapshot(pulled.data, passphrase);
    await applyBookSnapshot(snapshot);
  }
}
