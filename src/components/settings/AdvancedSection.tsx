import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/features/settings";
import { Button, Modal } from "@/components/ui";
import { ChevronDownIcon } from "@/components/icons";
import { exportDatabase, importDatabase, resetDatabase } from "@/lib/db";
import { flushPendingEdits } from "@/features/sync/pending-edits";
import { getFileSystem, IS_TAURI, getDialog, getWebDialog, createBackup } from "@/lib/platform";
import { BackupService } from "@/features/backup/backup-service";
import { useSettingsRevealStore } from "@/features/settings/settings-reveal-store";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsSection, SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";

export function AdvancedSection() {
  const { t } = useTranslation();
  const advancedOpen = useSettingsRevealStore((state) => state.advancedOpen);
  const setAdvancedOpen = useSettingsRevealStore((state) => state.setAdvancedOpen);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  // A fresh mount starts closed, like the old local state: reset on unmount
  // so one visit's open block never leaks into the next mount.
  useEffect(() => () => setAdvancedOpen(false), [setAdvancedOpen]);

  const handleExportDatabase = async () => {
    setIsExporting(true);
    try {
      const data = await exportDatabase();
      const filename = `maibuk-backup-${new Date().toISOString().split("T")[0]}.sql`;

      if (IS_TAURI) {
        const dialog = await getDialog();
        const path = await dialog.save({
          defaultPath: filename,
          filters: [{ name: "SQL File", extensions: ["sql"] }],
        });
        if (path) {
          const fs = await getFileSystem();
          await fs.writeFile(path, data);
        }
      } else {
        const fs = await getFileSystem();
        fs.downloadFile(filename, data, "text/plain");
      }
    } catch (error) {
      console.error("Failed to export database:", error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportDatabase = async () => {
    setIsImporting(true);
    try {
      let sqlContent: string | null = null;

      if (IS_TAURI) {
        const dialog = await getDialog();
        const path = await dialog.open({
          filters: [{ name: "SQL File", extensions: ["sql"] }],
        });
        if (path) {
          const fs = await getFileSystem();
          const data = await fs.readFile(path);
          sqlContent = new TextDecoder().decode(data);
        }
      } else {
        const webDialog = await getWebDialog();
        const file = await webDialog.openWithData({
          filters: [{ name: "SQL File", extensions: ["sql"] }],
        });
        if (file) {
          sqlContent = new TextDecoder().decode(file.data);
        }
      }

      if (sqlContent) {
        // Before the pre-import Backup, so the Backup holds the text too; importDatabase flushes again.
        await flushPendingEdits();
        // Create a pre-import backup before overwriting data
        try {
          const { backupDirectory } = useSettingsStore.getState();
          const adapter = await createBackup(backupDirectory);
          const backupService = new BackupService(adapter);
          await backupService.createBackup("pre-restore");
        } catch {
          // Empty DB has nothing to back up — safe to continue
        }
        await importDatabase(sqlContent);
        // importDatabase announced the completed load before returning; this
        // full reload resets the views after that signal (ADR 0026).
        window.location.reload();
      }
    } catch (error) {
      console.error("Failed to import database:", error);
      alert(t("settings.importDatabaseFailed"));
    } finally {
      setIsImporting(false);
    }
  };

  const handleResetDatabase = async () => {
    setIsResetting(true);
    try {
      // Create a pre-reset backup before wiping everything
      try {
        const { backupDirectory } = useSettingsStore.getState();
        const adapter = await createBackup(backupDirectory);
        const backupService = new BackupService(adapter);
        await backupService.createBackup("pre-restore");
      } catch {
        // Empty DB has nothing to back up — safe to continue
      }
      await resetDatabase();
      setResetModalOpen(false);
      // resetDatabase announced the completed Reset before returning; this
      // full reload resets the views after that signal (ADR 0026).
      window.location.reload();
    } catch (error) {
      console.error("Failed to reset database:", error);
      alert(t("settings.resetDatabaseFailed"));
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <>
      <SettingsSection
        sectionId="advanced"
        title={t("settings.advanced")}
        tone="destructive"
        data-tutorial="settings.advanced"
        renderTitle={(heading) => (
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            aria-expanded={advancedOpen}
            className="flex items-center justify-between w-full text-left"
          >
            {heading}
            <ChevronDownIcon
              className={`w-5 h-5 text-muted-foreground transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            />
          </button>
        )}
      >
        {advancedOpen && (
          <>
            <SettingRow id="exportDatabase" className={SETTINGS_ROW_CLASS}>
              <Button
                variant="primary"
                size="sm"
                onClick={handleExportDatabase}
                disabled={isExporting}
              >
                {isExporting ? t("common.loading") : t("settings.exportDatabaseButton")}
              </Button>
            </SettingRow>

            <SettingRow id="importDatabase" className={SETTINGS_ROW_CLASS}>
              <Button
                variant="primary"
                size="sm"
                onClick={handleImportDatabase}
                disabled={isImporting}
              >
                {isImporting ? t("common.loading") : t("settings.importDatabaseButton")}
              </Button>
            </SettingRow>

            <SettingRow
              id="resetDatabase"
              labelClassName="font-medium text-destructive"
              className={SETTINGS_ROW_CLASS}
            >
              <Button variant="destructive" size="sm" onClick={() => setResetModalOpen(true)}>
                {t("settings.resetDatabaseButton")}
              </Button>
            </SettingRow>
          </>
        )}
      </SettingsSection>

      <Modal
        isOpen={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        title={t("settings.resetDatabase")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetModalOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleResetDatabase} disabled={isResetting}>
              {isResetting ? t("common.loading") : t("settings.confirmReset")}
            </Button>
          </>
        }
      >
        <p className="text-muted-foreground">{t("settings.resetDatabaseConfirm")}</p>
      </Modal>
    </>
  );
}
