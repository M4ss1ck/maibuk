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
  FINGERPRINT_WINDOW,
  SETTINGS_KEY,
  SHELF_KEY,
  SUPPORTED_EXTENSIONS,
  clampSettings,
  fingerprint,
  formatFromName,
  markState,
  parseShelf,
  positionKey,
  reattach,
  removeEntry,
  sniffFormat,
  sortShelf,
  titleFromName,
  upsertByFingerprint,
  type DocumentFormat,
  type DocumentState,
  type ReaderSettings,
  type ShelfEntry,
} from "./shelf";

/** The SDK surface the Shelf service needs. */
export type ReaderClient = Pick<PluginClient, "files" | "storage">;

/** What locating a Missing Document found. */
export type LocateAgainResult =
  | { ok: true; entry: ShelfEntry }
  | { ok: false; reason: "cancelled" | "not-found" | "fingerprint-mismatch" };

/** The error code the host puts on a refused File Grant call. */
function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A stable, Plugin-local id for a new Document. */
function newDocumentId(): string {
  const random = globalThis.crypto?.randomUUID;
  if (typeof random === "function") return random.call(globalThis.crypto);
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The head and tail bytes a Fingerprint hashes, read in two calls. */
async function fingerprintBytes(
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
  saveShelf(shelf: readonly ShelfEntry[]): Promise<void>;
  loadSettings(): Promise<ReaderSettings>;
  saveSettings(settings: ReaderSettings): Promise<void>;
  /** Picks a file, fingerprints it, and adds it to the Shelf or finds its Document. */
  openFileFlow(): Promise<ShelfEntry | null>;
  /** Marks every Document the device can no longer read, and returns the Shelf. */
  refreshStates(): Promise<ShelfEntry[]>;
  /** Forgets a Document and ends its File Grant; the author's file stays. */
  removeFromShelf(id: string): Promise<ShelfEntry[]>;
  /** Picks a file again for a Missing Document, keeping its Reading Position on a match. */
  locateAgain(id: string): Promise<LocateAgainResult>;
  /** Asks the browser for read access again; desktop always says yes. */
  reopen(id: string): Promise<boolean>;
}

export function createShelfService(client: ReaderClient): ShelfService {
  const library: ShelfService = {
    async loadShelf(): Promise<ShelfEntry[]> {
      try {
        return sortShelf(parseShelf(await client.storage.get({ key: SHELF_KEY })));
      } catch {
        return [];
      }
    },

    async saveShelf(shelf): Promise<void> {
      await client.storage.set({ key: SHELF_KEY, value: shelf });
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

    async openFileFlow(): Promise<ShelfEntry | null> {
      const picked = await client.files.pick({ extensions: [...SUPPORTED_EXTENSIONS] });
      if (picked === null) return null;
      const { head, print } = await fingerprintBytes(client, picked.grant, picked.size);
      const format: DocumentFormat | null =
        sniffFormat(head, picked.name) ?? formatFromName(picked.name);
      if (format === null) {
        try {
          await client.files.release({ grant: picked.grant });
        } catch {
          // The grant may already be gone; the throw below still surfaces.
        }
        throw new Error(`Reader cannot open ${picked.name}`);
      }
      const entry: ShelfEntry = {
        id: newDocumentId(),
        grant: picked.grant,
        fingerprint: print,
        title: titleFromName(picked.name),
        author: "",
        format,
        lastReadAt: Date.now(),
        progress: null,
        state: "ok",
      };
      const shelf = await library.loadShelf();
      const existing = shelf.find((candidate) => candidate.fingerprint === print);
      const next = upsertByFingerprint(shelf, entry);
      await library.saveShelf(next);
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
      let next = shelf;
      for (const entry of shelf) {
        try {
          await client.files.stat({ grant: entry.grant });
          next = markState(next, entry.id, "ok");
        } catch (error) {
          const code = errorCode(error);
          const state: DocumentState =
            code === "file-missing"
              ? "missing"
              : code === "file-needs-permission"
                ? "needs-permission"
                : "unreadable";
          next = markState(next, entry.id, state, errorMessage(error));
        }
      }
      await library.saveShelf(next);
      return next;
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
      try {
        await client.storage.delete({ key: positionKey(id) });
      } catch {
        // A Position that never existed needs no delete.
      }
      const next = removeEntry(shelf, id);
      await library.saveShelf(next);
      return next;
    },

    async locateAgain(id): Promise<LocateAgainResult> {
      const picked = await client.files.pick({ extensions: [...SUPPORTED_EXTENSIONS] });
      if (picked === null) return { ok: false, reason: "cancelled" };
      const { print } = await fingerprintBytes(client, picked.grant, picked.size);
      const shelf = await library.loadShelf();
      const missingEntry = shelf.find((candidate) => candidate.id === id);
      const result = reattach(shelf, id, print, picked.grant);
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
      await library.saveShelf(result.shelf);
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
      await library.saveShelf(markState(shelf, id, "ok"));
      return true;
    },
  };
  return library;
}
