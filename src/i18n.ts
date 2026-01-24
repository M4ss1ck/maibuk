import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getOS } from "./lib/platform";

// Static imports - Vite bundles these
import en from "./locales/en.json";
import es from "./locales/es.json";

// Define supported languages
const supportedLanguages = ["en", "es"] as const;
type SupportedLanguage = (typeof supportedLanguages)[number];

// Resources with const assertion for type narrowing
const resources = {
  en: { translation: en },
  es: { translation: es },
} as const;

// Default/fallback language
const fallbackLng: SupportedLanguage = "en";

// Normalize locale string (e.g., "en-US" -> "en")
function normalizeLocale(localeStr: string): SupportedLanguage {
  const lang = localeStr.split("-")[0].toLowerCase();
  if (supportedLanguages.includes(lang as SupportedLanguage)) {
    return lang as SupportedLanguage;
  }
  return fallbackLng;
}

// Initialize i18next synchronously with fallback
i18n.use(initReactI18next).init({
  resources,
  lng: fallbackLng,
  fallbackLng,
  defaultNS: "translation",
  ns: ["translation"],
  interpolation: {
    escapeValue: false, // React already escapes values
  },
  react: {
    useSuspense: false, // Prevent render blocking
  },
});

// Asynchronously detect system locale and update language
async function detectAndSetLocale(): Promise<void> {
  try {
    // Check if user has a saved language preference
    const savedSettings = localStorage.getItem('maibuk-settings');
    if (savedSettings) {
      const parsed = JSON.parse(savedSettings);
      if (parsed?.state?.language) {
        // Apply the saved language preference
        const savedLang = parsed.state.language as SupportedLanguage;
        if (supportedLanguages.includes(savedLang) && savedLang !== i18n.language) {
          await i18n.changeLanguage(savedLang);
        }
        return;
      }
    }

    // No saved preference, detect system locale using platform adapter
    const os = await getOS();
    const systemLocale = await os.locale();
    if (systemLocale) {
      const normalizedLang = normalizeLocale(systemLocale);
      if (normalizedLang !== i18n.language) {
        await i18n.changeLanguage(normalizedLang);
      }
    }
  } catch (error) {
    // Fallback to 'en' if detection fails
    console.warn("Failed to detect system locale, using fallback:", error);
  }
}

// Trigger locale detection
detectAndSetLocale();

export default i18n;
export { supportedLanguages, type SupportedLanguage };
