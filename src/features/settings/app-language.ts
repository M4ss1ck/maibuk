import { useSettingsStore } from "@/features/settings/store";
import { normalizeLanguage, type Language } from "@/features/settings/types";

/** The language the author runs Maibuk in; the default for new writing. */
export function appLanguage(): Language {
  return normalizeLanguage(useSettingsStore.getState().language);
}
