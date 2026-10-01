import { useTranslation } from "react-i18next";
import { BackupSection } from "@/components/settings/BackupSection";
import { SettingsSection } from "@/components/settings/SettingsSection";

/**
 * The Backups settings section: the shell (with the Tutorial anchor) around
 * the BackupSection rows. Split so the Settings page renders every section
 * from SETTINGS_SECTIONS.
 */
export function BackupsSection() {
  const { t } = useTranslation();

  return (
    <SettingsSection
      sectionId="backups"
      title={t("backup.title")}
      description={t("backup.description")}
      data-tutorial="settings.backups"
    >
      <BackupSection />
    </SettingsSection>
  );
}
