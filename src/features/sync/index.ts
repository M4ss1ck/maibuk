export { useSyncStore } from "@/features/sync/store";
export { useSyncFlow } from "@/features/sync/useSyncFlow";
export {
  encrypt,
  decrypt,
  computeChecksum,
  setPassphrase,
  getPassphrase,
  clearPassphrase,
  SyncCryptoError,
  isSyncCryptoError,
} from "@/features/sync/crypto";
export { serializeBook, applyBookSnapshot } from "@/features/sync/serializer";
export { syncBook, syncAllBooks } from "@/features/sync/sync-engine";
export {
  recordTombstone,
  listPendingTombstones,
  confirmTombstones,
  markTombstonePushed,
  hasTombstone,
} from "@/features/sync/tombstones";
export type {
  AuthStatus,
  SyncStatus,
  SyncItemMeta,
  BookSnapshot,
  NoteSnapshot,
  SyncOptions,
  SyncScope,
  SyncDirection,
  SyncLogEntry,
  SyncDeletionReviewItem,
  SyncTombstone,
} from "@/features/sync/types";
