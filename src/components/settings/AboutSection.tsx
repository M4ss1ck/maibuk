import { useTranslation } from "react-i18next";
import { useSettings } from "@/features/settings";
import { AsciiBanner } from "@/components/settings/AsciiBanner";
import { ReleaseBadge } from "@/components/releases/ReleaseBadge";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsSection } from "@/components/settings/SettingsSection";

export function AboutSection() {
  const { t } = useTranslation();
  const { primaryColor } = useSettings();

  return (
    <SettingsSection sectionId="about" title={t("settings.about")} titleHidden>
      <SettingRow id="appVersion" visuallyHiddenLabel>
        <div>
          <div className="relative">
            <AsciiBanner color={primaryColor} />
            <div className="absolute right-0 bottom-0">
              <ReleaseBadge variant="about" />
            </div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("app.description")}</p>
        </div>
      </SettingRow>
    </SettingsSection>
  );
}
