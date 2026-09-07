import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { Cloud, CloudOff, CloudUpload, Loader2, CloudAlert, AlertTriangle } from "lucide-react";
import { useSyncStore } from "@/features/sync/store";
import { useBookStore } from "@/features/books/store";
import { useSyncFlow } from "@/features/sync/useSyncFlow";
import { AuthDialog } from "@/components/sync/AuthDialog";
import { SyncPanel } from "@/components/sync/SyncPanel";
import { PassphraseDialog } from "@/components/sync/PassphraseDialog";
import { ConflictDialog } from "@/components/sync/ConflictDialog";
import type { SyncOptions } from "@/features/sync/types";

export function SyncStatusButton() {
  const { t } = useTranslation();
  const { authStatus, syncStatus, lastSyncedAt } = useSyncStore();
  const { books } = useBookStore();
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [showSyncPanel, setShowSyncPanel] = useState(false);

  const hasPendingChanges =
    authStatus === "logged-in" &&
    lastSyncedAt != null &&
    books.some((b) => Math.floor(b.updatedAt.getTime() / 1000) > lastSyncedAt);
  const {
    showPassphraseDialog,
    closePassphraseDialog,
    syncAllWithSessionPassphrase,
    completePassphraseFlow,
    activeConflict,
    resolveConflict,
  } = useSyncFlow();

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && authStatus === "logged-out") {
      setShowAuthDialog(true);
      return;
    }
    setShowSyncPanel(isOpen);
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
    if (hasPendingChanges) {
      return <CloudUpload className="w-5 h-5" />;
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
                  : hasPendingChanges
                    ? "text-primary"
                    : lastSyncedAt
                      ? "text-success"
                      : "text-muted-foreground";

  return (
    <>
      <DialogTrigger isOpen={showSyncPanel} onOpenChange={handleOpenChange}>
        <Button
          aria-label={t("sync.syncStatus")}
          className={`p-2 rounded transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${statusClass}`}
        >
          {renderIcon()}
        </Button>

        <Popover
          placement="bottom end"
          className="z-50 mt-1 max-h-[calc(100dvh-1rem)] w-96 max-w-[calc(100vw-1rem)] overflow-auto rounded-xl border border-border bg-background shadow-xl focus:outline-none"
        >
          <Dialog aria-label={t("sync.syncStatus")} className="outline-none">
            <SyncPanel
              onClose={() => setShowSyncPanel(false)}
              onSync={async (options?: Partial<SyncOptions>) => {
                const didSync = await syncAllWithSessionPassphrase(options);
                if (!didSync) {
                  setShowSyncPanel(false);
                }
              }}
            />
          </Dialog>
        </Popover>
      </DialogTrigger>

      <AuthDialog isOpen={showAuthDialog} onClose={() => setShowAuthDialog(false)} />

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

      {activeConflict && <ConflictDialog conflict={activeConflict} onResolve={resolveConflict} />}
    </>
  );
}
