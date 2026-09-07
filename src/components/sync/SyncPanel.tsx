import { useTranslation } from "react-i18next";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSyncStore } from "@/features/sync/store";
import type { SyncOptions } from "@/features/sync/types";
import { SyncControls } from "@/components/sync/SyncControls";
import { timeAgo } from "@/components/notes/timeAgo";
import { Tooltip } from "@/components/ui";

interface SyncPanelProps {
  onClose: () => void;
  onSync: (options?: Partial<SyncOptions>) => Promise<void>;
}

export function SyncPanel({ onClose, onSync }: SyncPanelProps) {
  const { t, i18n } = useTranslation();
  const { userEmail, lastSyncedAt, syncError, logout } = useSyncStore();

  const handleLogout = () => {
    logout();
    onClose();
  };

  const formatLastSynced = (tooltip = false): string => {
    if (!lastSyncedAt) return t("sync.neverSynced");
    if (tooltip) return new Date(lastSyncedAt * 1000).toLocaleString();
    return t("sync.lastSynced", {
      time: timeAgo(lastSyncedAt, i18n.language, t),
    });
  };

  return (
    <div>
      <div className="px-4 py-3 border-b border-border">
        <p className="text-sm font-medium truncate">{userEmail}</p>
        <Tooltip content={formatLastSynced(true)}>
          <p className="text-xs text-muted-foreground mt-0.5">{formatLastSynced()}</p>
        </Tooltip>
      </div>

      {syncError && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-xs">{syncError}</div>
      )}

      <div className="p-3 space-y-3">
        <SyncControls onSync={onSync} />

        <Button variant="destructive" size="sm" className="w-full" onClick={handleLogout}>
          <LogOut className="w-4 h-4" />
          {t("sync.logout")}
        </Button>
      </div>
    </div>
  );
}
