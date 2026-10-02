import { useTranslation } from "react-i18next";
import { MetricsSection } from "@/components/settings/MetricsSection";
import { SettingsSection } from "@/components/settings/SettingsSection";

/**
 * The Metrics settings section: the shell (with the Tutorial anchor) around
 * the MetricsSection rows. Split so the Settings page renders every section
 * from SETTINGS_SECTIONS.
 */
export function MetricsSettingsSection() {
  const { t } = useTranslation();

  return (
    <SettingsSection
      sectionId="metrics"
      title={t("settings.metrics.title")}
      description={t("settings.metrics.description")}
      data-tutorial="settings.metrics"
    >
      <MetricsSection />
    </SettingsSection>
  );
}
