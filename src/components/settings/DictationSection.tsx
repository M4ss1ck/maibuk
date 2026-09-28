import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { MODEL_CATALOG, modelsFor } from "@/features/dictation/catalog";
import { getDictation } from "@/features/dictation/runtime";
import { useDictationStore } from "@/features/dictation/store";
import type { DictationLanguage, ModelSpec } from "@/features/dictation/types";
import { dictationPlatform } from "@/lib/platform";

const MB = 1_000_000;
const sizeMb = (spec: ModelSpec) =>
  Math.round(spec.files.reduce((sum, f) => sum + f.bytes, 0) / MB);

export function DictationSection() {
  const { t } = useTranslation();
  const support = useDictationStore((s) => s.support);
  const installed = useDictationStore((s) => s.installed);
  const downloads = useDictationStore((s) => s.downloads);
  const preferred = useDictationStore((s) => s.preferredTier);
  const setPreferred = useDictationStore((s) => s.setPreferredTier);
  const [recent, setRecent] = useState<{
    lines: number;
    medianLatencyMs: number | null;
  } | null>(null);

  const [device, setDevice] = useState<string | null>(null);
  // Support is null until the runtime reports; a build failure leaves it null for good.
  const [settled, setSettled] = useState(false);

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
    return <p className="text-sm text-muted-foreground">{t("dictation.section.unsupported")}</p>;
  }

  const byLanguage = new Map<DictationLanguage, ModelSpec[]>();
  for (const spec of modelsFor(MODEL_CATALOG, platform)) {
    for (const language of spec.languages)
      byLanguage.set(language, [...(byLanguage.get(language) ?? []), spec]);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("dictation.section.description")}</p>
      {[...byLanguage].map(([language, specs]) => (
        <div key={language} className="space-y-2">
          <h3 className="font-medium">{t(`dictation.languages.${language}`)}</h3>
          {specs.map((spec) => {
            const name = `${t(`dictation.languages.${language}`)}, ${t(`dictation.section.${spec.tier}`)}`;
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
                {download ? (
                  <>
                    <progress
                      className="w-40"
                      max={100}
                      value={Math.round((download.done / download.total) * 100)}
                      aria-valuenow={Math.round((download.done / download.total) * 100)}
                      aria-label={t("dictation.section.progress", {
                        done: Math.round(download.done / MB),
                        total: Math.round(download.total / MB),
                      })}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        void getDictation()
                          .then((r) => r.cancelInstall(spec.id))
                          .catch(() => {})
                      }
                    >
                      {t("dictation.section.cancel")}
                    </Button>
                  </>
                ) : isInstalled ? (
                  <>
                    {inUse ? (
                      <span className="text-sm">
                        {t("dictation.section.inUse", {
                          language: t(`dictation.languages.${language}`),
                        })}
                      </span>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setPreferred(language, spec.tier)}
                      >
                        {t("dictation.section.useThis", {
                          language: t(`dictation.languages.${language}`),
                        })}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void getDictation()
                          .then((r) => r.remove(spec.id))
                          .catch(() => {})
                      }
                    >
                      {t("dictation.section.remove")}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={() =>
                      void getDictation()
                        .then((r) => r.install(spec))
                        .catch(() => {})
                    }
                  >
                    {t("dictation.section.download")}
                  </Button>
                )}
              </fieldset>
            );
          })}
        </div>
      ))}
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
    </div>
  );
}
