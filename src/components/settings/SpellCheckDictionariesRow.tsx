import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import {
  DICTIONARY_CATALOG,
  dictionarySizeMb,
  useSpellCheckDictionaries,
} from "@/features/spell-check-dictionaries";
import { openExternal } from "@/lib/platform";
import { languageDisplayName } from "@/lib/writing-language";

export function SpellCheckDictionariesRow() {
  const { t } = useTranslation();
  const installed = useSpellCheckDictionaries((state) => state.installed);
  const downloading = useSpellCheckDictionaries((state) => state.downloading);
  const failed = useSpellCheckDictionaries((state) => state.failed);
  const loaded = useSpellCheckDictionaries((state) => state.loaded);
  const refresh = useSpellCheckDictionaries((state) => state.refresh);
  const download = useSpellCheckDictionaries((state) => state.download);
  const remove = useSpellCheckDictionaries((state) => state.remove);

  useEffect(() => {
    if (!loaded) void refresh().catch(() => {});
  }, [loaded, refresh]);

  return (
    <div className="space-y-2">
      {DICTIONARY_CATALOG.map((entry) => {
        const name = languageDisplayName(entry.language);
        const isInstalled = installed.includes(entry.language);
        const isDownloading = downloading.includes(entry.language);
        const hasFailed = failed.includes(entry.language);
        return (
          <fieldset
            key={entry.language}
            aria-label={name}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
          >
            <div className="min-w-48 flex-1">
              <div className="font-medium">{name}</div>
              <div className="text-sm text-muted-foreground">
                {t("settings.spellCheckDictionarySize", { size: dictionarySizeMb(entry) })} ·{" "}
                {t("settings.spellCheckDictionaryLicense", { license: entry.license })}
              </div>
              <button
                type="button"
                aria-label={t("settings.spellCheckDictionarySourceFor", { language: name })}
                className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => void openExternal(entry.source)}
              >
                {t("settings.spellCheckDictionarySource")}
              </button>
            </div>
            {hasFailed && (
              <p role="status" className="text-sm text-destructive">
                {t("settings.spellCheckDictionaryDownloadFailed")}
              </p>
            )}
            {/* One button whose label follows the row's state, so focus stays on
                it while a download turns into Remove. */}
            <Button
              variant={isInstalled ? "ghost" : "primary"}
              size="sm"
              aria-disabled={isDownloading}
              className={isDownloading ? "cursor-not-allowed opacity-50" : ""}
              onClick={() => {
                if (isDownloading) return;
                if (isInstalled) void remove(entry.language);
                else void download(entry.language);
              }}
            >
              {t(
                isDownloading
                  ? "settings.spellCheckDictionaryDownloading"
                  : isInstalled
                    ? "settings.spellCheckDictionaryRemove"
                    : "settings.spellCheckDictionaryDownload"
              )}
            </Button>
          </fieldset>
        );
      })}
    </div>
  );
}
