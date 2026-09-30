import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button as AriaButton, GridList, GridListItem } from "react-aria-components";
import { PencilLine, RotateCcw, X } from "lucide-react";
import { Button, Input, Modal } from "@/components/ui";
import { DictationLanguageTabs } from "@/components/dictation/DictationLanguageTabs";
import { PhraseRecordingStatus, RecordPhraseButton } from "@/components/dictation/PhraseRecording";
import { phraseConflictMessage } from "@/components/dictation/phrase-conflict-message";
import { normalizePhrase } from "@/features/dictation/normalize";
import { findPhraseConflict, type PhraseConflict } from "@/features/dictation/phrase-conflicts";
import { useDictationStore } from "@/features/dictation/store";
import { usePhraseRecording } from "@/features/dictation/usePhraseRecording";
import type { DictationLanguage } from "@/features/dictation/types";
import {
  VOICE_LANGUAGES,
  voicePhrasePolarity,
  voicePhrases,
} from "@/features/dictation/voice-commands";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { COMMANDS, type CommandDef, type CommandId } from "@/lib/shortcut-registry";

const ROW_CONTROL =
  "inline-flex items-center gap-1 rounded-md px-1.5 py-1 pointer-coarse:px-2.5 pointer-coarse:py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary";

interface VoiceCommandsDialogProps {
  id: CommandId | null;
  /** The Dictation Language the list opens on; a switch shows the other. */
  initialLanguage: DictationLanguage;
  onClose: () => void;
}

/**
 * A Command's Voice Commands in one Dictation Language (ADR 0014): add, edit,
 * remove, and reset the phrases, refused through the one phrase conflict
 * check. Opened from the Command's row in the Shortcut Editor.
 */
export function VoiceCommandsDialog({ id, initialLanguage, onClose }: VoiceCommandsDialogProps) {
  if (id === null) return null;
  return (
    <VoiceCommandsDialogContent
      key={id}
      id={id}
      initialLanguage={initialLanguage}
      onClose={onClose}
    />
  );
}

function VoiceCommandsDialogContent({
  id,
  initialLanguage,
  onClose,
}: Omit<VoiceCommandsDialogProps, "id"> & { id: CommandId }) {
  const { t: translate } = useTranslation();
  // Command labels are registry data, so their keys are plain strings.
  const t = translate as unknown as (key: string, options?: Record<string, unknown>) => string;
  const voice = useShortcutSettingsStore((state) => state.shortcuts.voice);
  const setVoicePhrases = useShortcutSettingsStore((state) => state.setCommandVoicePhrases);
  const resetVoicePhrases = useShortcutSettingsStore((state) => state.resetCommandVoicePhrases);
  const spokenPunctuation = useDictationStore((state) => state.spokenPunctuation);

  const [language, setLanguage] = useState<DictationLanguage>(initialLanguage);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ conflict: PhraseConflict; phrase: string } | null>(
    null
  );
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const refusalId = useId();
  // A recorded phrase replaces the draft (a new phrase or the one being
  // edited); Add or Save still decides, through the conflict check.
  const recorder = usePhraseRecording({
    language,
    fieldRef: inputRef,
    onHeard: (text) => {
      setDraft(text);
      setRefusal(null);
    },
  });

  const command = t((COMMANDS[id] as CommandDef).labelKey);
  const languageName = t(`dictation.languageNames.${language}`);
  const phrases = voicePhrases(id, language, voice);
  const customized = voice[id]?.[language] !== undefined;

  const announce = (message: string) => {
    // A repeated message must still be spoken.
    setAnnouncement("");
    queueMicrotask(() => setAnnouncement(message));
  };
  const focusField = () => inputRef.current?.focus();

  const startEdit = (phrase: string) => {
    setEditing(phrase);
    setDraft(phrase);
    setRefusal(null);
    queueMicrotask(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
    setRefusal(null);
    focusField();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const phrase = draft.trim();
    if (phrase === "") return;
    const conflict = findPhraseConflict({
      language,
      phrase,
      candidate: { kind: "voice", id, replacing: editing ?? undefined },
      voice,
      spokenPunctuation: spokenPunctuation[language],
    });
    if (conflict) {
      setRefusal({ conflict, phrase });
      focusField();
      return;
    }
    const next =
      // A new phrase goes first, so it is in view here and in the row's preview.
      editing === null
        ? [phrase, ...phrases]
        : phrases.map((existing) =>
            normalizePhrase(existing) === normalizePhrase(editing) ? phrase : existing
          );
    setVoicePhrases(id, language, next);
    announce(
      editing === null
        ? t("shortcutEditor.voice.announce.added", { phrase, command })
        : t("shortcutEditor.voice.announce.changed", { from: editing, phrase, command })
    );
    setEditing(null);
    setDraft("");
    setRefusal(null);
    focusField();
  };

  const remove = (phrase: string) => {
    setVoicePhrases(
      id,
      language,
      phrases.filter((existing) => existing !== phrase)
    );
    if (editing === phrase) {
      setEditing(null);
      setDraft("");
    }
    setRefusal(null);
    announce(t("shortcutEditor.voice.announce.removed", { phrase, command }));
    // The focused button went with its row.
    focusField();
  };

  const reset = () => {
    resetVoicePhrases(id, language);
    setEditing(null);
    setDraft("");
    setRefusal(null);
    announce(t("shortcutEditor.voice.announce.reset", { command, language: languageName }));
    focusField();
  };

  const onFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Escape leaves an edit first; a second Escape closes the dialog.
    if (event.key !== "Escape" || editing === null) return;
    event.preventDefault();
    event.stopPropagation();
    cancelEdit();
  };

  const polarityLabel = (phrase: string) => {
    const polarity = voicePhrasePolarity(id, language, phrase);
    return polarity ? t(`shortcutEditor.voice.polarity.${polarity}`) : null;
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t("shortcutEditor.voice.title", { command })}
      footer={
        <>
          {customized && (
            <Button variant="ghost" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("shortcutEditor.voice.reset", { language: languageName })}
            </Button>
          )}
          <Button onClick={onClose}>{t("common.close")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("shortcutEditor.voice.intro", { command })}
        </p>
        <DictationLanguageTabs
          languages={VOICE_LANGUAGES}
          selected={language}
          onChange={(next) => {
            setLanguage(next);
            setEditing(null);
            setDraft("");
            setRefusal(null);
          }}
          ariaLabel={t("dictation.language")}
        >
          {(_language) => (
            <>
              <GridList
                aria-label={t("shortcutEditor.voice.listLabel", { command, language: languageName })}
                onAction={(key) => startEdit(String(key))}
                renderEmptyState={() => (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    {t("shortcutEditor.voice.none")}
                  </p>
                )}
                className="max-h-64 overflow-auto rounded-lg border border-border"
              >
                {phrases.map((phrase) => {
                  const polarity = polarityLabel(phrase);
                  return (
                    <GridListItem
                      key={phrase}
                      id={phrase}
                      textValue={phrase}
                      className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-sm outline-none last:border-b-0 data-focus-visible:ring-2 data-focus-visible:ring-inset data-focus-visible:ring-primary"
                    >
                      <span className="min-w-0 flex-1 truncate text-foreground">{phrase}</span>
                      {polarity && (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {polarity}
                        </span>
                      )}
                      <AriaButton
                        className={ROW_CONTROL}
                        aria-label={t("shortcutEditor.voice.edit", { phrase })}
                        onPress={() => startEdit(phrase)}
                      >
                        <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
                      </AriaButton>
                      <AriaButton
                        className={ROW_CONTROL}
                        aria-label={t("shortcutEditor.voice.remove", { phrase, command })}
                        onPress={() => remove(phrase)}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </AriaButton>
                    </GridListItem>
                  );
                })}
              </GridList>

              <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
                <div className="min-w-48 flex-1">
                  <Input
                    ref={inputRef}
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setRefusal(null);
                      recorder.clearMessage();
                    }}
                    onKeyDown={onFieldKeyDown}
                    aria-label={
                      editing === null
                        ? t("shortcutEditor.voice.addLabel", { command, language: languageName })
                        : t("shortcutEditor.voice.editLabel", { phrase: editing })
                    }
                    placeholder={t("shortcutEditor.voice.placeholder")}
                    endAdornment={
                      recorder.available ? <RecordPhraseButton recording={recorder} /> : undefined
                    }
                    data-dictation="verbatim"
                    aria-invalid={refusal ? true : undefined}
                    aria-describedby={refusal ? refusalId : undefined}
                  />
                </div>
                <Button type="submit" variant="secondary" size="sm" disabled={draft.trim() === ""}>
                  {editing === null ? t("common.add") : t("common.save")}
                </Button>
                {editing !== null && (
                  <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
                    {t("common.cancel")}
                  </Button>
                )}
              </form>

              <PhraseRecordingStatus recording={recorder} />

              {refusal && (
                <div
                  id={refusalId}
                  role="alert"
                  className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-foreground"
                >
                  {phraseConflictMessage(translate, language, refusal.conflict, refusal.phrase, id)}
                </div>
              )}
            </>
          )}
        </DictationLanguageTabs>

        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </div>
    </Modal>
  );
}
