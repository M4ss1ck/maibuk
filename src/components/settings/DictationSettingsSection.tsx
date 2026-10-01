import { useTranslation } from "react-i18next";
import { DictationSection } from "@/components/settings/DictationSection";
import { SettingsSection } from "@/components/settings/SettingsSection";

/**
 * The Dictation settings section: the shell (with the Tutorial anchor and
 * the deep-link target) around the DictationSection content. Split so the
 * Settings page renders every section from SETTINGS_SECTIONS.
 */
export function DictationSettingsSection() {
  const { t } = useTranslation();

  return (
    <SettingsSection
      id="dictation"
      sectionId="dictation"
      title={t("dictation.section.title")}
      titleAttributes={{ "data-tutorial": "dictation.overview" }}
    >
      <DictationSection />
    </SettingsSection>
  );
}
