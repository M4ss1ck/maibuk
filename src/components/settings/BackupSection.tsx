import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { createBackup, getDialog, IS_TAURI } from "../../lib/platform";
import { BackupService } from "../../features/backup/backup-service";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { toast } from "../ui/Toast";
import type { BackupEntry } from "../../lib/platform/types";
import { useSettingsStore } from "../../features/settings/store";

const SIZE_WARNING_THRESHOLD = 500 * 1024 * 1024; // 500MB

export function BackupSection() {
  const { t } = useTranslation();
  const { backupRetention, backupDirectory, setBackupRetention, setBackupDirectory } =
    useSettingsStore();
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [service, setService] = useState<BackupService | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadService(): Promise<void> {
      setLoading(true);
      try {
        const adapter = await createBackup(backupDirectory);
        const svc = new BackupService(adapter);
        const list = await svc.listBackups();
        if (cancelled) return;
        setService(svc);
        setBackups(list);
      } catch {
        if (cancelled) return;
        setErrorMessage(t("backup.loadFailed"));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadService();

    return () => {
      cancelled = true;
    };
  }, [backupDirectory, t]);

  const refresh = useCallback(async () => {
    if (!service) return;
    setBackups(await service.listBackups());
  }, [service]);

  const handleCreate = useCallback(async () => {
    if (!service) return;
    setErrorMessage(null);
    try {
      await service.createBackup("manual");
      toast.success(t("backup.backupCreated"));
      try {
        await service.pruneBackups(backupRetention);
      } catch {
        console.warn("Failed to prune backups after manual backup creation.");
      }
    } catch (error) {
      console.error("Failed to create backup:", error);
      if (error instanceof Error && error.message === "BACKUP_EMPTY") {
        setErrorMessage(t("backup.backupEmpty"));
      } else {
        setErrorMessage(t("backup.createFailed"));
      }
    } finally {
      await refresh().catch(() => {});
    }
  }, [service, backupRetention, refresh, t]);

  const handleChooseDirectory = useCallback(async () => {
    const dialog = await getDialog();
    const path = await dialog.open({ directory: true });
    if (path) {
      setBackupDirectory(path);
    }
  }, [setBackupDirectory]);

  const handleDelete = useCallback(
    async (filename: string) => {
      if (!service) return;
      setErrorMessage(null);
      try {
        await service.deleteBackup(filename);
      } catch (error) {
        console.error("Failed to delete backup:", error);
        setErrorMessage(t("backup.deleteFailed"));
      } finally {
        await refresh().catch(() => {});
      }
    },
    [service, refresh, t]
  );

  const handleRestore = useCallback(
    async (filename: string) => {
      if (!service) return;
      setErrorMessage(null);
      try {
        await service.restoreBackup(filename);
        toast.success(t("backup.restoreSuccess"));
      } catch (error) {
        console.error("Backup restore failed:", error);
        if (error instanceof Error) {
          if (error.message === "BACKUP_CORRUPT") {
            setErrorMessage(t("backup.backupCorrupt"));
          } else if (error.message === "RESTORE_INVALID") {
            setErrorMessage(t("backup.restoreInvalid"));
          } else if (error.message.startsWith("RESTORE_FAILED:")) {
            // Show the real error detail so the user (or developer) can diagnose
            const detail = error.message.slice("RESTORE_FAILED: ".length);
            setErrorMessage(`${t("backup.restoreFailed")}\n\n${detail}`);
          } else {
            setErrorMessage(t("backup.restoreFailed"));
          }
        } else {
          setErrorMessage(t("backup.restoreFailed"));
        }
      } finally {
        setConfirmRestore(null);
        await refresh().catch(() => {});
      }
    },
    [refresh, service, t]
  );

  const totalSize = backups.reduce((sum, b) => sum + b.sizeBytes, 0);

  if (loading) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {t("backup.title")}
      </h3>
      <div>
        <p className="text-sm text-muted-foreground">{t("backup.description")}</p>
      </div>

      <div className="flex items-center gap-4">
        <Input
          type="number"
          label={t("backup.retentionLimit")}
          min={1}
          max={100}
          value={backupRetention}
          onChange={(e) => setBackupRetention(Number(e.target.value))}
          className="w-24"
        />
      </div>

      {IS_TAURI && (
        <div className="flex items-end gap-3">
          <Input
            label={t("backup.directoryLabel")}
            value={backupDirectory ?? ""}
            onChange={(e) => setBackupDirectory(e.target.value || null)}
            placeholder={t("backup.directoryPlaceholder")}
          />
          <Button variant="secondary" onClick={() => void handleChooseDirectory()}>
            {t("backup.chooseDirectory")}
          </Button>
        </div>
      )}

      <Button variant="primary" onClick={handleCreate}>
        {t("backup.createBackup")}
      </Button>

      {totalSize > SIZE_WARNING_THRESHOLD && (
        <p className="text-sm text-destructive">{t("backup.sizeWarning")}</p>
      )}

      {backups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("backup.noBackups")}</p>
      ) : (
        <div className="rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-3 py-2 text-left font-medium text-foreground">
                  {t("backup.columnDate")}
                </th>
                <th className="px-3 py-2 text-left font-medium text-foreground">
                  {t("backup.columnTrigger")}
                </th>
                <th className="px-3 py-2 text-left font-medium text-foreground">
                  {t("backup.columnSize")}
                </th>
                <th className="px-3 py-2 text-right font-medium text-foreground">
                  {t("backup.columnActions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
                <tr key={backup.filename} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-foreground">{backup.createdAt.toLocaleString()}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {t(`backup.trigger.${backup.trigger}`)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {backup.sizeBytes < 1024
                      ? `${backup.sizeBytes} B`
                      : `${(backup.sizeBytes / 1024).toFixed(0)} KB`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmRestore(backup.filename)}
                    >
                      {t("backup.restoreBackup")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(backup.filename)}
                      className="text-destructive"
                    >
                      {t("backup.deleteBackup")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Restore confirmation modal */}
      <Modal
        isOpen={confirmRestore !== null}
        onClose={() => setConfirmRestore(null)}
        title={t("backup.restoreBackup")}
        footer={
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={() => confirmRestore && handleRestore(confirmRestore)}
            >
              {t("backup.restoreBackup")}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmRestore(null)}>
              {t("backup.cancel")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted-foreground">{t("backup.restoreConfirm")}</p>
      </Modal>

      {/* Error modal — used instead of toast for error messages since toast only has a success variant */}
      <Modal
        isOpen={errorMessage !== null}
        onClose={() => setErrorMessage(null)}
        title={t("backup.title")}
        footer={
          <Button variant="primary" onClick={() => setErrorMessage(null)}>
            {t("backup.ok")}
          </Button>
        }
      >
        <p className="text-sm text-destructive">{errorMessage}</p>
      </Modal>
    </div>
  );
}
