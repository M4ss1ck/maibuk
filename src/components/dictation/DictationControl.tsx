import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Mic, MicOff, Loader2, Settings2 } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { installedDictationLanguages, setDictationLanguage } from "@/features/dictation/language";
import { getDictation } from "@/features/dictation/runtime";
import { useDictationStore } from "@/features/dictation/store";
import type { DictationLanguage } from "@/features/dictation/types";
import { useCommandHint } from "@/lib/command-keys";
import type { FormattedShortcut } from "@/lib/shortcut-keys";

const AUTO = "auto";

/** A formatted shortcut as readable text for an aria-label / title. */
function hintText(formatted: FormattedShortcut): string {
  return formatted.groups.map((chips) => chips.join("+")).join(" ");
}

/** One per editor page, fixed to the page's bottom right; every editor on the page shares it. */
export function DictationControl() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const support = useDictationStore((s) => s.support);
  const enabled = useDictationStore((s) => s.enabled);
  const snapshot = useDictationStore((s) => s.snapshot);
  const installed = useDictationStore((s) => s.installed);
  const languageOverride = useDictationStore((s) => s.languageOverride);
  const hint = useCommandHint("dictation.toggle");

  // Unsupported builds reject when the runtime cannot be built; the control
  // simply stays unrendered instead of throwing at mount.
  useEffect(() => {
    void getDictation().catch(() => {});
  }, []);

  const languages = installedDictationLanguages(installed);

  if (!enabled || !support?.supported) return null;

  const listening = snapshot.status === "listening" || snapshot.status === "stopping";
  const loading = snapshot.status === "loading";
  const noModel = languages.length === 0;
  const openSettings = () => navigate("/settings#dictation");

  const label = noModel
    ? t("dictation.downloadModel")
    : listening
      ? t("dictation.stop")
      : t("dictation.start");
  const hintLabel = hint ? ` (${hintText(hint.formatted)})` : "";
  const ring = listening ? Math.min(1, snapshot.level * 4) : 0;

  return (
    <div className="fixed bottom-4 right-4 z-30 flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-lg">
      <button
        type="button"
        data-command="dictation.toggle"
        aria-pressed={noModel ? undefined : listening}
        aria-label={`${label}${hintLabel}`}
        title={`${label}${hintLabel}`}
        onClick={() =>
          noModel
            ? openSettings()
            : void getDictation()
                .then((r) => r.session.toggle())
                .catch(() => {})
        }
        className={`relative inline-flex h-10 w-10 items-center justify-center rounded-lg pointer-coarse:h-12 pointer-coarse:w-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          listening ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted/20"
        }`}
        style={
          listening
            ? {
                boxShadow: `0 0 0 ${2 + ring * 6}px color-mix(in oklab, var(--color-primary) 35%, transparent)`,
              }
            : undefined
        }
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        ) : noModel ? (
          <MicOff className="h-5 w-5" aria-hidden />
        ) : (
          <Mic className="h-5 w-5" aria-hidden />
        )}
      </button>
      {!noModel && (
        <Select<string>
          ariaLabel={t("dictation.language")}
          minWidth="none"
          className="w-20"
          triggerClassName="pointer-coarse:min-h-12"
          value={languageOverride ?? AUTO}
          options={[
            { value: AUTO, label: AUTO, accessibleName: t("dictation.languageAuto") },
            ...languages.map((l) => ({
              value: l,
              label: l,
              accessibleName: t(`dictation.languageNames.${l}`),
            })),
          ]}
          onChange={(value) => {
            void setDictationLanguage(value === AUTO ? null : (value as DictationLanguage)).catch(
              () => {}
            );
          }}
        />
      )}
      <button
        type="button"
        aria-label={t("dictation.settings")}
        title={t("dictation.settings")}
        onClick={openSettings}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-foreground hover:bg-muted/20 pointer-coarse:h-12 pointer-coarse:w-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Settings2 className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}
