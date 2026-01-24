import { useState } from "react";
import { useTheme } from "../features/theme";
import {
  useSettings,
  FONT_SIZE_OPTIONS,
  FONT_OPTIONS,
  EXPORT_FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  type FontSize,
  type FontFamily,
  type ExportFormat,
  type Language,
} from "../features/settings";
import { Select, Switch, Button, Modal } from "../components/ui";
import { APP_VERSION } from "../constants";
import { useVersionCheck } from "../features/version";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon } from "../components/icons";
import { exportDatabase, importDatabase, resetDatabase } from "../lib/db";
import { getFileSystem, IS_TAURI, getDialog, getWebDialog } from "../lib/platform";

export function Settings() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { latestVersion, isOutdated } = useVersionCheck(APP_VERSION);
  const {
    appFontSize,
    appFont,
    autoSave,
    language,
    defaultExportFormat,
    setAppFontSize,
    setAppFont,
    setAutoSave,
    setLanguage,
    setDefaultExportFormat,
  } = useSettings();

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const updateAvailable = isOutdated && latestVersion;

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
        await importDatabase(sqlContent);
        window.location.reload();
      }
    } catch (error) {
      console.error("Failed to import database:", error);
    } finally {
      setIsImporting(false);
    }
  };

  const handleResetDatabase = async () => {
    setIsResetting(true);
    try {
      await resetDatabase();
      setResetModalOpen(false);
      window.location.reload();
    } catch (error) {
      console.error("Failed to reset database:", error);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-2xl overflow-auto h-full">
      <h2 className="text-xl sm:text-2xl font-semibold mb-6 sm:mb-8">{t("settings.title")}</h2>

      {/* Appearance Settings */}
      <section className="mb-6 sm:mb-8">
        <h3 className="text-lg font-medium mb-4">{t("settings.appearance")}</h3>
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
            <div>
              <p className="font-medium">{t("settings.theme")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.themeDescription")}</p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit">
              <button
                onClick={() => setTheme("light")}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${theme === "light"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                {t("settings.light")}
              </button>
              <button
                onClick={() => setTheme("dark")}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${theme === "dark"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                {t("settings.dark")}
              </button>
              <button
                onClick={() => setTheme("system")}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${theme === "system"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                {t("settings.system")}
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
            <div>
              <p className="font-medium">{t("settings.fontSize")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.fontSizeDescription")}</p>
            </div>
            <Select<FontSize>
              value={appFontSize}
              onChange={setAppFontSize}
              options={FONT_SIZE_OPTIONS}
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
            <div>
              <p className="font-medium">{t("settings.font")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.fontDescription")}</p>
            </div>
            <Select<FontFamily>
              value={appFont}
              onChange={setAppFont}
              options={FONT_OPTIONS}
            />
          </div>
        </div>
      </section>

      {/* General Settings */}
      <section className="mb-6 sm:mb-8">
        <h3 className="text-lg font-medium mb-4">{t("settings.general")}</h3>
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
            <div>
              <p className="font-medium">{t("settings.autoSave")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.autoSaveDescription")}</p>
            </div>
            <Switch
              checked={autoSave}
              onChange={setAutoSave}
              label={t("settings.toggleAutoSave")}
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
            <div>
              <p className="font-medium">{t("settings.language")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.languageDescription")}</p>
            </div>
            <Select<Language>
              value={language}
              onChange={setLanguage}
              options={LANGUAGE_OPTIONS}
            />
          </div>
        </div>
      </section>

      {/* Export Settings */}
      <section className="mb-6 sm:mb-8">
        <h3 className="text-lg font-medium mb-4">{t("settings.export")}</h3>
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
            <div>
              <p className="font-medium">{t("settings.defaultFormat")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.defaultFormatDescription")}</p>
            </div>
            <Select<ExportFormat>
              value={defaultExportFormat}
              onChange={setDefaultExportFormat}
              options={EXPORT_FORMAT_OPTIONS}
            />
          </div>
        </div>
      </section>

      {/* Advanced Settings */}
      <section className="mb-6 sm:mb-8">
        <button
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="flex items-center justify-between w-full text-left"
        >
          <h3 className="text-lg font-medium">{t("settings.advanced")}</h3>
          <ChevronDownIcon
            className={`w-5 h-5 text-muted-foreground transition-transform ${advancedOpen ? "rotate-180" : ""}`}
          />
        </button>

        {advancedOpen && (
          <div className="mt-4 space-y-4 border-l-2 border-destructive/30 pl-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
              <div>
                <p className="font-medium">{t("settings.exportDatabase")}</p>
                <p className="text-sm text-muted-foreground">{t("settings.exportDatabaseDescription")}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExportDatabase}
                disabled={isExporting}
              >
                {isExporting ? t("common.loading") : t("settings.exportDatabaseButton")}
              </Button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
              <div>
                <p className="font-medium">{t("settings.importDatabase")}</p>
                <p className="text-sm text-muted-foreground">{t("settings.importDatabaseDescription")}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleImportDatabase}
                disabled={isImporting}
              >
                {isImporting ? t("common.loading") : t("settings.importDatabaseButton")}
              </Button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
              <div>
                <p className="font-medium text-destructive">{t("settings.resetDatabase")}</p>
                <p className="text-sm text-muted-foreground">{t("settings.resetDatabaseDescription")}</p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setResetModalOpen(true)}
              >
                {t("settings.resetDatabaseButton")}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Reset Confirmation Modal */}
      <Modal
        isOpen={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        title={t("settings.resetDatabase")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetModalOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleResetDatabase}
              disabled={isResetting}
            >
              {isResetting ? t("common.loading") : t("settings.confirmReset")}
            </Button>
          </>
        }
      >
        <p className="text-muted-foreground">{t("settings.resetDatabaseConfirm")}</p>
      </Modal>

      {/* About */}
      <section>
        <h3 className="text-lg font-medium mb-4">{t("settings.about")}</h3>
        <div className="text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            Maibuk {APP_VERSION}
            {updateAvailable && (
              <a
                href="https://maibuk.massick.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-full hover:bg-amber-500/30 transition-colors"
              >
                {t("settings.updateAvailable", { version: latestVersion })}
              </a>
            )}
          </p>
          <p className="mt-1">{t("app.description")}</p>
        </div>
      </section>
    </div>
  );
}
