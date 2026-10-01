import { useTranslation } from "react-i18next";
import { useSettings, LANGUAGE_OPTIONS, type Language } from "@/features/settings";
import { Select, Switch } from "@/components/ui";
import { IS_DESKTOP } from "@/lib/platform";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsSection, SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";

export function GeneralSection() {
  const { t } = useTranslation();
  const { autoSave, alwaysOnTop, language, setAutoSave, setAlwaysOnTop, setLanguage } =
    useSettings();

  return (
    <SettingsSection
      sectionId="general"
      title={t("settings.general")}
      data-tutorial="settings.general"
    >
      <SettingRow id="autoSave" className={SETTINGS_ROW_CLASS}>
        <Switch checked={autoSave} onChange={setAutoSave} label={t("settings.toggleAutoSave")} />
      </SettingRow>

      {IS_DESKTOP && (
        <SettingRow id="alwaysOnTop" className={SETTINGS_ROW_CLASS}>
          <Switch
            checked={alwaysOnTop}
            onChange={setAlwaysOnTop}
            label={t("settings.toggleAlwaysOnTop")}
          />
        </SettingRow>
      )}

      <SettingRow id="language" className={SETTINGS_ROW_CLASS}>
        <Select<Language>
          ariaLabel={t("settings.language")}
          value={language}
          onChange={setLanguage}
          options={LANGUAGE_OPTIONS}
        />
      </SettingRow>
    </SettingsSection>
  );
}
