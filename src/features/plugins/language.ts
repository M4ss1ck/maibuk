/**
 * Maibuk's language for Plugins (the language decision, #415): the identifier
 * the app runs in, and a subscription that delivers every change. No permission
 * is required, and the subscription replays the current value, so a Plugin that
 * starts after a change still learns it and no change is lost between startup
 * and subscription. The host gives the identifier as-is; choosing a locale,
 * fallback, or translation library stays the Plugin's own business.
 */

import i18n from "@/i18n";

/** The language Maibuk runs in right now, as i18next knows it. */
export function currentPluginLanguage(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? "en";
}

/** Calls `listener` on every language change; returns the unsubscribe. */
export function onPluginLanguageChange(listener: (language: string) => void): () => void {
  const handler = (language: string) => {
    try {
      listener(language);
    } catch (error) {
      // One bad listener must never break the language switch for the rest.
      console.error("[plugins] language listener failed:", error);
    }
  };
  i18n.on("languageChanged", handler);
  return () => {
    i18n.off("languageChanged", handler);
  };
}
