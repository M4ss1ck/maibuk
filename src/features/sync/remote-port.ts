// Remote port for Entity Sync: the narrow interface over the sync server that
// the generic entity flow speaks. The production adapter wraps the PocketBase
// client functions; tests use the in-memory adapter under src/test/support/.
// Versions and metrics stay their own modules (ADR 0007) and may share only
// this port — they are not part of the adapter shape.
import {
  deleteRemoteBook,
  deleteRemoteCanvas,
  deleteRemoteNote,
  listRemoteBooks,
  listRemoteCanvases,
  listRemoteDeletedBooks,
  listRemoteDeletedCanvases,
  listRemoteDeletedNotes,
  listRemoteNotes,
  pullBookBlob,
  pullCanvasBlob,
  pullNoteBlob,
  pushBookBlob,
  pushCanvasBlob,
  pushNoteBlob,
} from "@/features/sync/client";
import type { RemoteDeletionMeta } from "@/features/sync/types";

export type EntityRemoteKind = "book" | "note" | "canvas";

export interface RemoteItemMeta {
  remoteId: string;
  entityId: string;
  checksum: string;
  updatedAt: number;
}

export interface RemoteBlob {
  data: Uint8Array;
  checksum: string;
}

export interface EntityRemote {
  list(kind: EntityRemoteKind): Promise<RemoteItemMeta[]>;
  listDeleted(kind: EntityRemoteKind): Promise<RemoteDeletionMeta[]>;
  pullBlob(
    kind: EntityRemoteKind,
    entityId: string,
    remoteId?: string
  ): Promise<RemoteBlob | null>;
  pushBlob(
    kind: EntityRemoteKind,
    entityId: string,
    data: Blob,
    checksum: string,
    remoteId?: string
  ): Promise<void>;
  deleteRemote(kind: EntityRemoteKind, entityId: string): Promise<void>;
}

function toItemMeta(
  row: { remoteId: string; checksum: string; updatedAt: number },
  entityId: string
): RemoteItemMeta {
  return {
    remoteId: row.remoteId,
    entityId,
    checksum: row.checksum,
    updatedAt: row.updatedAt,
  };
}

/** Production adapter: the same client functions the engine always called. */
export const pocketBaseRemote: EntityRemote = {
  async list(kind) {
    if (kind === "book") {
      return (await listRemoteBooks()).map((row) => toItemMeta(row, row.bookId));
    }
    if (kind === "note") {
      return (await listRemoteNotes()).map((row) => toItemMeta(row, row.noteId));
    }
    return (await listRemoteCanvases()).map((row) => toItemMeta(row, row.canvasId));
  },

  async listDeleted(kind) {
    if (kind === "book") return listRemoteDeletedBooks();
    if (kind === "note") return listRemoteDeletedNotes();
    return listRemoteDeletedCanvases();
  },

  async pullBlob(kind, entityId, remoteId) {
    const pulled =
      kind === "book"
        ? await pullBookBlob(entityId, remoteId)
        : kind === "note"
          ? await pullNoteBlob(entityId, remoteId)
          : await pullCanvasBlob(entityId, remoteId);
    return pulled ? { data: pulled.data, checksum: pulled.checksum } : null;
  },

  async pushBlob(kind, entityId, data, checksum, remoteId) {
    // A local-only item has no remote row yet: create it (no remoteId argument).
    if (kind === "book") {
      if (remoteId === undefined) {
        await pushBookBlob(entityId, data, checksum);
      } else {
        await pushBookBlob(entityId, data, checksum, remoteId);
      }
    } else if (kind === "note") {
      if (remoteId === undefined) {
        await pushNoteBlob(entityId, data, checksum);
      } else {
        await pushNoteBlob(entityId, data, checksum, remoteId);
      }
    } else {
      if (remoteId === undefined) {
        await pushCanvasBlob(entityId, data, checksum);
      } else {
        await pushCanvasBlob(entityId, data, checksum, remoteId);
      }
    }
  },

  async deleteRemote(kind, entityId) {
    if (kind === "book") {
      await deleteRemoteBook(entityId);
    } else if (kind === "note") {
      await deleteRemoteNote(entityId);
    } else {
      await deleteRemoteCanvas(entityId);
    }
  },
};
