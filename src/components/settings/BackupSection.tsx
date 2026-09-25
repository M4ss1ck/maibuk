import { useState, useEffect, useCallback, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  BACKUP_DIRECTORY_NOT_APPROVED,
  createBackup,
  forgetBackupDirectory,
  getDefaultBackupDirectory,
  IS_DESKTOP,
  pickBackupDirectory,
  requestBackupDirectory,
} from "@/lib/platform";
import { BackupService } from "@/features/backup/backup-service";
import {
  formatBackupDate,
  isAbsoluteDirectoryPath,
  isSameDirectory,
} from "@/features/backup/utils";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import type { BackupEntry } from "@/lib/platform/types";
import { useSettingsStore } from "@/features/settings/store";
import { BACKUP_LIST_PAGE_SIZE_OPTIONS } from "@/features/settings/types";

const SIZE_WARNING_THRESHOLD = 500 * 1024 * 1024; // 500MB

export function BackupSection() {
  const { t, i18n } = useTranslation();
  const {
    backupRetention,
    backupDirectory,
    backupListPage,
    backupListPageSize,
    setBackupRetention,
    setBackupDirectory,
    setBackupListPage,
    setBackupListPageSize,
  } = useSettingsStore();
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalSizeBytes, setTotalSizeBytes] = useState(0);
  const [service, setService] = useState<BackupService | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // The directory field shows the effective directory until the author edits
  // it; a draft keeps typing local, so no reload runs per keystroke.
  const [directoryDraft, setDirectoryDraft] = useState<string | null>(null);
  const [defaultDirectory, setDefaultDirectory] = useState<string | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  // The saved directory was never approved on this device (saved before
  // approvals existed); Enter on the unchanged field asks for it again.
  const [directoryNeedsApproval, setDirectoryNeedsApproval] = useState(false);
  // Bumped to reload the adapter when the directory is approved again unchanged.
  const [serviceGeneration, setServiceGeneration] = useState(0);
  const selectedCountId = useId();
  const directoryInputId = useId();
  const directoryInputRef = useRef<HTMLInputElement>(null);
  // The native confirmation takes window focus, which blurs the field while
  // its own commit is still waiting.
  const committingDirectoryRef = useRef(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  // Set when a bulk delete removes the Delete button that had focus.
  const refocusAfterBulkDeleteRef = useRef(false);

  const effectiveDirectory = backupDirectory ?? defaultDirectory;
  const directoryValue = directoryDraft ?? effectiveDirectory ?? "";

  useEffect(() => {
    let cancelled = false;

    void getDefaultBackupDirectory()
      .then((path) => {
        if (!cancelled) setDefaultDirectory(path);
      })
      .catch((error) => {
        console.warn("Failed to resolve the default backup directory:", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const applyDirectory = useCallback(
    (next: string | null) => {
      setDirectoryDraft(null);
      setDirectoryError(null);
      setDirectoryNeedsApproval(false);
      if (next === backupDirectory) {
        setServiceGeneration((generation) => generation + 1);
        return;
      }
      setBackupDirectory(next);
      if (next === null) {
        void forgetBackupDirectory().catch((error) => {
          console.warn("Failed to forget the backup directory approval:", error);
        });
      }
    },
    [backupDirectory, setBackupDirectory]
  );

  const commitDirectoryDraft = useCallback(async () => {
    const draft = directoryDraft ?? (directoryNeedsApproval ? backupDirectory : null);
    if (draft === null || committingDirectoryRef.current) return;
    const trimmed = draft.trim();
    // Clearing the field, or typing the default back in, means "use the
    // default" rather than a custom directory equal to it.
    if (!trimmed || (defaultDirectory !== null && isSameDirectory(trimmed, defaultDirectory))) {
      applyDirectory(null);
      return;
    }
    if (
      !directoryNeedsApproval &&
      backupDirectory !== null &&
      isSameDirectory(trimmed, backupDirectory)
    ) {
      setDirectoryDraft(null);
      setDirectoryError(null);
      return;
    }
    if (!isAbsoluteDirectoryPath(trimmed)) {
      setDirectoryError(t("backup.directoryNotAbsolute"));
      return;
    }

    committingDirectoryRef.current = true;
    try {
      if (await requestBackupDirectory(trimmed, i18n.language)) {
        applyDirectory(trimmed);
      } else {
        // Declined in the native dialog: nothing changes.
        setDirectoryDraft(null);
        setDirectoryError(null);
      }
    } catch (error) {
      console.error("Failed to approve the backup directory:", error);
      setDirectoryError(t("backup.directoryAccessFailed"));
    } finally {
      committingDirectoryRef.current = false;
    }
  }, [
    applyDirectory,
    backupDirectory,
    defaultDirectory,
    directoryDraft,
    directoryNeedsApproval,
    i18n.language,
    t,
  ]);

  // Selection covers the visible page only: a different page, page size, or
  // folder starts empty.
  useEffect(() => {
    setSelected(new Set());
  }, [backupListPage, backupListPageSize, service]);

  // A refresh can move a selected backup off this page; it must not stay
  // selected where it cannot be seen.
  useEffect(() => {
    setSelected((previous) => {
      const onPage = new Set(backups.map((backup) => backup.filename));
      const kept = [...previous].filter((filename) => onPage.has(filename));
      return kept.length === previous.size ? previous : new Set(kept);
    });
  }, [backups]);

  useEffect(() => {
    if (!refocusAfterBulkDeleteRef.current || selected.size > 0) return;
    refocusAfterBulkDeleteRef.current = false;
    (selectAllRef.current ?? createButtonRef.current)?.focus();
  }, [selected, backups]);

  useEffect(() => {
    let cancelled = false;

    async function loadService(): Promise<void> {
      setLoading(true);
      try {
        const adapter = await createBackup(backupDirectory);
        const svc = new BackupService(adapter);
        if (cancelled) return;
        setService(svc);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof Error && error.message === BACKUP_DIRECTORY_NOT_APPROVED) {
          setDirectoryNeedsApproval(true);
          setDirectoryError(t("backup.directoryNeedsApproval"));
        } else {
          setErrorMessage(t("backup.loadFailed"));
        }
        setLoading(false);
      }
    }

    setService(null);
    setBackups([]);
    setTotalCount(0);
    setTotalSizeBytes(0);
    void loadService();

    return () => {
      cancelled = true;
    };
  }, [backupDirectory, serviceGeneration, t]);

  const refresh = useCallback(async () => {
    if (!service) return;
    const page = await service.listBackupsPage({
      page: backupListPage,
      pageSize: backupListPageSize,
    });
    setBackups(page.entries);
    setTotalCount(page.totalCount);
    setTotalSizeBytes(page.totalSizeBytes);
    if (page.page !== backupListPage) {
      setBackupListPage(page.page);
    }
  }, [backupListPage, backupListPageSize, service, setBackupListPage]);

  useEffect(() => {
    let cancelled = false;

    async function loadPage(): Promise<void> {
      if (!service) return;
      setLoading(true);
      try {
        const page = await service.listBackupsPage({
          page: backupListPage,
          pageSize: backupListPageSize,
        });
        if (cancelled) return;
        setBackups(page.entries);
        setTotalCount(page.totalCount);
        setTotalSizeBytes(page.totalSizeBytes);
        if (page.page !== backupListPage) {
          setBackupListPage(page.page);
        }
      } catch {
        if (!cancelled) {
          setErrorMessage(t("backup.loadFailed"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPage();

    return () => {
      cancelled = true;
    };
  }, [backupListPage, backupListPageSize, service, setBackupListPage, t]);

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
    let path: string | null;
    try {
      // A draft that has not committed yet is still where the author is looking.
      path = await pickBackupDirectory(directoryDraft?.trim() || effectiveDirectory || undefined);
    } catch (error) {
      console.error("Failed to choose the backup directory:", error);
      setDirectoryError(t("backup.directoryAccessFailed"));
      return;
    }
    if (!path) {
      // Cancelled: the uncommitted draft is still being edited.
      if (directoryDraft !== null) directoryInputRef.current?.focus();
      return;
    }
    applyDirectory(defaultDirectory && isSameDirectory(path, defaultDirectory) ? null : path);
  }, [applyDirectory, defaultDirectory, directoryDraft, effectiveDirectory, t]);

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

  const handleBulkDelete = useCallback(async () => {
    if (!service) return;
    setErrorMessage(null);
    setBulkDeleting(true);
    const { deleted, failed } = await service.deleteBackups([...selected]);
    setBulkDeleting(false);
    setConfirmBulkDelete(false);
    setSelected(new Set(failed));
    refocusAfterBulkDeleteRef.current = failed.length === 0;
    if (deleted.length > 0) {
      toast.success(t("backup.deletedCount", { count: deleted.length }));
    }
    await refresh().catch(() => {});
    if (failed.length > 0) {
      setErrorMessage(t("backup.deleteSomeFailed", { count: failed.length }));
    }
  }, [refresh, selected, service, t]);

  const toggleSelected = useCallback((filename: string, isSelected: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (isSelected) next.add(filename);
      else next.delete(filename);
      return next;
    });
  }, []);

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

  const totalPages = Math.max(1, Math.ceil(totalCount / backupListPageSize));
  const pageOptions = Array.from({ length: totalPages }, (_, index) => ({
    value: index + 1,
    label: String(index + 1),
  }));
  const pageSizeOptions = BACKUP_LIST_PAGE_SIZE_OPTIONS.map((size) => ({
    value: size,
    label: String(size),
  }));

  const selectedOnPage = backups.filter((backup) => selected.has(backup.filename)).length;
  const allOnPageSelected = backups.length > 0 && selectedOnPage === backups.length;

  return (
    <div className="@container space-y-4">
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

      {IS_DESKTOP && (
        // An error below the field would pull a bottom-aligned button down
        // with it; align the button to the field under its label instead.
        <div
          className={`flex flex-col gap-3 @sm:flex-row ${directoryError ? "@sm:items-start" : "@sm:items-end"}`}
          onBlur={(e) => {
            // Moving between the field and Choose folder keeps the draft (it
            // is the picker's start), and so does a native picker or
            // confirmation taking window focus. Leaving the row commits it.
            if (e.currentTarget.contains(e.relatedTarget) || !document.hasFocus()) return;
            void commitDirectoryDraft();
          }}
        >
          <Input
            ref={directoryInputRef}
            id={directoryInputId}
            label={t("backup.directoryLabel")}
            value={directoryValue}
            error={directoryError ?? undefined}
            onChange={(e) => {
              setDirectoryDraft(e.target.value);
              if (!directoryNeedsApproval) setDirectoryError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitDirectoryDraft();
              } else if (e.key === "Escape" && directoryDraft !== null) {
                e.preventDefault();
                setDirectoryDraft(null);
                if (!directoryNeedsApproval) setDirectoryError(null);
              }
            }}
            placeholder={t("backup.directoryPlaceholder")}
          />
          <Button
            variant="secondary"
            className={`shrink-0 h-11 ${directoryError ? "@sm:mt-[1.625rem]" : ""}`}
            onClick={() => void handleChooseDirectory()}
          >
            {t("backup.chooseDirectory")}
          </Button>
        </div>
      )}

      <Button ref={createButtonRef} variant="primary" onClick={handleCreate} disabled={!service}>
        {t("backup.createBackup")}
      </Button>

      {totalSizeBytes > SIZE_WARNING_THRESHOLD && (
        <p className="text-sm text-destructive">{t("backup.sizeWarning")}</p>
      )}

      {loading && totalCount === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("common.loading")}
        </p>
      ) : totalCount === 0 ? (
        <p className="text-sm text-muted-foreground">{t("backup.noBackups")}</p>
      ) : (
        <div className="space-y-3">
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
              <span id={selectedCountId} role="status" className="font-medium text-foreground">
                {t("backup.selectedCount", { count: selected.size })}
              </span>
              <Button
                variant="destructive"
                size="sm"
                aria-describedby={selectedCountId}
                onClick={() => setConfirmBulkDelete(true)}
                disabled={bulkDeleting}
              >
                {t("backup.deleteBackup")}
              </Button>
            </div>
          )}

          <div className="rounded-md border border-border overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="w-10 px-3 py-2">
                    <div className="flex items-center justify-center">
                      <Checkbox
                        inputRef={selectAllRef}
                        label={t("backup.selectAllOnPage")}
                        checked={allOnPageSelected}
                        indeterminate={selectedOnPage > 0 && !allOnPageSelected}
                        onChange={(isSelected) =>
                          setSelected(
                            isSelected
                              ? new Set(backups.map((backup) => backup.filename))
                              : new Set()
                          )
                        }
                      />
                    </div>
                  </th>
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
                {backups.map((backup) => {
                  const createdAt = formatBackupDate(backup.createdAt, i18n.language);
                  const isSelected = selected.has(backup.filename);
                  return (
                    <tr
                      key={backup.filename}
                      className={`border-b border-border last:border-0 ${
                        isSelected ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="w-10 px-3 py-2">
                        <div className="flex items-center justify-center">
                          <Checkbox
                            label={t("backup.selectRow", { date: createdAt })}
                            checked={isSelected}
                            onChange={(next) => toggleSelected(backup.filename, next)}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-foreground tabular-nums">{createdAt}</td>
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
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{t("backup.itemsPerPage")}</span>
              <Select
                ariaLabel={t("backup.itemsPerPage")}
                value={backupListPageSize}
                onChange={setBackupListPageSize}
                options={pageSizeOptions}
                minWidth="none"
                className="w-20"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setBackupListPage(backupListPage - 1)}
                disabled={backupListPage <= 1 || loading}
                aria-label={t("backup.previousPage")}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{t("backup.pageLabel")}</span>
                <Select
                  ariaLabel={t("backup.pageLabel")}
                  value={backupListPage}
                  onChange={setBackupListPage}
                  options={pageOptions}
                  endAdornment={`/ ${totalPages}`}
                  minWidth="none"
                  className="w-20"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setBackupListPage(backupListPage + 1)}
                disabled={backupListPage >= totalPages || loading}
                aria-label={t("backup.nextPage")}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
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

      <Modal
        isOpen={confirmBulkDelete}
        onClose={() => {
          if (!bulkDeleting) setConfirmBulkDelete(false);
        }}
        title={t("backup.deleteSelectedTitle")}
        footer={
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={() => void handleBulkDelete()}
              disabled={bulkDeleting}
            >
              {t("backup.deleteBackup")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setConfirmBulkDelete(false)}
              disabled={bulkDeleting}
            >
              {t("backup.cancel")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted-foreground">
          {t("backup.deleteSelectedConfirm", { count: selected.size })}
        </p>
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
