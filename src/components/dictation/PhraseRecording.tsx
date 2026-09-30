import { useTranslation } from "react-i18next";
import { Mic } from "lucide-react";
import type { PhraseRecording } from "@/features/dictation/usePhraseRecording";

/**
 * The record button inside a phrase field (Phrase Recording), passed as the
 * `Input`'s `endAdornment`. A toggle: the name stays the same and
 * `aria-pressed` says whether it is listening. The same control on touch and
 * mouse, never revealed by hover.
 */
export function RecordPhraseButton({
  recording,
  label,
}: {
  recording: PhraseRecording;
  /** The accessible name; defaults to the Command's label. Distinct per field where several share a screen. */
  label?: string;
}) {
  const { t } = useTranslation();
  if (!recording.available) return null;
  const name = label ?? t("dictation.recordPhrase");
  return (
    <button
      type="button"
      aria-label={name}
      title={name}
      aria-pressed={recording.recording}
      onClick={recording.toggle}
      data-command="dictation.recordPhrase"
      className={`rounded-md p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary pointer-coarse:p-2 ${
        recording.recording
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Mic
        className={`h-4 w-4 ${recording.recording ? "animate-pulse" : ""}`}
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * What a Phrase Recording says under its field: listening, what was heard, a
 * cancel, or why it could not record. The status region stays mounted so each
 * message is announced; a failure is an alert styled like a refusal.
 */
export function PhraseRecordingStatus({
  recording,
  className = "",
}: {
  recording: PhraseRecording;
  className?: string;
}) {
  const { t } = useTranslation();
  const message = recording.message;
  let status = "";
  let error = "";
  if (message?.kind === "listening") {
    status = t("dictation.phraseRecording.listening", {
      language: t(`dictation.languageNames.${message.language}`),
    });
  } else if (message?.kind === "heard") {
    status = t("dictation.phraseRecording.heard", { phrase: message.text });
  } else if (message?.kind === "cancelled") {
    status = t("dictation.phraseRecording.cancelled");
  } else if (message?.kind === "busy") {
    status = t("dictation.phraseRecording.busy");
  } else if (message?.kind === "error") {
    error = t(`dictation.errors.${message.code}`, {
      language: message.language ? t(`dictation.languages.${message.language}`) : "",
    });
  }
  if (!recording.available && message === null) return null;
  return (
    <>
      <p role="status" className={`text-xs text-muted-foreground ${className}`}>
        {status}
      </p>
      {error && (
        <div
          role="alert"
          className={`rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-foreground ${className}`}
        >
          {error}
        </div>
      )}
    </>
  );
}
