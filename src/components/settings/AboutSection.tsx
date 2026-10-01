import { useTranslation } from "react-i18next";
import { APP_VERSION, DOWNLOAD_PAGE } from "@/constants";
import { useVersionCheck } from "@/features/version";
import { useSettings } from "@/features/settings";
import { AsciiBanner } from "@/components/settings/AsciiBanner";
import { SettingRow } from "@/components/settings/SettingRow";

export function AboutSection() {
  const { t } = useTranslation();
  const { primaryColor } = useSettings();
  const { latestVersion, isOutdated } = useVersionCheck(APP_VERSION);
  const updateAvailable = isOutdated && latestVersion;

  return (
    <section className="pt-4 border-t border-border">
      <h2 tabIndex={-1} data-settings-section="about" className="sr-only">
        {t("settings.about")}
      </h2>
      <SettingRow id="appVersion" visuallyHiddenLabel>
        <div>
          <div className="relative">
            <AsciiBanner color={primaryColor} />
            <div className="absolute bottom-0 right-0 flex items-center gap-2">
              <span className="text-lg text-foreground">{APP_VERSION}</span>
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
            </div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("app.description")}</p>
        </div>
      </SettingRow>
    </section>
  );
}
