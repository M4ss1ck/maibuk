import { useCallback, useState } from "react";
import { getPassphrase } from "./crypto";
import { useSyncStore } from "./store";

export function useSyncFlow() {
  const { syncAll } = useSyncStore();
  const [showPassphraseDialog, setShowPassphraseDialog] = useState(false);
  const [pendingSyncAfterPassphrase, setPendingSyncAfterPassphrase] = useState(false);

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

    await syncAll(passphrase);
    return true;
  }, [requestPassphraseForSync, syncAll]);

  const completePassphraseFlow = useCallback(async () => {
    setShowPassphraseDialog(false);

    if (!pendingSyncAfterPassphrase) return false;

    const passphrase = getPassphrase();
    if (!passphrase) {
      setPendingSyncAfterPassphrase(false);
      return false;
    }

    try {
      await syncAll(passphrase);
      return true;
    } catch {
      return false;
    } finally {
      setPendingSyncAfterPassphrase(false);
    }
  }, [pendingSyncAfterPassphrase, syncAll]);

  return {
    showPassphraseDialog,
    closePassphraseDialog,
    requestPassphraseForSync,
    syncAllWithSessionPassphrase,
    completePassphraseFlow,
  };
}
