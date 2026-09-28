import type { TFunction } from "i18next";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import { getDictation } from "@/features/dictation/runtime";
import { useDictationStore } from "@/features/dictation/store";
import type { DictationLanguage } from "@/features/dictation/types";

export function installedDictationLanguages(installed: readonly string[]): DictationLanguage[] {
  return [
    ...new Set(
      MODEL_CATALOG.filter((model) => installed.includes(model.id)).flatMap(
        (model) => model.languages
      )
    ),
  ];
}

/** undefined means no downloaded model; null means Auto. */
export function nextDictationLanguage(
  current: DictationLanguage | null,
  installed: readonly DictationLanguage[]
): DictationLanguage | null | undefined {
  if (installed.length === 0) return undefined;
  if (current === null) return installed[0];
  const index = installed.indexOf(current);
  return index < 0 ? null : (installed[index + 1] ?? null);
}

export async function setDictationLanguage(next: DictationLanguage | null): Promise<void> {
  if (!useDictationStore.getState().enabled) return;
  useDictationStore.setState({ languageOverride: next });
  const runtime = await getDictation();
  // A newer picker/Command choice may have arrived while the runtime loaded.
  await runtime.session.setLanguage(useDictationStore.getState().languageOverride);
}

/** Announces through the caller's translator, so this module stays free of i18n setup. */
export async function cycleDictationLanguage(t: TFunction): Promise<void> {
  const state = useDictationStore.getState();
  if (!state.enabled || !state.support?.supported) return;
  const next = nextDictationLanguage(
    state.languageOverride,
    installedDictationLanguages(state.installed)
  );
  if (next === undefined) {
    useDictationStore.setState({ announcement: t("dictation.downloadModel") });
    return;
  }
  await setDictationLanguage(next);
  const current = useDictationStore.getState();
  if (!current.enabled || current.languageOverride !== next) return;
  useDictationStore.setState({
    announcement: t("dictation.announceLanguage", {
      language:
        next === null ? t("dictation.autoName") : t(`dictation.languages.${next}`),
    }),
  });
}
