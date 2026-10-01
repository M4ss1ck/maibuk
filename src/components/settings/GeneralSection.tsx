import { useTranslation } from "react-i18next";
import { useSettings, LANGUAGE_OPTIONS, type Language } from "@/features/settings";
import { Select, Switch } from "@/components/ui";
import { IS_DESKTOP } from "@/lib/platform";
import { SettingRow } from "@/components/settings/SettingRow";

const ROW_CLASS =
  "flex flex-col @lg:flex-row @lg:items-center justify-between py-3 gap-2 @lg:gap-4";

export function GeneralSection() {
  const { t } = useTranslation();
  const { autoSave, alwaysOnTop, language, setAutoSave, setAlwaysOnTop, setLanguage } =
    useSettings();

  return (
    <section data-tutorial="settings.general" className="mb-6 @lg:mb-8">
      <h2
        tabIndex={-1}
        data-settings-section="general"
        className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3"
      >
        {t("settings.general")}
      </h2>
      <div className="divide-y divide-border">
        <SettingRow id="autoSave" className={ROW_CLASS}>
          <Switch checked={autoSave} onChange={setAutoSave} label={t("settings.toggleAutoSave")} />
        </SettingRow>

        {IS_DESKTOP && (
          <SettingRow id="alwaysOnTop" className={ROW_CLASS}>
            <Switch
              checked={alwaysOnTop}
              onChange={setAlwaysOnTop}
              label={t("settings.toggleAlwaysOnTop")}
            />
          </SettingRow>
        )}

        <SettingRow id="language" className={ROW_CLASS}>
          <Select<Language>
            ariaLabel={t("settings.language")}
            value={language}
            onChange={setLanguage}
            options={LANGUAGE_OPTIONS}
          />
        </SettingRow>
      </div>
    </section>
  );
}
