import { useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LogOut } from "lucide-react";
import { Button } from "../ui/Button";
import { useSyncStore } from "../../features/sync/store";
import type { SyncOptions } from "../../features/sync/types";
import { SyncControls } from "./SyncControls";
import { timeAgo } from "../../components/notes/timeAgo";

interface SyncPanelProps {
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSync: (options?: Partial<SyncOptions>) => Promise<void>;
}

export function SyncPanel({ triggerRef, onClose, onSync }: SyncPanelProps) {
  const { t, i18n } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const { userEmail, lastSyncedAt, syncError, logout } = useSyncStore();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target;
      if (!panelRef.current || !(target instanceof Node)) {
        return;
      }
      if (panelRef.current.contains(target)) {
        return;
      }
      if (triggerRef.current && target instanceof Node && triggerRef.current.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest('[role="listbox"], [role="option"]')) {
        return;
      }

      onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

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
    <div
      ref={panelRef}
      className="absolute top-full right-0 mt-1 z-50 w-96 max-w-[calc(100vw-1rem)] bg-background border border-border rounded-xl shadow-xl overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-border">
        <p className="text-sm font-medium truncate">{userEmail}</p>
        <p className="text-xs text-muted-foreground mt-0.5" title={formatLastSynced(true)}>
          {formatLastSynced()}
        </p>
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
