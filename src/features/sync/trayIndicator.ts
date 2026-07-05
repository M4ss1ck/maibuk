import { useSyncStore } from "@/features/sync/store";
import { setTraySyncing } from "@/lib/platform";

let installed = false;

// Mirror the sync store's syncing state onto the tray icon. Installed once at
// app startup; a failed icon swap must never surface into the sync flow, so
// bridge errors are swallowed.
export function installTraySyncIndicator(): void {
  if (installed) return;
  installed = true;
  useSyncStore.subscribe((state, prevState) => {
    const isSyncing = state.syncStatus === "syncing";
    const wasSyncing = prevState.syncStatus === "syncing";
    if (isSyncing !== wasSyncing) {
      setTraySyncing(isSyncing).catch(() => {});
    }
  });
}
