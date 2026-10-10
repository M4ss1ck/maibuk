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
export {
  serializeBook,
  applyBookSnapshot,
  serializeNote,
  applyNoteSnapshot,
  serializeCanvas,
  applyCanvasSnapshot,
} from "@/features/sync/serializer";
export {
  emitChange,
  isBulkSignal,
  isEntityChange,
  isLibraryAvailability,
  onChange,
  resetChangeFeedForTests,
  STORE_VIEW,
} from "@/features/sync/change-feed";
export type {
  BulkSignal,
  BulkReason,
  Change,
  ChangeEntity,
  ChangeFeedMeta,
  ChangeFeedSignal,
  ChangeKind,
  ChangeOrigin,
  LibraryAvailability,
} from "@/features/sync/change-feed";
export {
  installViewRefresh,
  resetViewRefreshForTests,
} from "@/features/sync/view-refresh";
export {
  syncBook,
  syncSingleNote,
  syncAllBooks,
  resetSyncEngineForTests,
} from "@/features/sync/sync-engine";
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
  CanvasSnapshot,
  SyncOptions,
  SyncScope,
  SyncDirection,
  SyncLogEntry,
  SyncDeletionReviewItem,
  SyncTombstone,
} from "@/features/sync/types";
