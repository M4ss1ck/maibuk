import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PhraseRecordingStatus, RecordPhraseButton } from "@/components/dictation/PhraseRecording";
import { useDictationStore } from "@/features/dictation/store";
import { usePhraseRecording } from "@/features/dictation/usePhraseRecording";
import type { DictationLanguage } from "@/features/dictation/types";
import { findVocabularyRefusal, type VocabularyRefusal } from "@/features/dictation/vocabulary";

interface DictationVocabularySectionProps {
  /** The Dictation Language of the Dictation settings tab this sits in. */
  language: DictationLanguage;
}

function refusalMessage(t: TFunction, refusal: VocabularyRefusal, phrase: string): string {
  switch (refusal.kind) {
    case "empty":
      return t("dictation.vocabulary.refused.empty");
    case "duplicate":
      return t("dictation.vocabulary.refused.duplicate", { phrase });
  }
}

/**
 * Settings → Dictation's Dictation Vocabulary editor: what the Dictation
 * Model hears and what to write instead, for one Dictation Language, on this
 * device (ADR 0014). The written form is inserted exactly as typed.
 */
export function DictationVocabularySection({ language }: DictationVocabularySectionProps) {
  const { t } = useTranslation();
  const vocabulary = useDictationStore((state) => state.vocabulary);
  const addEntry = useDictationStore((state) => state.addVocabularyEntry);
  const updateEntry = useDictationStore((state) => state.updateVocabularyEntry);
  const removeEntry = useDictationStore((state) => state.removeVocabularyEntry);

  const [heard, setHeard] = useState("");
  const [written, setWritten] = useState("");
  const [addRefusal, setAddRefusal] = useState<VocabularyRefusal | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editHeard, setEditHeard] = useState("");
  const [editWritten, setEditWritten] = useState("");
  const [editRefusal, setEditRefusal] = useState<VocabularyRefusal | null>(null);
  const heardRef = useRef<HTMLInputElement>(null);
  const editHeardRef = useRef<HTMLInputElement>(null);
  const editButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  /** The row whose Edit button gets focus once its form is gone. */
  const pendingEditFocus = useRef<number | null>(null);
  const addRefusalId = useId();
  const editRefusalId = useId();
  // Phrase Recording fills the heard form only: the written form is what the
  // author wants on the page, typed exactly.
  const addRecorder = usePhraseRecording({
    language,
    fieldRef: heardRef,
    onHeard: (text) => {
      setHeard(text);
      setAddRefusal(null);
    },
  });
  const editRecorder = usePhraseRecording({
    language,
    fieldRef: editHeardRef,
    onHeard: (text) => {
      setEditHeard(text);
      setEditRefusal(null);
    },
  });

  // The Edit form replaces the row's buttons: focus enters the form, and
  // leaving it returns to the button that opened it, never to <body>. Only the
  // index is a dependency, so typing in a field never steals the other's focus.
  useEffect(() => {
    if (editingIndex !== null) {
      editHeardRef.current?.focus();
    } else if (pendingEditFocus.current !== null) {
      editButtonRefs.current.get(pendingEditFocus.current)?.focus();
      pendingEditFocus.current = null;
    }
  }, [editingIndex]);

  const entries = vocabulary[language];
  const languageName = t(`dictation.languageNames.${language}`);
  const listLabel = t("dictation.vocabulary.listLabel", { language: languageName });

  const submitAdd = (event: FormEvent) => {
    event.preventDefault();
    const refusal = findVocabularyRefusal({ heard, written, entries });
    if (refusal) {
      setAddRefusal(refusal);
      heardRef.current?.focus();
      return;
    }
    addEntry(language, heard, written);
    setHeard("");
    setWritten("");
    setAddRefusal(null);
    heardRef.current?.focus();
  };

  const submitEdit = (event: FormEvent) => {
    event.preventDefault();
    if (editingIndex === null) return;
    const refusal = findVocabularyRefusal({
      heard: editHeard,
      written: editWritten,
      entries,
      editingIndex,
    });
    if (refusal) {
      setEditRefusal(refusal);
      editHeardRef.current?.focus();
      return;
    }
    pendingEditFocus.current = editingIndex;
    updateEntry(language, editingIndex, editHeard, editWritten);
    setEditingIndex(null);
    setEditRefusal(null);
  };

  const cancelEdit = () => {
    if (editingIndex === null) return;
    pendingEditFocus.current = editingIndex;
    setEditingIndex(null);
    setEditRefusal(null);
  };

  const onEditKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
  };

  const startEdit = (index: number) => {
    setEditRefusal(null);
    setEditHeard(entries[index].heard);
    setEditWritten(entries[index].written);
    setEditingIndex(index);
  };

  const removeAt = (index: number) => {
    if (editingIndex !== null) {
      // Removing another row shifts the edited one; keep editing it.
      if (index < editingIndex) setEditingIndex(editingIndex - 1);
      editHeardRef.current?.focus();
    } else {
      heardRef.current?.focus();
    }
    removeEntry(language, index);
  };

  const addRefusalText = addRefusal ? refusalMessage(t, addRefusal, heard.trim()) : "";
  const editRefusalText = editRefusal ? refusalMessage(t, editRefusal, editHeard.trim()) : "";

  return (
    <div className="space-y-3">
      <h3 className="font-medium">{t("dictation.vocabulary.title")}</h3>
      <p className="text-sm text-muted-foreground">{t("dictation.vocabulary.description")}</p>

      <form onSubmit={submitAdd} className="flex flex-wrap items-end gap-2">
        <div className="w-full @md:w-56">
          <Input
            ref={heardRef}
            value={heard}
            onChange={(event) => {
              setHeard(event.target.value);
              setAddRefusal(null);
              addRecorder.clearMessage();
            }}
            label={t("dictation.vocabulary.heardLabel")}
            placeholder={t("dictation.vocabulary.heardPlaceholder")}
            endAdornment={
              addRecorder.available ? (
                <RecordPhraseButton
                  recording={addRecorder}
                  label={t("dictation.phraseRecording.recordHeard")}
                />
              ) : undefined
            }
            data-dictation="verbatim"
            aria-invalid={addRefusal ? true : undefined}
            aria-describedby={addRefusal ? addRefusalId : undefined}
          />
        </div>
        <div className="w-full @md:w-56">
          <Input
            value={written}
            onChange={(event) => {
              setWritten(event.target.value);
              setAddRefusal(null);
            }}
            label={t("dictation.vocabulary.writtenLabel")}
            placeholder={t("dictation.vocabulary.writtenPlaceholder")}
            data-dictation="verbatim"
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={heard.trim() === "" || written.trim() === ""}
        >
          {t("dictation.vocabulary.add")}
        </Button>
      </form>

      <PhraseRecordingStatus recording={addRecorder} />

      {addRefusal && (
        <div
          id={addRefusalId}
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-foreground"
        >
          {addRefusalText}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("dictation.vocabulary.empty")}</p>
      ) : (
        <ul aria-label={listLabel} className="space-y-1.5">
          {entries.map((entry, index) => (
            <li key={index} className="rounded-lg border border-border">
              {editingIndex === index ? (
                <form
                  onSubmit={submitEdit}
                  onKeyDown={onEditKeyDown}
                  aria-label={t("dictation.vocabulary.edit", { phrase: entry.heard })}
                  className="flex flex-wrap items-end gap-2 p-2"
                >
                  <div className="w-full @md:w-56">
                    <Input
                      ref={editHeardRef}
                      value={editHeard}
                      onChange={(event) => {
                        setEditHeard(event.target.value);
                        setEditRefusal(null);
                        editRecorder.clearMessage();
                      }}
                      label={t("dictation.vocabulary.heardLabel")}
                      endAdornment={
                        editRecorder.available ? (
                          <RecordPhraseButton
                            recording={editRecorder}
                            label={t("dictation.phraseRecording.recordHeard")}
                          />
                        ) : undefined
                      }
                      data-dictation="verbatim"
                      aria-invalid={editRefusal ? true : undefined}
                      aria-describedby={editRefusal ? editRefusalId : undefined}
                    />
                  </div>
                  <div className="w-full @md:w-56">
                    <Input
                      value={editWritten}
                      onChange={(event) => {
                        setEditWritten(event.target.value);
                        setEditRefusal(null);
                      }}
                      label={t("dictation.vocabulary.writtenLabel")}
                      data-dictation="verbatim"
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    disabled={editHeard.trim() === "" || editWritten.trim() === ""}
                  >
                    {t("dictation.vocabulary.save")}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
                    {t("dictation.vocabulary.cancel")}
                  </Button>
                  <PhraseRecordingStatus recording={editRecorder} className="w-full" />
                  {editRefusal && (
                    <div
                      id={editRefusalId}
                      role="alert"
                      className="w-full rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-foreground"
                    >
                      {editRefusalText}
                    </div>
                  )}
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-2 p-2">
                  <span className="sr-only">
                    {t("dictation.vocabulary.entry", {
                      heard: entry.heard,
                      written: entry.written,
                    })}
                  </span>
                  <span aria-hidden="true" className="min-w-0 break-words text-sm">
                    {entry.heard}
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    →
                  </span>
                  <span aria-hidden="true" className="min-w-0 break-words text-sm font-medium">
                    {entry.written}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      ref={(el) => {
                        if (el) editButtonRefs.current.set(index, el);
                        else editButtonRefs.current.delete(index);
                      }}
                      variant="ghost"
                      size="sm"
                      aria-label={t("dictation.vocabulary.edit", { phrase: entry.heard })}
                      className="px-2 pointer-coarse:px-3"
                      onClick={() => startEdit(index)}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("dictation.vocabulary.remove", { phrase: entry.heard })}
                      className="px-2 pointer-coarse:px-3"
                      onClick={() => removeAt(index)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
