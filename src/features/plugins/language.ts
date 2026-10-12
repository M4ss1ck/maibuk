/**
 * Maibuk's language for Plugins (the language decision, #415): the selected
 * identifier the app runs in, and a subscription that delivers every change. No
 * permission is required, and the subscription replays the current value, so a
 * Plugin that starts after a change still learns it and no change is lost
 * between startup and subscription.
 *
 * The host supplies its selected identifier without adapting it to a Plugin's
 * supported languages, so every read — `language.get`, the replay snapshot, and
 * the change forward — comes from `i18n.language`. The i18next event's argument
 * can be an adapted identifier; it is passed through only when it agrees with
 * that one source. The host gives the identifier as-is; choosing a locale,
 * fallback, or translation library stays the Plugin's own business.
 */

import i18n from "@/i18n";

/** The language identifier Maibuk selected, as i18next knows it (never adapted). */
export function currentPluginLanguage(): string {
  return i18n.language ?? "en";
}

/** Calls `listener` on every language change; returns the unsubscribe. */
export function onPluginLanguageChange(listener: (language: string) => void): () => void {
  const handler = () => {
    // One source: the selected identifier, never an adapted event argument.
    try {
      listener(currentPluginLanguage());
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
