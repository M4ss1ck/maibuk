import { useTranslation } from "react-i18next";
import { ListBox, ListBoxItem } from "react-aria-components/ListBox";
import { Check, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { requestTutorial } from "@/features/tutorial/controller";
import { TUTORIAL_SECTIONS, TUTORIAL_SETTINGS_ROW_STEP } from "@/features/tutorial/sections";
import { useTutorialStore } from "@/features/tutorial/store";
import type { TutorialSectionId } from "@/features/tutorial/types";

interface TutorialSectionProps {
  /** Where a run started here comes back to. */
  returnTo?: string;
}

/** Settings → Tutorial: start again from the beginning, or run one section. */
export function TutorialSection({ returnTo = "/settings" }: TutorialSectionProps) {
  const { t, i18n } = useTranslation();
  const sections = useTutorialStore((state) => state.progress.sections);
  // Section keys are composed from the section id; the locale parity test proves they exist.
  const translate = t as unknown as (key: string, options?: Record<string, unknown>) => string;

  // A second request while a run is under way is refused by requestTutorial;
  // disabling these controls would drop focus from the one that started it.
  const start = (section: TutorialSectionId | null) => {
    requestTutorial({ section, origin: "settings", returnTo });
  };

  return (
    <div data-tutorial={TUTORIAL_SETTINGS_ROW_STEP}>
      <div className="mb-4 flex flex-col gap-3 @lg:flex-row @lg:items-center @lg:justify-between">
        <p className="text-sm text-muted-foreground">{t("tutorial.settings.description")}</p>
        <Button
          type="button"
          variant="secondary"
          className="shrink-0"
          onClick={() => start(null)}
          data-tutorial-trigger="settings-start"
        >
          <GraduationCap className="h-4 w-4" aria-hidden="true" />
          {t("tutorial.settings.startAll")}
        </Button>
      </div>
      <ListBox
        aria-label={t("tutorial.settings.sectionsLabel")}
        items={TUTORIAL_SECTIONS}
        dependencies={[i18n.resolvedLanguage]}
        selectionMode="none"
        onAction={(key) => start(key as TutorialSectionId)}
        className="grid gap-1 @lg:grid-cols-2"
      >
        {(section) => {
          const name = translate(section.nameKey);
          const done = sections[section.id]?.completedAt != null;
          return (
            <ListBoxItem
              id={section.id}
              textValue={name}
              data-tutorial-trigger={`settings-section-${section.id}`}
              className={({ isFocusVisible }) =>
                `flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted ${
                  isFocusVisible ? "outline-2 outline-offset-2 outline-primary" : "outline-none"
                }`
              }
            >
              <span>
                {translate("tutorial.settings.sectionRow", {
                  section: name,
                  steps: translate("tutorial.settings.steps", { count: section.steps.length }),
                })}
              </span>
              {done && (
                <span className="inline-flex items-center gap-1 text-xs text-success">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("tutorial.settings.done")}
                </span>
              )}
            </ListBoxItem>
          );
        }}
      </ListBox>
    </div>
  );
}
