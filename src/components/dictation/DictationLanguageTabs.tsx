import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import type { DictationLanguage } from "@/features/dictation/types";

const TAB_CLASS =
  "cursor-pointer rounded-md px-3 py-1 pointer-coarse:py-2 text-sm font-medium outline-none transition-colors text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary data-[selected]:bg-card data-[selected]:text-foreground data-[selected]:shadow-sm";

interface DictationLanguageTabsProps {
  languages: readonly DictationLanguage[];
  selected: DictationLanguage;
  onChange: (language: DictationLanguage) => void;
  /** Names the tab list, e.g. "Dictation language". */
  ariaLabel: string;
  /** Optional Tutorial anchor put on the tab list, for the Dictation section's step. */
  tutorialAnchor?: string;
  /** The panel of the selected language; only that one is mounted. */
  children: (language: DictationLanguage) => ReactNode;
  className?: string;
}

/**
 * One tab per Dictation Language, with the selected language's panel below.
 * Arrow keys move between tabs and select as they go (React Aria Tabs).
 */
export function DictationLanguageTabs({
  languages,
  selected,
  onChange,
  ariaLabel,
  tutorialAnchor,
  children,
  className,
}: DictationLanguageTabsProps) {
  const { t } = useTranslation();
  return (
    <Tabs
      selectedKey={selected}
      onSelectionChange={(key) => onChange(key as DictationLanguage)}
      className={className}
    >
      <TabList
        aria-label={ariaLabel}
        data-tutorial={tutorialAnchor}
        className="inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-muted/60 p-1"
      >
        {languages.map((language) => (
          <Tab key={language} id={language} className={TAB_CLASS}>
            {t(`dictation.languageNames.${language}`)}
          </Tab>
        ))}
      </TabList>
      {languages.map((language) => (
        <TabPanel key={language} id={language} className="mt-3 outline-none">
          {children(language)}
        </TabPanel>
      ))}
    </Tabs>
  );
}
