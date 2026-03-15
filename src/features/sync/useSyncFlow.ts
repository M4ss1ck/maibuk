import { useCallback, useState, useRef } from "react";
import { getPassphrase } from "./crypto";
import { useSyncStore } from "./store";
import type { SyncConflict, ConflictResolver } from "./types";

export function useSyncFlow() {
  const { syncAll } = useSyncStore();
  const [showPassphraseDialog, setShowPassphraseDialog] = useState(false);
  const [pendingSyncAfterPassphrase, setPendingSyncAfterPassphrase] = useState(false);
  const [activeConflict, setActiveConflict] = useState<SyncConflict | null>(null);
  const conflictResolverRef = useRef<((choice: "push" | "pull" | "cancel") => void) | null>(null);

  const onConflict: ConflictResolver = useCallback((conflict) => {
    return new Promise((resolve) => {
      setActiveConflict(conflict);
      conflictResolverRef.current = resolve;
      useSyncStore.setState({ syncStatus: "awaiting-confirmation" });
    });
  }, []);

  const resolveConflict = useCallback((choice: "push" | "pull" | "cancel") => {
    conflictResolverRef.current?.(choice);
    conflictResolverRef.current = null;
    setActiveConflict(null);
    // Only resume "syncing" status for push/pull. On cancel, the sync engine
    // returns "cancelled" and the store sets the final status itself.
    if (choice !== "cancel") {
      useSyncStore.setState({ syncStatus: "syncing" });
    }
  }, []);

  const closePassphraseDialog = useCallback(() => {
    setShowPassphraseDialog(false);
    setPendingSyncAfterPassphrase(false);
  }, []);

  const requestPassphraseForSync = useCallback(() => {
    setPendingSyncAfterPassphrase(true);
    setShowPassphraseDialog(true);
  }, []);

  const syncAllWithSessionPassphrase = useCallback(async () => {
    const passphrase = getPassphrase();
    if (!passphrase) {
      requestPassphraseForSync();
      return false;
    }

    await syncAll(passphrase, onConflict);
    return true;
  }, [requestPassphraseForSync, syncAll, onConflict]);

  const completePassphraseFlow = useCallback(async () => {
    setShowPassphraseDialog(false);

    if (!pendingSyncAfterPassphrase) return false;

    const passphrase = getPassphrase();
    if (!passphrase) {
      setPendingSyncAfterPassphrase(false);
      return false;
    }

    try {
      await syncAll(passphrase, onConflict);
      return true;
    } catch {
      return false;
    } finally {
      setPendingSyncAfterPassphrase(false);
    }
  }, [pendingSyncAfterPassphrase, syncAll, onConflict]);

  return {
    showPassphraseDialog,
    closePassphraseDialog,
    requestPassphraseForSync,
    syncAllWithSessionPassphrase,
    completePassphraseFlow,
    activeConflict,
    resolveConflict,
    onConflict,
  };
}
