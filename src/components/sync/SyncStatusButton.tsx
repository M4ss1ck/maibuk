import { useState, useRef } from "react";
import { Cloud, CloudOff, Loader2, CloudAlert, AlertTriangle } from "lucide-react";
import { useSyncStore } from "../../features/sync/store";
import { useSyncFlow } from "../../features/sync/useSyncFlow";
import { AuthDialog } from "./AuthDialog";
import { SyncPanel } from "./SyncPanel";
import { PassphraseDialog } from "./PassphraseDialog";
import { ConflictDialog } from "./ConflictDialog";

export function SyncStatusButton() {
  const { authStatus, syncStatus } = useSyncStore();
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const {
    showPassphraseDialog,
    closePassphraseDialog,
    syncAllWithSessionPassphrase,
    completePassphraseFlow,
    activeConflict,
    resolveConflict,
  } = useSyncFlow();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    if (authStatus === "logged-out") {
      setShowAuthDialog(true);
    } else {
      setShowSyncPanel((prev) => !prev);
    }
  };

  const renderIcon = () => {
    if (authStatus === "logged-out") {
      return <CloudOff className="w-5 h-5" />;
    }
    if (syncStatus === "awaiting-confirmation") {
      return <AlertTriangle className="w-5 h-5" />;
    }
    if (syncStatus === "cancelled") {
      return <AlertTriangle className="w-5 h-5" />;
    }
    if (syncStatus === "syncing") {
      return <Loader2 className="w-5 h-5 animate-spin" />;
    }
    if (syncStatus === "partial") {
      return <CloudAlert className="w-5 h-5" />;
    }
    if (syncStatus === "error") {
      return <CloudAlert className="w-5 h-5" />;
    }
    return <Cloud className="w-5 h-5" />;
  };

  const statusClass =
    authStatus === "logged-out"
      ? "text-muted-foreground"
      : syncStatus === "awaiting-confirmation"
        ? "text-warning-text"
        : syncStatus === "cancelled"
          ? "text-warning-text"
        : syncStatus === "syncing"
          ? "text-primary"
          : syncStatus === "partial"
            ? "text-warning-text"
          : syncStatus === "error"
            ? "text-destructive"
            : syncStatus === "success"
              ? "text-success"
              : "text-muted-foreground";

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleClick}
        className={`p-2 rounded transition-colors hover:bg-muted ${statusClass}`}
        aria-label="Sync status"
      >
        {renderIcon()}
      </button>

      {showSyncPanel && (
        <SyncPanel
          onClose={() => setShowSyncPanel(false)}
          onSync={async () => {
            const didSync = await syncAllWithSessionPassphrase();
            if (!didSync) {
              setShowSyncPanel(false);
            }
          }}
        />
      )}

      <AuthDialog
        isOpen={showAuthDialog}
        onClose={() => setShowAuthDialog(false)}
      />

      <PassphraseDialog
        isOpen={showPassphraseDialog}
        onClose={() => {
          closePassphraseDialog();
        }}
        onSuccess={async () => {
          const didSync = await completePassphraseFlow();
          setShowSyncPanel(true);

          if (!didSync) {
            closePassphraseDialog();
          }
        }}
      />

      {activeConflict && (
        <ConflictDialog
          conflict={activeConflict}
          onResolve={resolveConflict}
        />
      )}
    </div>
  );
}
