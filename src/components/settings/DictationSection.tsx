import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { DictationLanguageTabs } from "@/components/dictation/DictationLanguageTabs";
import { DictationVocabularySection } from "@/components/settings/DictationVocabularySection";
import { SpokenPunctuationSection } from "@/components/settings/SpokenPunctuationSection";
import { MODEL_CATALOG, modelsFor } from "@/features/dictation/catalog";
import { getDictation } from "@/features/dictation/runtime";
import { catalogCapabilities } from "@/features/dictation/spoken-punctuation";
import type { LineStatsSummary } from "@/features/dictation/stats";
import { dictationLanguageFor, pickModel, useDictationStore } from "@/features/dictation/store";
import type { DictationLanguage, ModelSpec } from "@/features/dictation/types";
import { dictationPlatform } from "@/lib/platform";

const MB = 1_000_000;
const sizeMb = (spec: ModelSpec) =>
  Math.round(spec.files.reduce((sum, f) => sum + f.bytes, 0) / MB);

export function DictationSection() {
  const { t, i18n } = useTranslation();
  const support = useDictationStore((s) => s.support);
  const enabled = useDictationStore((s) => s.enabled);
  const setEnabled = useDictationStore((s) => s.setEnabled);
  const installed = useDictationStore((s) => s.installed);
  const downloads = useDictationStore((s) => s.downloads);
  const preferred = useDictationStore((s) => s.preferredTier);
  const setPreferred = useDictationStore((s) => s.setPreferredTier);
  const [recent, setRecent] = useState<LineStatsSummary | null>(null);
  const override = useDictationStore((s) => s.languageOverride);
  const [chosen, setChosen] = useState<DictationLanguage>(() =>
    dictationLanguageFor(override, i18n.language)
  );

  const [device, setDevice] = useState<string | null>(null);
  const actionRefs = useRef(new Map<string, HTMLButtonElement>());
  // Support is null until the runtime reports; a build failure leaves it null for good.
  const [settled, setSettled] = useState(false);
  const formatMs = (value: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 3 }).format(value);

  useEffect(() => {
    // Unsupported builds reject when the runtime cannot be built: keep the
    // section in its explanatory state instead of surfacing an unhandled error.
    void getDictation()
      .then(async (r) => {
        setSettled(true);
        setRecent(r.stats.summary());
        setDevice(await r.host.inputDevice());
      })
      .catch(() => setSettled(true));
  }, []);

  const platform = dictationPlatform();
  if (platform && support === null && !settled) return null;
  if (!support?.supported || !platform) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-tutorial="dictation.models dictation.language dictation.punctuation dictation.vocabulary"
      >
        {t(
          support?.reason === "library_missing"
            ? "dictation.section.libraryMissing"
            : "dictation.section.unsupported"
        )}
      </p>
    );
  }

  const byLanguage = new Map<DictationLanguage, ModelSpec[]>();
  for (const spec of modelsFor(MODEL_CATALOG, platform)) {
    for (const language of spec.languages)
      byLanguage.set(language, [...(byLanguage.get(language) ?? []), spec]);
  }

  const languages = [...byLanguage.keys()];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{t("dictation.section.title")}</span>
        <Switch checked={enabled} onChange={setEnabled} label={t("dictation.section.title")} />
      </div>
      <p className="text-sm text-muted-foreground">{t("dictation.section.description")}</p>
      {languages.length > 0 && (
        <DictationLanguageTabs
          languages={languages}
          selected={languages.includes(chosen) ? chosen : languages[0]}
          onChange={setChosen}
          ariaLabel={t("dictation.language")}
          tutorialAnchor="dictation.language"
        >
          {(language) => {
            const specs = byLanguage.get(language) ?? [];
            const capabilities =
              (pickModel(language, specs, installed, preferred) ?? specs[0])?.capabilities ??
              catalogCapabilities(language);
            return (
              <div className="space-y-6">
                <div className="space-y-2" data-tutorial="dictation.models">
                  <h3 className="font-medium">{t("dictation.section.models")}</h3>
                  {specs.map((spec) => {
                    const name = `${t(`dictation.languageNames.${language}`)}, ${t(`dictation.section.${spec.tier}`)}`;
                    const download = downloads[spec.id];
                    const isInstalled = installed.includes(spec.id);
                    const inUse = isInstalled && preferred[language] === spec.tier;
                    return (
                      <fieldset
                        key={spec.id}
                        aria-label={name}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
                      >
                        <div className="min-w-48 flex-1">
                          <div className="font-medium">
                            {t(`dictation.section.${spec.tier}`)} ·{" "}
                            {t("dictation.section.size", { size: sizeMb(spec) })}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {t(`dictation.section.${spec.tier}Hint`)}
                          </div>
                          {!spec.capabilities.punctuation && (
                            <div className="text-sm text-muted-foreground">
                              {t("dictation.section.noPunctuation")}
                            </div>
                          )}
                        </div>
                        {download && (
                          <progress
                            key="progress"
                            className="h-2 w-40 appearance-none overflow-hidden rounded-lg bg-border [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-primary"
                            max={100}
                            value={Math.round((download.done / download.total) * 100)}
                            aria-valuenow={Math.round((download.done / download.total) * 100)}
                            aria-label={t("dictation.section.progress", {
                              done: Math.round(download.done / MB),
                              total: Math.round(download.total / MB),
                            })}
                          />
                        )}
                        {!download && isInstalled && inUse && (
                          <span key="in-use" className="text-sm">
                            {t("dictation.section.inUse", {
                              language: t(`dictation.languages.${language}`),
                            })}
                          </span>
                        )}
                        {!download && isInstalled && !inUse && (
                          <Button
                            key="use"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setPreferred(language, spec.tier);
                              // The button becomes text; keep focus in the row.
                              actionRefs.current.get(spec.id)?.focus();
                            }}
                          >
                            {t("dictation.section.useThis", {
                              language: t(`dictation.languages.${language}`),
                            })}
                          </Button>
                        )}
                        {/* One action button whose label follows the row's state
                    (Download, Cancel, Remove), so focus stays on it. */}
                        <Button
                          key="action"
                          ref={(el) => {
                            if (el) actionRefs.current.set(spec.id, el);
                            else actionRefs.current.delete(spec.id);
                          }}
                          variant={download ? "secondary" : isInstalled ? "ghost" : "primary"}
                          size="sm"
                          onClick={() =>
                            void getDictation()
                              .then((r) =>
                                download
                                  ? r.cancelInstall(spec.id)
                                  : isInstalled
                                    ? r.remove(spec.id)
                                    : r.install(spec)
                              )
                              .catch(() => {})
                          }
                        >
                          {t(
                            download
                              ? "dictation.section.cancel"
                              : isInstalled
                                ? "dictation.section.remove"
                                : "dictation.section.download"
                          )}
                        </Button>
                      </fieldset>
                    );
                  })}
                </div>
                <div data-tutorial="dictation.punctuation">
                  <SpokenPunctuationSection language={language} capabilities={capabilities} />
                </div>
                <div data-tutorial="dictation.vocabulary">
                  <DictationVocabularySection language={language} />
                </div>
              </div>
            );
          }}
        </DictationLanguageTabs>
      )}
      {device && (
        <p className="text-sm text-muted-foreground">{t("dictation.section.device", { device })}</p>
      )}
      {recent && recent.medianLatencyMs !== null && (
        <p className="text-sm text-muted-foreground">
          {t("dictation.section.recent", {
            lines: recent.lines,
            ms: recent.medianLatencyMs,
          })}
        </p>
      )}
      {recent && recent.medianInterpreterMs !== null && (
        <p className="text-sm text-muted-foreground">
          {t("dictation.section.interpreter", {
            median: formatMs(recent.medianInterpreterMs),
            max: formatMs(recent.maxInterpreterMs ?? recent.medianInterpreterMs),
            count: recent.spokenPunctuationCount,
            voice: recent.voiceCommandCount,
            scratch: recent.scratchCount,
          })}
        </p>
      )}
      {recent && recent.medianInterpreterMs !== null && (
        <p className="text-sm text-muted-foreground">
          {t("dictation.section.voiceUnavailable", {
            count: recent.voiceCommandUnavailableCount,
          })}{" "}
          {t("dictation.section.voiceRefused", { count: recent.voiceCommandRefusedCount })}
        </p>
      )}
    </div>
  );
}
