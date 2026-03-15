import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { createBackup } from "../../lib/platform";
import { BackupService } from "../../features/backup/backup-service";
import { parseSqlStatements } from "../../lib/db/sql-parser";
import { getDatabase } from "../../lib/db";
import { useBookStore } from "../../features/books/store";
import { useChapterStore } from "../../features/chapters/store";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toast";
import type { BackupEntry } from "../../lib/platform/types";

const DEFAULT_RETENTION = 20;
const SIZE_WARNING_THRESHOLD = 500 * 1024 * 1024; // 500MB

export function BackupSection() {
  const { t } = useTranslation();
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [service, setService] = useState<BackupService | null>(null);
  const [loading, setLoading] = useState(true);
  const [retention, setRetention] = useState(DEFAULT_RETENTION);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    createBackup().then((adapter) => {
      const svc = new BackupService(adapter);
      setService(svc);
      svc.listBackups().then((list) => {
        setBackups(list);
        setLoading(false);
      });
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!service) return;
    setBackups(await service.listBackups());
  }, [service]);

  const handleCreate = useCallback(async () => {
    if (!service) return;
    await service.createBackup("manual");
    await service.pruneBackups(retention);
    await refresh();
    toast.success(t("backup.backupCreated"));
  }, [service, retention, refresh, t]);

  const handleDelete = useCallback(async (filename: string) => {
    if (!service) return;
    await service.deleteBackup(filename);
    await refresh();
  }, [service, refresh]);

  const handleRestore = useCallback(async (filename: string) => {
    if (!service) return;

    try {
      // Verify integrity
      const valid = await service.verifyBackup(filename);
      if (!valid) {
        setErrorMessage(t("backup.backupCorrupt"));
        return;
      }

      // Pre-restore backup
      await service.createBackup("pre-restore");

      // Read the backup SQL and parse with proper SQL parser
      const sql = await service.readBackup(filename);
      const allStatements = parseSqlStatements(sql);

      // Filter to books and chapters INSERT statements only
      const statements = allStatements.filter((s) =>
        s.startsWith('INSERT INTO "books"') ||
        s.startsWith('INSERT INTO "chapters"')
      );

      const db = await getDatabase();
      await db.execute("BEGIN");
      try {
        await db.execute("DELETE FROM chapters");
        await db.execute("DELETE FROM books");

        for (const stmt of statements) {
          await db.execute(stmt);
        }

        await db.execute("COMMIT");
      } catch {
        await db.execute("ROLLBACK");
        setErrorMessage(t("backup.restoreFailed"));
        return;
      }

      // Reload stores so UI reflects restored data
      await useBookStore.getState().loadBooks();
      await useChapterStore.getState().loadChapters(
        useBookStore.getState().books[0]?.id ?? ""
      );
      toast.success(t("backup.restoreSuccess"));
    } catch {
      setErrorMessage(t("backup.restoreFailed"));
    } finally {
      setConfirmRestore(null);
    }
  }, [service, t]);

  const totalSize = backups.reduce((sum, b) => sum + b.sizeBytes, 0);

  if (loading) return null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium text-foreground">{t("backup.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("backup.description")}</p>
      </div>

      <div className="flex items-center gap-4">
        <label className="text-sm text-foreground">{t("backup.retentionLimit")}</label>
        <input
          type="number"
          min={1}
          max={100}
          value={retention}
          onChange={(e) => setRetention(Number(e.target.value))}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        />
      </div>

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
                <th className="px-3 py-2 text-left font-medium text-foreground">{t("backup.columnDate")}</th>
                <th className="px-3 py-2 text-left font-medium text-foreground">{t("backup.columnTrigger")}</th>
                <th className="px-3 py-2 text-left font-medium text-foreground">{t("backup.columnSize")}</th>
                <th className="px-3 py-2 text-right font-medium text-foreground">{t("backup.columnActions")}</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
                <tr key={backup.filename} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-foreground">
                    {backup.createdAt.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {t(`backup.trigger.${backup.trigger}`)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {(backup.sizeBytes / 1024).toFixed(0)} KB
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
