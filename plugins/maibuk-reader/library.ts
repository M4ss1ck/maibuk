/**
 * The Shelf's SDK-facing service (#653): it turns `files.*` calls and Plugin
 * storage into the rules `shelf.ts` defines. The page and the Commands both go
 * through this one object, so opening a file, marking a Missing Document,
 * removing a Document, locating a file again, and asking for permission behave
 * the same wherever they start.
 *
 * It keeps no state of its own: every method reads the Shelf from storage,
 * changes it with a pure rule, and writes it back. Imports only `@/plugin-sdk`
 * (for the client type) and this Plugin's files.
 */

import type { PluginClient } from "@/plugin-sdk";
import {
  COLLECTIONS_KEY,
  CURRENT_DOCUMENT_KEY,
  FINGERPRINT_WINDOW,
  SETTINGS_KEY,
  SHELF_KEY,
  SHELF_VIEW_KEY,
  SUPPORTED_EXTENSIONS,
  bookmarksKey,
  clampSettings,
  clampShelfView,
  collectionName,
  fingerprint,
  formatFromName,
  highlightsKey,
  markState,
  parseCollections,
  parseShelf,
  positionKey,
  reattach,
  removeEntry,
  sameCollectionName,
  sniffFormat,
  sortShelf,
  titleFromName,
  upsertByFingerprint,
  type Collection,
  type DocumentFormat,
  type DocumentState,
  type ReaderSettings,
  type ShelfEntry,
  type ShelfViewSettings,
} from "./shelf";

/** The SDK surface the Shelf service needs. */
export type ReaderClient = Pick<PluginClient, "files" | "storage">;

/** What locating a Missing Document found. */
export type LocateAgainResult =
  | { ok: true; entry: ShelfEntry }
  | { ok: false; reason: "cancelled" | "not-found" | "fingerprint-mismatch" };

/** What removing a Document from the Shelf would discard. */
export interface RemovalCounts {
  bookmarks: number;
  highlights: number;
  notes: number;
}

/** Why a Collection write was refused: an empty name, or a name another Collection already has. */
export class CollectionError extends Error {
  constructor(readonly code: "empty-name" | "duplicate-name") {
    super(code);
    this.name = "CollectionError";
  }
}

/** The error code the host puts on a refused File Grant call. */
function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** The stored array under `key`, or none when the value is missing or malformed. */
async function storedArray(client: ReaderClient, key: string): Promise<unknown[]> {
  try {
    const value = await client.storage.get({ key });
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** Whether a stored Highlight carries a written note. */
function hasNote(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const note = (value as { note?: unknown }).note;
  return typeof note === "string" && note !== "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A file the author picked or dropped, as the host grants it. */
export interface ShelvedFile {
  grant: string;
  name: string;
  size: number;
}

/** Ends a File Grant, ignoring a host that says it is already gone. */
export async function releaseGrant(client: ReaderClient, grant: string): Promise<void> {
  try {
    await client.files.release({ grant });
  } catch {
    // The grant may already be gone; the caller still reports the failure.
  }
}

/** A stable, Plugin-local id for a new Document. */
export function newDocumentId(): string {
  const random = globalThis.crypto?.randomUUID;
  if (typeof random === "function") return random.call(globalThis.crypto);
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A stable, Plugin-local id for a new Collection. */
function newCollectionId(): string {
  const random = globalThis.crypto?.randomUUID;
  if (typeof random === "function") return random.call(globalThis.crypto);
  return `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The Collections with `documentId` added to or removed from the one named `id`.
 * Returns the same list when the Collection is unknown or already in the state
 * asked for, so the caller can skip the write.
 */
function setMember(
  collections: Collection[],
  id: string,
  documentId: string,
  member: boolean
): Collection[] {
  const target = collections.find((collection) => collection.id === id);
  if (target === undefined || target.documentIds.includes(documentId) === member) {
    return collections;
  }
  return collections.map((collection) =>
    collection.id !== id
      ? collection
      : {
          ...collection,
          documentIds: member
            ? [...collection.documentIds, documentId]
            : collection.documentIds.filter((candidate) => candidate !== documentId),
        }
  );
}

/** The head and tail bytes a Fingerprint hashes, read in two calls. */
export async function fingerprintBytes(
  client: ReaderClient,
  grant: string,
  size: number
): Promise<{ head: Uint8Array; print: string }> {
  // A zero-byte file has no head or tail to read, and the host rejects a zero-length read.
  if (size === 0) {
    const empty = new Uint8Array(0);
    return { head: empty, print: await fingerprint(0, empty, empty) };
  }
  const window = Math.min(FINGERPRINT_WINDOW, size);
  const head = new Uint8Array(await client.files.read({ grant, offset: 0, length: window }));
  const tailOffset = Math.max(0, size - FINGERPRINT_WINDOW);
  const tail = new Uint8Array(
    await client.files.read({ grant, offset: tailOffset, length: window })
  );
  return { head, print: await fingerprint(size, head, tail) };
}

/** What the Shelf service exposes to the page and the Commands. */
export interface ShelfService {
  loadShelf(): Promise<ShelfEntry[]>;
  /**
   * Reads the Shelf, applies `change`, and writes the sorted result, one
   * change at a time: an Import adding Documents and a Reading Position save
   * never read the same Shelf and write over each other (#948). `change`
   * returns null, or the array it was given, to write nothing. Resolves with
   * the Shelf as stored after the change. A failed read throws before `change` runs.
   */
  updateShelf(change: (shelf: ShelfEntry[]) => ShelfEntry[] | null): Promise<ShelfEntry[]>;
  loadSettings(): Promise<ReaderSettings>;
  saveSettings(settings: ReaderSettings): Promise<void>;
  /** The Shelf's remembered view; a missing, malformed, or unreadable value falls back to the default. */
  loadShelfView(): Promise<ShelfViewSettings>;
  /** Stores the Shelf's view, clamped to what the Shelf can show. A failed write throws. */
  saveShelfView(settings: ShelfViewSettings): Promise<void>;
  /** Picks a file, fingerprints it, and adds it to the Shelf or finds its Document. */
  openFileFlow(): Promise<ShelfEntry | null>;
  /**
   * Shelves a File Grant the author picked or dropped: fingerprints its bytes,
   * sniffs its format with the file name as a fallback, and adds it to the Shelf
   * or finds its Document by Fingerprint. A format Reader cannot open, or bytes
   * it cannot read, releases the grant and throws.
   */
  shelveGrant(picked: ShelvedFile): Promise<ShelfEntry>;
  /** Marks every Document the device can no longer read, and returns the Shelf. */
  refreshStates(): Promise<ShelfEntry[]>;
  /** What removing the Document would discard: its Bookmarks, Highlights, and written notes. */
  removalCounts(id: string): Promise<RemovalCounts>;
  /** Forgets a Document and ends its File Grant; the author's file stays. */
  removeFromShelf(id: string): Promise<ShelfEntry[]>;
  /** Picks a file again for a Missing Document, keeping its Reading Position on a match. */
  locateAgain(id: string): Promise<LocateAgainResult>;
  /** Asks the browser for read access again; desktop always says yes. */
  reopen(id: string): Promise<boolean>;
  /** Remembers which Document the Reading page has open. */
  rememberCurrent(id: string): Promise<void>;
  /** The Shelf row of the Document the Reading page last had open, if it is still on the Shelf. */
  loadCurrent(): Promise<ShelfEntry | null>;
  /** The author's Collections in the order they were made; a missing or malformed value reads as none. A failed read throws. */
  loadCollections(): Promise<Collection[]>;
  /**
   * Makes a Collection named `name`, or reuses the one whose name matches it
   * ignoring case, and files `documentId` in it when that Document is on the
   * Shelf. Throws a CollectionError with "empty-name" for a blank name.
   */
  createCollection(name: string, documentId?: string): Promise<Collection[]>;
  /** Renames a Collection. Throws a CollectionError for a blank name or one another Collection has; an unknown id changes nothing. */
  renameCollection(id: string, name: string): Promise<Collection[]>;
  /** Deletes a Collection; its Documents stay on the Shelf and in any other Collection. */
  deleteCollection(id: string): Promise<Collection[]>;
  /**
   * Files a Document in a Collection (`member` true) or takes it out of that
   * Collection only. Adding needs the Document to be on the Shelf. An unknown
   * Collection, or a change that changes nothing, writes nothing.
   */
  setInCollection(id: string, documentId: string, member: boolean): Promise<Collection[]>;
  /**
   * Files every Shelf Document in `documentIds` in the Collection named `name`,
   * made when none has that name (ignoring case, as `createCollection` does),
   * in one write (#949). A blank name or no Shelf Document writes nothing.
   */
  fileInCollection(name: string, documentIds: readonly string[]): Promise<Collection[]>;
  /**
   * Puts `entry` in the place of the Document `oldId` (#949): it joins the old
   * Document's Collections, and the old Document leaves the Shelf with its
   * Reading Position, Bookmarks, and Highlights; its File Grant is released.
   * Resolves false, changing nothing, when `oldId` is no longer on the Shelf.
   */
  replaceDocument(oldId: string, entry: ShelfEntry): Promise<boolean>;
}

export function createShelfService(client: ReaderClient): ShelfService {
  /** Saves the Collections and returns the saved list. */
  async function writeCollections(collections: Collection[]): Promise<Collection[]> {
    await client.storage.set({ key: COLLECTIONS_KEY, value: collections });
    return collections;
  }

  /** The tail of the Shelf's write queue: every read-change-write runs after the last. */
  let shelfQueue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = shelfQueue.then(task, task);
    shelfQueue = run.catch(() => undefined);
    return run;
  }

  const library: ShelfService = {
    async loadShelf(): Promise<ShelfEntry[]> {
      // A failed read throws: the callers decide what it means, and the
      // mutating paths below refuse rather than write over a shelf they could
      // not read.
      return sortShelf(parseShelf(await client.storage.get({ key: SHELF_KEY })));
    },

    async rememberCurrent(id): Promise<void> {
      try {
        await client.storage.set({ key: CURRENT_DOCUMENT_KEY, value: id });
      } catch {
        /* Storage full or blocked: a relaunch shows the Shelf's choice again. */
      }
      // The first open stamps the Document as opened, so it is no longer new
      // even before a Reading Position is saved, and it reads as most recent.
      try {
        await library.updateShelf((shelf) => {
          const entry = shelf.find((candidate) => candidate.id === id);
          if (entry === undefined || entry.openedAt !== undefined) return null;
          const now = Date.now();
          return shelf.map((candidate) =>
            candidate.id === id ? { ...candidate, openedAt: now, lastReadAt: now } : candidate
          );
        });
      } catch {
        /* An unread Shelf is never written over; the Document stays new until it is read. */
      }
    },

    async loadCurrent(): Promise<ShelfEntry | null> {
      try {
        const id = await client.storage.get({ key: CURRENT_DOCUMENT_KEY });
        if (typeof id !== "string") return null;
        return (await library.loadShelf()).find((entry) => entry.id === id) ?? null;
      } catch {
        return null;
      }
    },

    async loadCollections(): Promise<Collection[]> {
      return parseCollections(await client.storage.get({ key: COLLECTIONS_KEY }));
    },

    async createCollection(name, documentId): Promise<Collection[]> {
      const cleaned = collectionName(name);
      if (cleaned === "") throw new CollectionError("empty-name");
      const collections = await library.loadCollections();
      // A Document id that is not on the Shelf is not filed; the Collection is still made.
      let filed: string | null = null;
      if (documentId !== undefined) {
        const shelf = await library.loadShelf();
        if (shelf.some((entry) => entry.id === documentId)) filed = documentId;
      }
      const existing = collections.find((collection) =>
        sameCollectionName(collection.name, cleaned)
      );
      if (existing === undefined) {
        return writeCollections([
          ...collections,
          { id: newCollectionId(), name: cleaned, documentIds: filed === null ? [] : [filed] },
        ]);
      }
      return writeCollections(
        filed === null ? collections : setMember(collections, existing.id, filed, true)
      );
    },

    async renameCollection(id, name): Promise<Collection[]> {
      const cleaned = collectionName(name);
      if (cleaned === "") throw new CollectionError("empty-name");
      const collections = await library.loadCollections();
      if (!collections.some((collection) => collection.id === id)) return collections;
      if (
        collections.some(
          (collection) => collection.id !== id && sameCollectionName(collection.name, cleaned)
        )
      ) {
        throw new CollectionError("duplicate-name");
      }
      return writeCollections(
        collections.map((collection) =>
          collection.id === id ? { ...collection, name: cleaned } : collection
        )
      );
    },

    async deleteCollection(id): Promise<Collection[]> {
      const collections = await library.loadCollections();
      if (!collections.some((collection) => collection.id === id)) return collections;
      return writeCollections(collections.filter((collection) => collection.id !== id));
    },

    async setInCollection(id, documentId, member): Promise<Collection[]> {
      const collections = await library.loadCollections();
      if (member) {
        const shelf = await library.loadShelf();
        if (!shelf.some((entry) => entry.id === documentId)) return collections;
      }
      const next = setMember(collections, id, documentId, member);
      return next === collections ? collections : writeCollections(next);
    },

    async fileInCollection(name, documentIds): Promise<Collection[]> {
      const cleaned = collectionName(name);
      const collections = await library.loadCollections();
      if (cleaned === "") return collections;
      const onShelf = new Set((await library.loadShelf()).map((entry) => entry.id));
      const ids = documentIds.filter((documentId) => onShelf.has(documentId));
      if (ids.length === 0) return collections;
      const existing = collections.find((collection) =>
        sameCollectionName(collection.name, cleaned)
      );
      if (existing === undefined) {
        return writeCollections([
          ...collections,
          { id: newCollectionId(), name: cleaned, documentIds: [...new Set(ids)] },
        ]);
      }
      const merged = [...new Set([...existing.documentIds, ...ids])];
      if (merged.length === existing.documentIds.length) return collections;
      return writeCollections(
        collections.map((collection) =>
          collection.id === existing.id ? { ...collection, documentIds: merged } : collection
        )
      );
    },

    async replaceDocument(oldId, entry): Promise<boolean> {
      const found: { old?: ShelfEntry } = {};
      await library.updateShelf((shelf) => {
        found.old = shelf.find((candidate) => candidate.id === oldId);
        if (found.old === undefined) return null;
        return [...removeEntry(shelf, oldId), entry];
      });
      const { old } = found;
      if (old === undefined) return false;
      // The new Document is on the Shelf: from here on, a failure leaves stale
      // data behind, never a lost Document.
      const collections = await library.loadCollections().catch(() => []);
      if (collections.some((collection) => collection.documentIds.includes(oldId))) {
        await writeCollections(
          collections.map((collection) => ({
            ...collection,
            documentIds: [
              ...new Set(
                collection.documentIds.map((documentId) =>
                  documentId === oldId ? entry.id : documentId
                )
              ),
            ],
          }))
        ).catch(() => undefined);
      }
      for (const key of [positionKey(oldId), bookmarksKey(oldId), highlightsKey(oldId)]) {
        try {
          await client.storage.delete({ key });
        } catch {
          // A key that never existed needs no delete.
        }
      }
      if (old.grant !== entry.grant) {
        try {
          await client.files.release({ grant: old.grant });
        } catch {
          // The grant may already be gone.
        }
      }
      return true;
    },

    updateShelf(change): Promise<ShelfEntry[]> {
      return exclusive(async () => {
        const shelf = sortShelf(parseShelf(await client.storage.get({ key: SHELF_KEY })));
        const next = change(shelf);
        if (next === null || next === shelf) return shelf;
        const sorted = sortShelf(next);
        await client.storage.set({ key: SHELF_KEY, value: sorted });
        return sorted;
      });
    },

    async loadSettings(): Promise<ReaderSettings> {
      try {
        return clampSettings(await client.storage.get({ key: SETTINGS_KEY }));
      } catch {
        return clampSettings(null);
      }
    },

    async saveSettings(settings): Promise<void> {
      await client.storage.set({ key: SETTINGS_KEY, value: clampSettings(settings) });
    },

    async loadShelfView(): Promise<ShelfViewSettings> {
      try {
        return clampShelfView(await client.storage.get({ key: SHELF_VIEW_KEY }));
      } catch {
        return clampShelfView(null);
      }
    },

    async saveShelfView(settings): Promise<void> {
      await client.storage.set({ key: SHELF_VIEW_KEY, value: clampShelfView(settings) });
    },

    async openFileFlow(): Promise<ShelfEntry | null> {
      const picked = await client.files.pick({ extensions: [...SUPPORTED_EXTENSIONS] });
      if (picked === null) return null;
      return library.shelveGrant(picked);
    },

    async shelveGrant(picked): Promise<ShelfEntry> {
      let head: Uint8Array;
      let print: string;
      try {
        ({ head, print } = await fingerprintBytes(client, picked.grant, picked.size));
      } catch {
        // The bytes are gone or unreadable: the author still learns the drop failed.
        await releaseGrant(client, picked.grant);
        throw new Error(`Reader cannot read ${picked.name}`);
      }
      const format: DocumentFormat | null =
        sniffFormat(head, picked.name) ?? formatFromName(picked.name);
      if (format === null) {
        await releaseGrant(client, picked.grant);
        throw new Error(`Reader cannot open ${picked.name}`);
      }
      const now = Date.now();
      const entry: ShelfEntry = {
        id: newDocumentId(),
        grant: picked.grant,
        fingerprint: print,
        title: titleFromName(picked.name),
        author: "",
        format,
        lastReadAt: now,
        addedAt: now,
        progress: null,
        state: "ok",
      };
      // A failed read throws before any write. The picked grant stays held: an
      // unread Shelf may already hold that same grant for another Document.
      let existing: ShelfEntry | undefined;
      const next = await library.updateShelf((shelf) => {
        existing = shelf.find((candidate) => candidate.fingerprint === print);
        return upsertByFingerprint(shelf, entry);
      });
      if (existing !== undefined && existing.grant !== picked.grant) {
        try {
          await client.files.release({ grant: existing.grant });
        } catch {
          // The grant may already be gone; the Shelf still keeps the new one.
        }
      }
      return next.find((candidate) => candidate.fingerprint === print) ?? entry;
    },

    async refreshStates(): Promise<ShelfEntry[]> {
      const shelf = await library.loadShelf();
      // Stat every grant first, then apply the states to the Shelf as it is
      // then: an Import may have added Documents while the stats ran.
      const states = new Map<string, { grant: string; state: DocumentState; reason?: string }>();
      for (const entry of shelf) {
        try {
          await client.files.stat({ grant: entry.grant });
          states.set(entry.id, { grant: entry.grant, state: "ok" });
        } catch (error) {
          const code = errorCode(error);
          const state: DocumentState =
            code === "file-missing"
              ? "missing"
              : code === "file-needs-permission"
                ? "needs-permission"
                : "unreadable";
          states.set(entry.id, { grant: entry.grant, state, reason: errorMessage(error) });
        }
      }
      return library.updateShelf((current) => {
        let next = current;
        for (const entry of current) {
          const found = states.get(entry.id);
          // A Document relinked since its stat keeps the state its new grant earned.
          if (found === undefined || found.grant !== entry.grant) continue;
          next = markState(next, entry.id, found.state, found.reason);
        }
        return next;
      });
    },

    async removalCounts(id): Promise<RemovalCounts> {
      const bookmarks = await storedArray(client, bookmarksKey(id));
      const highlights = await storedArray(client, highlightsKey(id));
      return {
        bookmarks: bookmarks.length,
        highlights: highlights.length,
        notes: highlights.filter(hasNote).length,
      };
    },

    async removeFromShelf(id): Promise<ShelfEntry[]> {
      const shelf = await library.loadShelf();
      const entry = shelf.find((candidate) => candidate.id === id);
      if (entry !== undefined) {
        try {
          await client.files.release({ grant: entry.grant });
        } catch {
          // The grant may already be gone; forgetting the Document still works.
        }
      }
      for (const key of [positionKey(id), bookmarksKey(id), highlightsKey(id)]) {
        try {
          await client.storage.delete({ key });
        } catch {
          // A key that never existed needs no delete.
        }
      }
      const next = await library.updateShelf((current) => removeEntry(current, id));
      try {
        const collections = await library.loadCollections();
        if (collections.some((collection) => collection.documentIds.includes(id))) {
          await writeCollections(
            collections.map((collection) => ({
              ...collection,
              documentIds: collection.documentIds.filter((documentId) => documentId !== id),
            }))
          );
        }
      } catch {
        // The Shelf removal already happened, and the Frame counts only Documents still
        // on the Shelf, so a Collection that keeps the id is harmless until the next write.
      }
      return next;
    },

    async locateAgain(id): Promise<LocateAgainResult> {
      const picked = await client.files.pick({ extensions: [...SUPPORTED_EXTENSIONS] });
      if (picked === null) return { ok: false, reason: "cancelled" };
      const { print } = await fingerprintBytes(client, picked.grant, picked.size);
      const seen: {
        shelf: ShelfEntry[];
        missing?: ShelfEntry;
        result: ReturnType<typeof reattach>;
      } = { shelf: [], result: { ok: false, reason: "not-found" } };
      await library.updateShelf((current) => {
        seen.shelf = current;
        seen.missing = current.find((candidate) => candidate.id === id);
        seen.result = reattach(current, id, print, picked.grant);
        return seen.result.ok ? seen.result.shelf : null;
      });
      const { shelf, missing: missingEntry, result } = seen;
      if (!result.ok) {
        // Another Document may hold the same grant: picking its file again
        // returns its grant id, and releasing it would break that Document.
        if (!shelf.some((candidate) => candidate.grant === picked.grant)) {
          try {
            await client.files.release({ grant: picked.grant });
          } catch {
            // The grant may already be gone; the Missing Document stays as it was.
          }
        }
        return { ok: false, reason: result.reason };
      }
      if (missingEntry !== undefined && missingEntry.grant !== picked.grant) {
        try {
          await client.files.release({ grant: missingEntry.grant });
        } catch {
          // The old grant may already be gone; the reattach already saved.
        }
      }
      return { ok: true, entry: result.entry };
    },

    async reopen(id): Promise<boolean> {
      const shelf = await library.loadShelf();
      const entry = shelf.find((candidate) => candidate.id === id);
      if (entry === undefined) return false;
      let allowed = false;
      try {
        allowed = await client.files.requestAccess({ grant: entry.grant });
      } catch {
        return false;
      }
      if (!allowed) return false;
      await library.updateShelf((current) => markState(current, id, "ok"));
      return true;
    },
  };
  return library;
}
