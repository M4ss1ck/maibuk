import { Mic } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DictationLanguage } from "@/features/dictation/types";

/** How many of a Command's Voice Commands a row shows before "+N more". */
export const VOICE_PREVIEW_COUNT = 3;

interface VoicePhraseSummaryProps {
  phrases: readonly string[];
  language: DictationLanguage;
  previewCount?: number;
  /** The shortcut help hides Commands with no phrases instead of naming it. */
  hideWhenEmpty?: boolean;
}

/**
 * The `Voice (English): <chips>` row summary shared by the Shortcut Editor
 * and the shortcut help: the same label, chips, and "+N more" in both.
 */
export function VoicePhraseSummary({
  phrases,
  language,
  previewCount = VOICE_PREVIEW_COUNT,
  hideWhenEmpty = false,
}: VoicePhraseSummaryProps) {
  const { t } = useTranslation();
  if (hideWhenEmpty && phrases.length === 0) return null;
  const shown = phrases.slice(0, previewCount);
  const more = phrases.length - shown.length;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Mic className="h-3 w-3" aria-hidden="true" />
      <span>
        {t("shortcutEditor.voice.rowLabel", {
          language: t(`dictation.languageNames.${language}`),
        })}
      </span>
      {shown.map((phrase) => (
        <span key={phrase} className="rounded-md bg-muted/50 px-1.5 py-0.5 text-foreground">
          {phrase}
        </span>
      ))}
      {more > 0 && <span>{t("shortcutEditor.voice.more", { count: more })}</span>}
      {phrases.length === 0 && <span>{t("shortcutEditor.voice.none")}</span>}
    </p>
  );
}
