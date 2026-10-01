import { useTranslation } from "react-i18next";
import { useSettings } from "@/features/settings";
import { Switch } from "@/components/ui";
import { IS_DESKTOP, isMac } from "@/lib/platform";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsSection, SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";

export function WindowSection() {
  const { t } = useTranslation();
  const { launchOnStartup, closeToTray, setLaunchOnStartup, setCloseToTray } = useSettings();

  if (!IS_DESKTOP || isMac()) return null;

  return (
    <SettingsSection
      sectionId="window"
      title={t("settings.window")}
      data-tutorial="settings.window"
    >
      <SettingRow id="launchOnStartup" className={SETTINGS_ROW_CLASS}>
        <Switch
          checked={launchOnStartup}
          onChange={setLaunchOnStartup}
          label={t("settings.launchOnStartup")}
        />
      </SettingRow>

      <SettingRow id="closeToTray" className={SETTINGS_ROW_CLASS}>
        <Switch checked={closeToTray} onChange={setCloseToTray} label={t("settings.closeToTray")} />
      </SettingRow>
    </SettingsSection>
  );
}
