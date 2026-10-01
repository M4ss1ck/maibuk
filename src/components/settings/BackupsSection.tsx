import { BackupSection } from "@/components/settings/BackupSection";

/**
 * The Backups settings section: the shell (with the Tutorial anchor) around
 * the BackupSection content. Split so the Settings page renders every
 * section from SETTINGS_SECTIONS.
 */
export function BackupsSection() {
  return (
    <section data-tutorial="settings.backups" className="pt-4 border-t border-border mb-6">
      <BackupSection />
    </section>
  );
}
