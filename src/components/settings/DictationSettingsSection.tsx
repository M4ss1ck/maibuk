import { useTranslation } from "react-i18next";
import { DictationSection } from "@/components/settings/DictationSection";

/**
 * The Dictation settings section: the shell (with the Tutorial anchor and
 * the deep-link target) around the DictationSection content. Split so the
 * Settings page renders every section from SETTINGS_SECTIONS.
 */
export function DictationSettingsSection() {
  const { t } = useTranslation();

  return (
    <section id="dictation" className="mb-6 @lg:mb-8 rounded-xl border border-border p-4 @lg:p-5">
      <h2
        tabIndex={-1}
        data-settings-section="dictation"
        className="text-lg text-primary font-medium mb-4"
        data-tutorial="dictation.overview"
      >
        {t("dictation.section.title")}
      </h2>
      <DictationSection />
    </section>
  );
}
