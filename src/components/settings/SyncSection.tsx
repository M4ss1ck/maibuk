import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/features/settings";
import { Button, Input, Switch } from "@/components/ui";
import { useSyncStore } from "@/features/sync/store";
import { normalizeServerUrl } from "@/features/sync/client";
import { useSyncFlow } from "@/features/sync/useSyncFlow";
import { AuthDialog } from "@/components/sync/AuthDialog";
import { PassphraseDialog } from "@/components/sync/PassphraseDialog";
import { ConflictDialog } from "@/components/sync/ConflictDialog";
import { SyncControls } from "@/components/sync/SyncControls";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsSection, SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";

export function SyncSection() {
  const { t } = useTranslation();
  const { autoSync, setAutoSync } = useSettings();
  const { apiUrl, setApiUrl, authStatus, userEmail, logout } = useSyncStore();
  const {
    showPassphraseDialog,
    closePassphraseDialog,
    syncAllWithSessionPassphrase,
    completePassphraseFlow,
    activeConflict,
    resolveConflict,
  } = useSyncFlow();
  const [syncServerUrl, setSyncServerUrl] = useState(apiUrl);
  // The Log In dialog sets the URL while Settings is open; a field still
  // holding its first value would write that stale URL back on blur.
  useEffect(() => {
    setSyncServerUrl(apiUrl);
  }, [apiUrl]);
  const [showAuthDialog, setShowAuthDialog] = useState(false);

  return (
    <SettingsSection sectionId="sync" title={t("sync.title")} data-tutorial="settings.sync">
      <SettingRow
        id="syncServerUrl"
        labelWrapperClassName="flex-1"
        className="flex flex-col @xl:flex-row @xl:items-center justify-between py-3 gap-2 @xl:gap-4"
      >
        <div className="w-full @xl:w-80">
          <Input
            type="text"
            aria-label={t("sync.serverUrl")}
            value={syncServerUrl}
            onChange={(e) => setSyncServerUrl(e.target.value)}
            onBlur={() => {
              const normalized = normalizeServerUrl(syncServerUrl);
              setSyncServerUrl(normalized);
              if (normalized !== apiUrl) {
                setApiUrl(normalized);
              }
            }}
            placeholder="sync.example.com"
          />
        </div>
      </SettingRow>

      <SettingRow
        id="syncAccount"
        labelWrapperClassName="flex-1"
        className={SETTINGS_ROW_CLASS}
        descriptionOverride={
          <p className="text-sm text-muted-foreground">
            {authStatus === "logged-in" && userEmail
              ? t("sync.loggedInAs", { email: userEmail })
              : t("sync.notLoggedIn")}
          </p>
        }
      >
        {authStatus === "logged-in" ? (
          <Button variant="destructive" size="sm" onClick={logout}>
            {t("sync.logout")}
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setShowAuthDialog(true)}>
            {t("sync.login")}
          </Button>
        )}
      </SettingRow>

      {authStatus === "logged-in" && (
        <SettingRow id="syncAutoSync" labelWrapperClassName="flex-1" className={SETTINGS_ROW_CLASS}>
          <Switch checked={autoSync} onChange={setAutoSync} label={t("sync.autoSync")} />
        </SettingRow>
      )}

      {authStatus === "logged-in" && (
        <SettingRow id="syncNow" labelHidden className="py-3">
          <SyncControls
            layout="settings"
            onSync={async (options) => {
              // Errors surface via syncError in the store; swallow the
              // rejection so it isn't an uncaught promise.
              await syncAllWithSessionPassphrase(options).catch(() => {});
            }}
          />
        </SettingRow>
      )}

      <p className="py-3 text-xs text-muted-foreground">{t("sync.encryptionInfo")}</p>

      <AuthDialog isOpen={showAuthDialog} onClose={() => setShowAuthDialog(false)} />

      <PassphraseDialog
        isOpen={showPassphraseDialog}
        onClose={closePassphraseDialog}
        onSuccess={() => {
          void completePassphraseFlow();
        }}
      />

      {activeConflict && <ConflictDialog conflict={activeConflict} onResolve={resolveConflict} />}
    </SettingsSection>
  );
}
