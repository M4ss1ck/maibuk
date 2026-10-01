import type { SettingsSectionDef } from "@/features/settings/rows";

export const METRICS_SECTION = {
  id: "metrics",
  labelKey: "settings.metrics.title",
  rows: [
    {
      id: "metricsWriting",
      labelKey: "settings.metrics.writing.label",
      descriptionKey: "settings.metrics.writing.description",
    },
    {
      id: "metricsTime",
      labelKey: "settings.metrics.time.label",
      descriptionKey: "settings.metrics.time.description",
    },
    {
      id: "metricsEngagement",
      labelKey: "settings.metrics.engagement.label",
      descriptionKey: "settings.metrics.engagement.description",
    },
    {
      id: "metricsSync",
      labelKey: "settings.metrics.sync.label",
      descriptionKey: "settings.metrics.sync.description",
    },
  ],
} as const satisfies SettingsSectionDef;
