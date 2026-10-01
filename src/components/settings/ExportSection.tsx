import { useTranslation } from "react-i18next";
import { useSettings, EXPORT_FORMAT_OPTIONS, type ExportFormat } from "@/features/settings";
import { Select } from "@/components/ui";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsSection, SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";

export function ExportSection() {
  const { t } = useTranslation();
  const { defaultExportFormat, setDefaultExportFormat } = useSettings();

  return (
    <SettingsSection sectionId="export" title={t("settings.export")}>
      <SettingRow id="defaultExportFormat" className={SETTINGS_ROW_CLASS}>
        <Select<ExportFormat>
          ariaLabel={t("settings.defaultFormat")}
          value={defaultExportFormat}
          onChange={setDefaultExportFormat}
          options={EXPORT_FORMAT_OPTIONS}
        />
      </SettingRow>
    </SettingsSection>
  );
}
