import { useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LogOut, RefreshCw } from "lucide-react";
import { Button } from "../ui/Button";
import { useSyncStore } from "../../features/sync/store";

interface SyncPanelProps {
  onClose: () => void;
  onSync: () => Promise<void>;
}

export function SyncPanel({ onClose, onSync }: SyncPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const {
    userEmail,
    syncStatus,
    lastSyncedAt,
    syncError,
    logout,
  } = useSyncStore();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const handleSync = async () => {
    try {
      await onSync();
    } catch {
      // Error is already set in the store
    }
  };

  const handleLogout = () => {
    logout();
    onClose();
  };

  const formatLastSynced = (): string => {
    if (!lastSyncedAt) return t("sync.neverSynced");
    const date = new Date(lastSyncedAt * 1000);
    return t("sync.lastSynced", {
      time: date.toLocaleString(),
    });
  };

  return (
    <div
      ref={panelRef}
      className="absolute top-full right-0 mt-1 z-50 w-72 bg-background border border-border rounded-xl shadow-xl overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <p className="text-sm font-medium truncate">{userEmail}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatLastSynced()}
        </p>
      </div>

      {/* Error */}
      {syncError && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-xs">
          {syncError}
        </div>
      )}

      {/* Actions */}
      <div className="p-3 space-y-2">
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          onClick={handleSync}
          disabled={syncStatus === "syncing"}
        >
          <RefreshCw
            className={`w-4 h-4 ${syncStatus === "syncing" ? "animate-spin" : ""}`}
          />
          {syncStatus === "syncing"
            ? t("sync.syncing")
            : t("sync.syncAll")}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={handleLogout}
        >
          <LogOut className="w-4 h-4" />
          {t("sync.logout")}
        </Button>
      </div>
    </div>
  );
}
