import { useTranslation } from "react-i18next";
import { useSettings } from "@/features/settings";
import { Switch } from "@/components/ui";
import { IS_DESKTOP, isMac } from "@/lib/platform";
import { SettingRow } from "@/components/settings/SettingRow";

export function WindowSection() {
  const { t } = useTranslation();
  const { launchOnStartup, closeToTray, setLaunchOnStartup, setCloseToTray } = useSettings();

  if (!IS_DESKTOP || isMac()) return null;

  return (
    <section data-tutorial="settings.window" className="mb-6 @lg:mb-8">
      <h2
        tabIndex={-1}
        data-settings-section="window"
        className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3"
      >
        {t("settings.window")}
      </h2>
      <div className="divide-y divide-border">
        <SettingRow
          id="launchOnStartup"
          className="flex flex-col @lg:flex-row @lg:items-center justify-between py-3 gap-2 @lg:gap-4"
        >
          <Switch
            checked={launchOnStartup}
            onChange={setLaunchOnStartup}
            label={t("settings.launchOnStartup")}
          />
        </SettingRow>

        <SettingRow
          id="closeToTray"
          className="flex flex-col @lg:flex-row @lg:items-center justify-between py-3 gap-2 @lg:gap-4"
        >
          <Switch
            checked={closeToTray}
            onChange={setCloseToTray}
            label={t("settings.closeToTray")}
          />
        </SettingRow>
      </div>
    </section>
  );
}
