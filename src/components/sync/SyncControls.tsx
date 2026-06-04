import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ListChecks, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { useSyncStore } from "../../features/sync/store";
import type { SyncDirection, SyncOptions, SyncScope } from "../../features/sync/types";

interface SyncControlsProps {
  onSync: (options?: Partial<SyncOptions>) => Promise<void>;
  layout?: "popover" | "settings";
}

export function SyncControls({ onSync, layout = "popover" }: SyncControlsProps) {
  const { t } = useTranslation();
  const {
    syncStatus,
    pendingDeletions,
    syncLog,
    confirmPendingDeletions,
    clearSyncLog,
  } = useSyncStore();
  const [scope, setScope] = useState<SyncScope>("all");
  const [direction, setDirection] = useState<SyncDirection>("bidirectional");
  const [isLogOpen, setIsLogOpen] = useState(true);
  const isSettingsLayout = layout === "settings";

  const scopeOptions = useMemo(
    () => [
      { value: "all" as const, label: t("sync.scopeAll") },
      { value: "books" as const, label: t("sync.scopeBooks") },
      { value: "notes" as const, label: t("sync.scopeNotes") },
      { value: "metrics" as const, label: t("sync.scopeMetrics") },
    ],
    [t]
  );

  const directionOptions = useMemo(
    () => [
      { value: "bidirectional" as const, label: t("sync.directionBidirectional") },
      { value: "pull" as const, label: t("sync.directionPull") },
      { value: "push" as const, label: t("sync.directionPush") },
    ],
    [t]
  );

  const handleSync = async () => {
    try {
      await onSync({ scope, direction });
    } catch {
      // Error is already set in the store.
    }
  };

  const handleConfirmDeletions = async () => {
    const ids = pendingDeletions.map((item) => item.id);
    await confirmPendingDeletions(ids);
    await onSync({ scope, direction, confirmedDeletionIds: ids });
  };

  const syncButton = (
    <Button
      variant="primary"
      size="sm"
      className={isSettingsLayout ? "w-full sm:w-auto sm:min-w-36" : "w-full"}
      onClick={handleSync}
      disabled={syncStatus === "syncing"}
    >
      <RefreshCw className={`w-4 h-4 ${syncStatus === "syncing" ? "animate-spin" : ""}`} />
      {syncStatus === "syncing" ? t("sync.syncing") : t("sync.syncAll")}
    </Button>
  );

  return (
    <div className={isSettingsLayout ? "space-y-4" : "space-y-3"}>
      <div
        className={
          isSettingsLayout
            ? "grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
            : "grid grid-cols-2 gap-2"
        }
      >
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t("sync.scope")}</p>
          <Select value={scope} onChange={setScope} options={scopeOptions} minWidth="none" />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t("sync.direction")}</p>
          <Select
            value={direction}
            onChange={setDirection}
            options={directionOptions}
            minWidth="none"
          />
        </div>
        {isSettingsLayout && syncButton}
      </div>

      {!isSettingsLayout && syncButton}

      {pendingDeletions.length > 0 && (
        <div className="rounded-lg border border-border bg-warning-bg p-3 text-warning-text">
          <div className="flex items-start gap-2">
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t("sync.pendingDeletionsTitle")}</p>
              <p className="mt-0.5 text-xs">{t("sync.pendingDeletionsDescription")}</p>
              <ul className="mt-2 space-y-1">
                {pendingDeletions.map((item) => (
                  <li key={item.id} className="truncate text-xs">
                    {item.title}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="mt-3 w-full"
            onClick={handleConfirmDeletions}
            disabled={syncStatus === "syncing"}
          >
            <Trash2 className="h-4 w-4" />
            {t("sync.confirmRemoteDeletions")}
          </Button>
        </div>
      )}

      {syncLog.length > 0 && (
        <div className="rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setIsLogOpen((open) => !open)}
            className={`flex w-full items-center justify-between px-3 py-2 text-left ${
              isLogOpen ? "border-b border-border" : ""
            }`}
            aria-expanded={isLogOpen}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <ListChecks className="h-4 w-4" />
              <span>{t("sync.logTitle")}</span>
              <span className="text-xs text-muted-foreground">({syncLog.length})</span>
            </span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${
                isLogOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          {isLogOpen && (
            <div className="px-3 py-2">
              <div className="max-h-40 overflow-y-auto">
                {syncLog.slice(0, 12).map((entry) => (
                  <div key={entry.id} className="py-1 text-xs">
                    <p
                      className={
                        entry.level === "error"
                          ? "text-destructive"
                          : entry.level === "warning"
                            ? "text-warning-text"
                            : entry.level === "success"
                              ? "text-success"
                              : "text-muted-foreground"
                      }
                    >
                      {entry.message}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-end">
                <Button variant="ghost" size="sm" onClick={clearSyncLog}>
                  {t("sync.clearLog")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
