import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { getDictation } from "@/features/dictation/runtime";
import type { PhraseRecordingResult } from "@/features/dictation/session";
import { useDictationStore } from "@/features/dictation/store";
import type { DictationErrorCode, DictationLanguage } from "@/features/dictation/types";
import { useShortcuts } from "@/lib/shortcuts";

export type PhraseRecordingMessage =
  | { kind: "listening"; language: DictationLanguage }
  | { kind: "heard"; text: string }
  | { kind: "cancelled" }
  | { kind: "busy" }
  | { kind: "error"; code: DictationErrorCode; language?: DictationLanguage };

export interface PhraseRecording {
  /** False when Dictation is off or unsupported here: the field shows no record button. */
  available: boolean;
  /** This field's recording is under way. */
  recording: boolean;
  message: PhraseRecordingMessage | null;
  toggle(): void;
  /** Drops the last message, for when the author edits the field. */
  clearMessage(): void;
}

/**
 * A Phrase Recording for one phrase field: the record button's state, the
 * `dictation.recordPhrase` binding while the field holds the caret, Escape to
 * cancel, and the message the field shows. The line lands through `onHeard`,
 * which replaces the field's draft; nothing is submitted.
 */
export function usePhraseRecording({
  language,
  fieldRef,
  onHeard,
}: {
  language: DictationLanguage;
  fieldRef: RefObject<HTMLInputElement | null>;
  onHeard: (text: string) => void;
}): PhraseRecording {
  const enabled = useDictationStore((state) => state.enabled);
  const supported = useDictationStore((state) => state.support?.supported === true);
  const available = enabled && supported;
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<PhraseRecordingMessage | null>(null);
  const [fieldFocused, setFieldFocused] = useState(false);
  const recordingRef = useRef(false);
  const onHeardRef = useRef(onHeard);
  onHeardRef.current = onHeard;
  const mounted = useRef(true);

  const cancel = useCallback(() => {
    if (!recordingRef.current) return;
    void getDictation().then((runtime) => runtime.session.cancelRecording());
  }, []);

  const start = useCallback(() => {
    if (recordingRef.current) return;
    recordingRef.current = true;
    setRecording(true);
    setMessage({ kind: "listening", language });
    // The line lands in the field, and Escape there cancels: the caret stays in it.
    fieldRef.current?.focus();
    void getDictation()
      .then((runtime) => runtime.session.recordPhrase(language))
      .catch(
        (): PhraseRecordingResult => ({ kind: "error", code: "unsupported" })
      )
      .then((result) => {
        recordingRef.current = false;
        if (!mounted.current) return;
        setRecording(false);
        if (result.kind === "heard") {
          onHeardRef.current(result.text);
          setMessage({ kind: "heard", text: result.text });
          fieldRef.current?.focus();
        } else if (result.kind === "cancelled") {
          setMessage({ kind: "cancelled" });
        } else if (result.kind === "busy") {
          setMessage({ kind: "busy" });
        } else {
          setMessage(result);
        }
      });
  }, [fieldRef, language]);

  const toggle = useCallback(() => {
    if (recordingRef.current) cancel();
    else start();
  }, [cancel, start]);

  // The Command is live only where it can act: a phrase field holding the
  // caret, or its own recording under way.
  useEffect(() => {
    const doc = fieldRef.current?.ownerDocument ?? document;
    const update = () => setFieldFocused(fieldRef.current !== null && doc.activeElement === fieldRef.current);
    update();
    doc.addEventListener("focusin", update);
    doc.addEventListener("focusout", update);
    return () => {
      doc.removeEventListener("focusin", update);
      doc.removeEventListener("focusout", update);
    };
  }, [fieldRef]);

  useShortcuts([{ id: "dictation.recordPhrase", onTrigger: toggle }], {
    enabled: available && (fieldFocused || recording),
  });

  // Escape cancels the recording before a dialog or an edit form sees it:
  // the capture phase on window runs ahead of every other key handler.
  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, cancel]);

  // A recording belongs to its field and its language: leaving either ends it.
  useEffect(() => cancel, [language, cancel]);
  useEffect(() => {
    if (!available) cancel();
  }, [available, cancel]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const clearMessage = useCallback(() => {
    setMessage((current) => (current === null || current.kind === "listening" ? current : null));
  }, []);

  return { available, recording, message, toggle, clearMessage };
}
