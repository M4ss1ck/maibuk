import { useEffect } from "react";
import { useSettingsStore } from "./store";
import i18n from "../../i18n";
import type { FontFamily } from "./types";

const FONT_FAMILY_MAP: Record<FontFamily, string> = {
  serif: "var(--font-serif)",
  sans: "var(--font-sans)",
  mono: "var(--font-mono)",
};

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const { appFontSize, appFont, language } = useSettingsStore();

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--app-font-size", `${appFontSize}px`);
    root.style.setProperty("--app-font-family", FONT_FAMILY_MAP[appFont]);
  }, [appFontSize, appFont]);

  useEffect(() => {
    // Ensure i18n language is synchronized with settings language
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  return <>{children}</>;
}
