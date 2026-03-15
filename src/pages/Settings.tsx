import { useState } from "react";
import { useTheme } from "../features/theme";
import {
  useSettings,
  DEFAULT_PRIMARY_COLOR,
  FONT_SIZE_OPTIONS,
  FONT_OPTIONS,
  EXPORT_FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  type FontSize,
  type FontFamily,
  type ExportFormat,
  type Language,
} from "../features/settings";
import { Select, Switch, Button, Modal, Input } from "../components/ui";
import { APP_VERSION, DOWNLOAD_PAGE } from "../constants";
import { useVersionCheck } from "../features/version";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon } from "../components/icons";
import { exportDatabase, importDatabase, resetDatabase } from "../lib/db";
import { getFileSystem, IS_TAURI, getDialog, getWebDialog } from "../lib/platform";
import { useSyncStore } from "../features/sync/store";
import { AuthDialog } from "../components/sync/AuthDialog";
import { BackupSection } from "../components/settings/BackupSection";

export function Settings() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { latestVersion, isOutdated } = useVersionCheck(APP_VERSION);
  const {
    appFontSize,
    appFont,
    primaryColor,
    autoSave,
    language,
    defaultExportFormat,
    spellCheckEnabled,
    customDictionary,
    dictionaryOpenInBrowser,
    showInlineFootnotes,
    showNotesChapter,
    hideKeyboardHints,
    setAppFontSize,
    setAppFont,
    setPrimaryColor,
    setAutoSave,
    setLanguage,
    setDefaultExportFormat,
    setSpellCheckEnabled,
    removeCustomWord,
    setDictionaryOpenInBrowser,
    setShowInlineFootnotes,
    setShowNotesChapter,
    setHideKeyboardHints,
  } = useSettings();

  const { apiUrl, setApiUrl, authStatus, userEmail, logout } = useSyncStore();
  const [syncServerUrl, setSyncServerUrl] = useState(apiUrl);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [customDictionaryOpen, setCustomDictionaryOpen] = useState(false);
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
    <div className="h-full overflow-auto">
      <div className="p-4 sm:p-8 max-w-2xl">
        <h2 className="text-xl sm:text-2xl font-semibold mb-6 sm:mb-8">{t("settings.title")}</h2>

        {/* Appearance Settings */}
        <section className="mb-6 sm:mb-8 rounded-xl border border-border p-4 sm:p-5">
          <h3 className="text-lg text-primary font-medium mb-4">{t("settings.appearance")}</h3>
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

            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
              <div>
                <p className="font-medium">{t("settings.primaryColor")}</p>
                <p className="text-sm text-muted-foreground">{t("settings.primaryColorDescription")}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  aria-label={t("settings.primaryColor")}
                  className="h-9 w-12 p-1 rounded-lg border border-border bg-background cursor-pointer"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPrimaryColor(DEFAULT_PRIMARY_COLOR)}
                  disabled={primaryColor === DEFAULT_PRIMARY_COLOR}
                >
                  {t("settings.resetPrimaryColor")}
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* General Settings */}
        <section className="mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t("settings.general")}</h3>
          <div className="divide-y divide-border">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2 sm:gap-4">
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

            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2 sm:gap-4">
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

        {/* Sync Settings */}
        <section className="mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t("sync.title")}</h3>
          <div className="divide-y divide-border">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2 sm:gap-4">
              <div className="flex-1">
                <p className="font-medium">{t("sync.serverUrl")}</p>
                <p className="text-sm text-muted-foreground">{t("sync.serverUrlDescription")}</p>
              </div>
              <div className="w-full sm:w-56">
                <Input
                  type="url"
                  value={syncServerUrl}
                  onChange={(e) => setSyncServerUrl(e.target.value)}
                  onBlur={() => {
                    if (syncServerUrl !== apiUrl) {
                      setApiUrl(syncServerUrl);
                    }
                  }}
                  placeholder="https://sync.example.com"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2 sm:gap-4">
              <div className="flex-1">
                <p className="font-medium">{t("sync.accountStatus")}</p>
                <p className="text-sm text-muted-foreground">
                  {authStatus === "logged-in" && userEmail
                    ? t("sync.loggedInAs", { email: userEmail })
                    : t("sync.notLoggedIn")}
                </p>
              </div>
              {authStatus === "logged-in" ? (
                <Button variant="destructive" size="sm" onClick={logout}>
                  {t("sync.logout")}
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={() => setShowAuthDialog(true)}>
                  {t("sync.login")}
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {t("sync.encryptionInfo")}
            </p>
          </div>
        </section>

        {/* Backups */}
        <section className="pt-4 border-t border-border mb-6">
          <BackupSection />
        </section>

        <AuthDialog
          isOpen={showAuthDialog}
          onClose={() => setShowAuthDialog(false)}
        />

        {/* Editor Settings */}
        <section className="mb-6 sm:mb-8 rounded-xl border border-border p-4 sm:p-5">
          <h3 className="text-lg text-primary font-medium mb-4">{t("settings.editor")}</h3>
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
              <div>
                <p className="font-medium">{t("settings.spellCheck")}</p>
                <p className="text-sm text-muted-foreground">{t("settings.spellCheckDescription")}</p>
              </div>
              <Switch
                checked={spellCheckEnabled}
                onChange={setSpellCheckEnabled}
                label={t("settings.toggleSpellCheck")}
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
              <div>
                <p className="font-medium">{t("settings.dictionaryOpenInBrowser")}</p>
                <p className="text-sm text-muted-foreground">{t("settings.dictionaryOpenInBrowserDescription")}</p>
              </div>
              <Switch
                checked={dictionaryOpenInBrowser}
                onChange={setDictionaryOpenInBrowser}
                label={t("settings.toggleDictionaryOpenInBrowser")}
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
              <div>
                <p className="font-medium">{t("settings.customDictionary")}</p>
                <p className="text-sm text-muted-foreground">{t("settings.customDictionaryDescription")}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("settings.customDictionaryCount", { count: customDictionary.length })}
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={() => setCustomDictionaryOpen(true)}>
                {t("settings.editCustomDictionary")}
              </Button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
              <div>
                <p className="font-medium">{t("settings.showInlineFootnotes")}</p>
                <p className="text-sm text-muted-foreground">{t("settings.showInlineFootnotesDescription")}</p>
              </div>
              <Switch
                checked={showInlineFootnotes}
                onChange={setShowInlineFootnotes}
                label={t("settings.toggleInlineFootnotes")}
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
              <div>
                <p className="font-medium">{t("settings.showNotesChapter")}</p>
                <p className="text-sm text-muted-foreground">{t("settings.showNotesChapterDescription")}</p>
              </div>
              <Switch
                checked={showNotesChapter}
                onChange={setShowNotesChapter}
                label={t("settings.toggleNotesChapter")}
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-2 sm:gap-4">
              <div>
                <p className="font-medium">{t("settings.hideKeyboardHints")}</p>
                <p className="text-sm text-muted-foreground">{t("settings.hideKeyboardHintsDescription")}</p>
              </div>
              <Switch
                checked={hideKeyboardHints}
                onChange={setHideKeyboardHints}
                label={t("settings.toggleHideKeyboardHints")}
              />
            </div>
          </div>
        </section>

        {/* Export Settings */}
        <section className="mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t("settings.export")}</h3>
          <div className="divide-y divide-border">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2 sm:gap-4">
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
        <section className="mb-6 sm:mb-8 rounded-xl border border-border p-4 sm:p-5">
          <button
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center justify-between w-full text-left"
          >
            <h3 className="text-lg text-destructive font-medium">{t("settings.advanced")}</h3>
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
                  variant="primary"
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
                  variant="primary"
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

        {/* Custom Dictionary Modal */}
        <Modal
          isOpen={customDictionaryOpen}
          onClose={() => setCustomDictionaryOpen(false)}
          title={t("settings.customDictionaryTitle")}
          footer={
            <Button variant="destructive" onClick={() => setCustomDictionaryOpen(false)}>
              {t("common.close")}
            </Button>
          }
        >
          {customDictionary.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings.customDictionaryEmpty")}</p>
          ) : (
            <div className="space-y-2">
              {customDictionary.map((word) => (
                <div
                  key={word}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border"
                >
                  <span className="text-sm">{word}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeCustomWord(word)}
                  >
                    {t("settings.removeWord")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Modal>

        {/* About */}
        <section className="pt-4 border-t border-border">
          <div className="text-sm text-muted-foreground">
            <p className="flex items-center gap-2">
              Maibuk {APP_VERSION}
              {updateAvailable && (
                <a
                  href={DOWNLOAD_PAGE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-2 py-0.5 bg-update-bg text-update-text rounded-full hover:opacity-80 transition-opacity"
                >
                  {t("settings.updateAvailable", { version: latestVersion })}
                </a>
              )}
            </p>
            <p className="mt-1">{t("app.description")}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
