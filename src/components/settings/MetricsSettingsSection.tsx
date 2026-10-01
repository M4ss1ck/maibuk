import { MetricsSection } from "@/components/settings/MetricsSection";

/**
 * The Metrics settings section: the shell (with the Tutorial anchor) around
 * the MetricsSection content. Split so the Settings page renders every
 * section from SETTINGS_SECTIONS.
 */
export function MetricsSettingsSection() {
  return (
    <section
      data-tutorial="settings.metrics"
      className="mb-6 @lg:mb-8 rounded-xl border border-border p-4 @lg:p-5"
    >
      <MetricsSection />
    </section>
  );
}
