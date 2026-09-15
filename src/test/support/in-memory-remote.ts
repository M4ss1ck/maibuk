// In-memory Remote port for Entity Sync tests. Honours the same contract as
// the production PocketBase adapter: list hides soft-deleted rows, deleted
// rows keep their identity (pushing the same key restores the row instead of
// creating a second one), pulls return the stored bytes. Test-only.
import type {
  EntityRemote,
  EntityRemoteKind,
  RemoteBlob,
  RemoteItemMeta,
} from "@/features/sync/remote-port";
import type { RemoteDeletionMeta } from "@/features/sync/types";

interface StoredObject {
  remoteId: string;
  entityId: string;
  data: Uint8Array;
  checksum: string;
  updatedAt: number;
  deleted: boolean;
}

export class InMemoryRemote implements EntityRemote {
  private objects = new Map<string, StoredObject>();
  private clock: number;
  readonly pushed: Array<{ kind: EntityRemoteKind; entityId: string; remoteId?: string }> = [];
  readonly pulled: Array<{ kind: EntityRemoteKind; entityId: string; remoteId?: string }> = [];
  readonly deleted: Array<{ kind: EntityRemoteKind; entityId: string }> = [];

  constructor(startClock = 1000) {
    this.clock = startClock;
  }

  private key(kind: EntityRemoteKind, entityId: string): string {
    return `${kind}:${entityId}`;
  }

  private tick(): number {
    this.clock += 1;
    return this.clock;
  }

  /** Seed a live remote row (e.g. encrypted with the test passphrase). */
  seedLive(
    kind: EntityRemoteKind,
    entityId: string,
    data: Uint8Array,
    checksum: string,
    updatedAt?: number
  ): void {
    this.objects.set(this.key(kind, entityId), {
      remoteId: `remote-${kind}-${entityId}`,
      entityId,
      data,
      checksum,
      updatedAt: updatedAt ?? this.tick(),
      deleted: false,
    });
  }

  /** Seed a soft-deleted remote row (Deleted Elsewhere). */
  seedDeleted(kind: EntityRemoteKind, entityId: string, updatedAt?: number): void {
    this.objects.set(this.key(kind, entityId), {
      remoteId: `remote-${kind}-${entityId}`,
      entityId,
      data: new Uint8Array(),
      checksum: "",
      updatedAt: updatedAt ?? this.tick(),
      deleted: true,
    });
  }

  getObject(kind: EntityRemoteKind, entityId: string): StoredObject | undefined {
    return this.objects.get(this.key(kind, entityId));
  }

  async list(kind: EntityRemoteKind): Promise<RemoteItemMeta[]> {
    const out: RemoteItemMeta[] = [];
    for (const [key, row] of this.objects) {
      if (!key.startsWith(`${kind}:`) || row.deleted) continue;
      out.push({
        remoteId: row.remoteId,
        entityId: row.entityId,
        checksum: row.checksum,
        updatedAt: row.updatedAt,
      });
    }
    return out;
  }

  async listDeleted(kind: EntityRemoteKind): Promise<RemoteDeletionMeta[]> {
    const out: RemoteDeletionMeta[] = [];
    for (const [key, row] of this.objects) {
      if (!key.startsWith(`${kind}:`) || !row.deleted) continue;
      out.push({ remoteId: row.remoteId, entityId: row.entityId, updatedAt: row.updatedAt });
    }
    return out;
  }

  async pullBlob(
    kind: EntityRemoteKind,
    entityId: string,
    remoteId?: string
  ): Promise<RemoteBlob | null> {
    this.pulled.push({ kind, entityId, remoteId });
    const row = this.objects.get(this.key(kind, entityId));
    if (!row || row.deleted) return null;
    // Mirror client.ts: the remoteId fast path skips the listing and returns no checksum.
    return { data: row.data, checksum: remoteId ? "" : row.checksum };
  }

  async pushBlob(
    kind: EntityRemoteKind,
    entityId: string,
    data: Blob,
    checksum: string,
    remoteId?: string
  ): Promise<void> {
    this.pushed.push({ kind, entityId, remoteId });
    const buffer = new Uint8Array(await data.arrayBuffer());
    const existing = this.objects.get(this.key(kind, entityId));
    // Updating a soft-deleted row restores it — the key identity is kept, the
    // same rule the server enforces with validation_not_unique on re-create.
    this.objects.set(this.key(kind, entityId), {
      remoteId: existing?.remoteId ?? `remote-${kind}-${entityId}`,
      entityId,
      data: buffer,
      checksum,
      updatedAt: this.tick(),
      deleted: false,
    });
  }

  async deleteRemote(kind: EntityRemoteKind, entityId: string): Promise<void> {
    this.deleted.push({ kind, entityId });
    const existing = this.objects.get(this.key(kind, entityId));
    this.objects.set(this.key(kind, entityId), {
      remoteId: existing?.remoteId ?? `remote-${kind}-${entityId}`,
      entityId,
      data: existing?.data ?? new Uint8Array(),
      checksum: existing?.checksum ?? "",
      updatedAt: this.tick(),
      deleted: true,
    });
  }
}
