import type { SettingsSectionDef } from "@/features/settings/rows";

export const TUTORIAL_SECTION_DEF = {
  id: "tutorial",
  labelKey: "tutorial.settings.title",
  rows: [
    {
      id: "tutorialStart",
      labelKey: "tutorial.settings.startAll",
      descriptionKey: "tutorial.settings.description",
    },
  ],
} as const satisfies SettingsSectionDef;
