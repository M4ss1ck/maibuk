import { useTranslation } from "react-i18next";
import { useSettings, EXPORT_FORMAT_OPTIONS, type ExportFormat } from "@/features/settings";
import { Select } from "@/components/ui";
import { SettingRow } from "@/components/settings/SettingRow";

export function ExportSection() {
  const { t } = useTranslation();
  const { defaultExportFormat, setDefaultExportFormat } = useSettings();

  return (
    <section className="mb-6 @lg:mb-8">
      <h2
        tabIndex={-1}
        data-settings-section="export"
        className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3"
      >
        {t("settings.export")}
      </h2>
      <div className="divide-y divide-border">
        <SettingRow
          id="defaultExportFormat"
          className="flex flex-col @lg:flex-row @lg:items-center justify-between py-3 gap-2 @lg:gap-4"
        >
          <Select<ExportFormat>
            ariaLabel={t("settings.defaultFormat")}
            value={defaultExportFormat}
            onChange={setDefaultExportFormat}
            options={EXPORT_FORMAT_OPTIONS}
          />
        </SettingRow>
      </div>
    </section>
  );
}
