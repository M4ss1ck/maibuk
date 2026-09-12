// Three-way sync decision for one book or note. Pure: the engine gathers the
// checksums and timestamps, this decides.
//
// The base is what this device last agreed with the server on: the local
// checksum right after the last successful sync of the item, and the remote
// checksum it saw or produced at that moment. Both are kept because a pulled
// snapshot re-serialized locally need not byte-match the blob another device
// pushed; comparing each side against its own last-known value is what lets a
// change made on only one side flow without asking.
import type { SyncDirection } from "@/features/sync/types";

export interface SyncBase {
  localChecksum: string;
  remoteChecksum: string;
}

export type SyncDecision =
  /** Local and remote are identical. */
  | "in-sync"
  /** Neither side changed since the base, though their bytes differ. */
  | "unchanged"
  | "push"
  | "pull"
  /** Both sides changed, or there is no base and the remote looks newer. */
  | "conflict";

export interface SyncDecisionInput {
  localChecksum: string;
  remoteChecksum: string;
  base: SyncBase | null;
  direction: SyncDirection;
  /** Unix seconds; only consulted without a base (legacy last-write-wins). */
  localUpdatedAt: number;
  remoteUpdatedAt: number;
}

export function decideSyncAction({
  localChecksum,
  remoteChecksum,
  base,
  direction,
  localUpdatedAt,
  remoteUpdatedAt,
}: SyncDecisionInput): SyncDecision {
  if (localChecksum === remoteChecksum) return "in-sync";
  if (direction === "push") return "push";
  if (direction === "pull") return "pull";

  if (base) {
    const localChanged = localChecksum !== base.localChecksum;
    const remoteChanged = remoteChecksum !== base.remoteChecksum;
    if (localChanged && remoteChanged) return "conflict";
    if (localChanged) return "push";
    if (remoteChanged) return "pull";
    return "unchanged";
  }

  // No base yet (never synced on this device since base tracking shipped):
  // keep the previous rules. A strictly newer local copy wins; anything else
  // needs a decision.
  return localUpdatedAt > remoteUpdatedAt ? "push" : "conflict";
}
