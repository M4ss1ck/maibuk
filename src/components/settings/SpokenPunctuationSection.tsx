import { useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button as AriaButton, Disclosure, DisclosurePanel } from "react-aria-components";
import { ChevronRight, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { phraseConflictMessage } from "@/components/dictation/phrase-conflict-message";
import { PhraseRecordingStatus, RecordPhraseButton } from "@/components/dictation/PhraseRecording";
import { findPhraseConflict, type PhraseConflict } from "@/features/dictation/phrase-conflicts";
import {
  entriesFor,
  isEntryEnabled,
  type PhraseAction,
  type SpokenPunctuationEntry,
  type SpokenPunctuationLanguageSettings,
} from "@/features/dictation/spoken-punctuation";
import { useDictationStore } from "@/features/dictation/store";
import { usePhraseRecording } from "@/features/dictation/usePhraseRecording";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import type { DictationLanguage, ModelSpec } from "@/features/dictation/types";

interface SpokenPunctuationSectionProps {
  /** The Dictation Language of the Dictation settings tab this sits in. */
  language: DictationLanguage;
  /** What the picked Dictation Model of the language can do; sets the entry defaults. */
  capabilities: ModelSpec["capabilities"];
}

function actionLabel(action: PhraseAction, t: TFunction): string {
  switch (action.kind) {
    case "mark":
      return action.mark;
    case "paragraph":
      return t("dictation.spokenPunctuation.insertsLabels.paragraph");
    case "line_break":
      return t("dictation.spokenPunctuation.insertsLabels.line_break");
    case "list_item":
      return t("dictation.spokenPunctuation.insertsLabels.list_item");
    case "cap":
      return t("dictation.spokenPunctuation.insertsLabels.cap");
    case "caps_on":
      return t("dictation.spokenPunctuation.insertsLabels.caps_on");
    case "caps_off":
      return t("dictation.spokenPunctuation.insertsLabels.caps_off");
    case "numeral":
      return t("dictation.spokenPunctuation.insertsLabels.numeral");
    case "literal":
      return t("dictation.spokenPunctuation.insertsLabels.literal");
    case "scratch":
      return t("dictation.spokenPunctuation.insertsLabels.scratch");
  }
}

function EntryRow({
  language,
  entry,
  settings,
  capabilities,
}: {
  language: DictationLanguage;
  entry: SpokenPunctuationEntry;
  settings: SpokenPunctuationLanguageSettings;
  capabilities: ModelSpec["capabilities"];
}) {
  const { t } = useTranslation();
  const setEntryEnabled = useDictationStore((state) => state.setSpokenPunctuationEntryEnabled);
  const addAlias = useDictationStore((state) => state.addSpokenPunctuationAlias);
  const removeAlias = useDictationStore((state) => state.removeSpokenPunctuationAlias);
  const resetEntry = useDictationStore((state) => state.resetSpokenPunctuationEntry);
  const [phrase, setPhrase] = useState("");
  const [refusal, setRefusal] = useState<PhraseConflict | null>(null);
  const voice = useShortcutSettingsStore((state) => state.shortcuts.voice);
  const inputRef = useRef<HTMLInputElement>(null);
  const refusalId = useId();
  const recorder = usePhraseRecording({
    language,
    fieldRef: inputRef,
    onHeard: (text) => {
      setPhrase(text);
      setRefusal(null);
    },
  });

  const entryName = entry.phrases[0];
  const enabled = isEntryEnabled(entry, settings, capabilities);
  const aliases = settings.aliases[entry.id] ?? [];
  const customized = aliases.length > 0 || settings.entries[entry.id] !== undefined;
  // Removing an alias or resetting the entry unmounts the focused button, so
  // focus moves to the field instead of falling to <body>.
  const focusField = () => inputRef.current?.focus();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = phrase.trim();
    if (trimmed === "") return;
    // One check for every kind of phrase: an alias that is a Voice Command
    // would never act, since the whole-line Command runs first.
    const nextRefusal = findPhraseConflict({
      language,
      phrase: trimmed,
      candidate: { kind: "alias", entryId: entry.id },
      voice,
      spokenPunctuation: settings,
    });
    if (nextRefusal) {
      setRefusal(nextRefusal);
      inputRef.current?.focus();
      return;
    }
    addAlias(language, entry.id, trimmed);
    setPhrase("");
    setRefusal(null);
    inputRef.current?.focus();
  };

  return (
    <li>
      <fieldset aria-label={entryName} className="min-w-0 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Switch
            checked={enabled}
            onChange={(next) => setEntryEnabled(language, entry.id, next)}
            label={entryName}
            disabled={!settings.enabled}
          />
          <ul
            aria-label={t("dictation.spokenPunctuation.phrasesFor", { entry: entryName })}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
          >
            {entry.phrases.map((defaultPhrase) => (
              <li
                key={defaultPhrase}
                className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
              >
                {defaultPhrase}
              </li>
            ))}
            {aliases.map((alias) => (
              <li
                key={alias}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
              >
                {alias}
                <button
                  type="button"
                  aria-label={t("dictation.spokenPunctuation.removeAlias", {
                    phrase: alias,
                    entry: entryName,
                  })}
                  onClick={() => {
                    removeAlias(language, entry.id, alias);
                    focusField();
                  }}
                  className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary pointer-coarse:h-8 pointer-coarse:w-8"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t("dictation.spokenPunctuation.inserts")}</span>
            {entry.actions.map((action, index) => (
              <span
                key={`${action.kind}-${index}`}
                className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground"
              >
                <span className={action.kind === "mark" ? "font-mono" : undefined}>
                  {actionLabel(action, t)}
                </span>
              </span>
            ))}
          </div>
        </div>

        <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-56">
            <Input
              ref={inputRef}
              value={phrase}
              onChange={(event) => {
                setPhrase(event.target.value);
                setRefusal(null);
                recorder.clearMessage();
              }}
              aria-label={t("dictation.spokenPunctuation.aliasLabel", { entry: entryName })}
              placeholder={t("dictation.spokenPunctuation.aliasPlaceholder")}
              endAdornment={
                recorder.available ? (
                  <RecordPhraseButton
                    recording={recorder}
                    label={t("dictation.phraseRecording.recordAlias", { entry: entryName })}
                  />
                ) : undefined
              }
              data-dictation="verbatim"
              aria-invalid={refusal ? true : undefined}
              aria-describedby={refusal ? refusalId : undefined}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={phrase.trim() === ""}
            aria-label={t("dictation.spokenPunctuation.addAlias", { entry: entryName })}
          >
            {t("dictation.spokenPunctuation.add")}
          </Button>
          {customized && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                resetEntry(language, entry.id);
                setRefusal(null);
                focusField();
              }}
              aria-label={t("dictation.spokenPunctuation.reset", { entry: entryName })}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("dictation.spokenPunctuation.resetShort")}
            </Button>
          )}
        </form>

        <PhraseRecordingStatus recording={recorder} className="mt-2" />

        {refusal && (
          <div
            id={refusalId}
            role="alert"
            className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-foreground"
          >
            {phraseConflictMessage(t, language, refusal, phrase.trim())}
          </div>
        )}
      </fieldset>
    </li>
  );
}

/**
 * Settings → Dictation's Spoken Punctuation list for one Dictation Language:
 * a master switch, and behind a collapsed disclosure every entry with its
 * phrases and what it inserts, a switch per entry, extra phrases, and a
 * reset. Device-local (ADR 0014).
 */
export function SpokenPunctuationSection({
  language,
  capabilities,
}: SpokenPunctuationSectionProps) {
  const { t } = useTranslation();
  const settings = useDictationStore((state) => state.spokenPunctuation[language]);
  const setLanguageEnabled = useDictationStore((state) => state.setSpokenPunctuationEnabled);
  const [isExpanded, setExpanded] = useState(false);

  const languageName = t(`dictation.languageNames.${language}`);
  const masterLabel = t("dictation.spokenPunctuation.master", { language: languageName });
  const listLabel = t("dictation.spokenPunctuation.listLabel", { language: languageName });
  const entries = entriesFor(language);

  return (
    <Disclosure isExpanded={isExpanded} onExpandedChange={setExpanded} className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h3 className="font-medium">{t("dictation.spokenPunctuation.title")}</h3>
          <span className="text-xs text-muted-foreground">
            {t("dictation.spokenPunctuation.entryCount", { count: entries.length })}
          </span>
        </div>
        <Switch
          checked={settings.enabled}
          onChange={(enabled) => setLanguageEnabled(language, enabled)}
          label={masterLabel}
        />
        <AriaButton
          slot="trigger"
          aria-label={listLabel}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <ChevronRight
            className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
        </AriaButton>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("dictation.spokenPunctuation.description")}
      </p>
      <DisclosurePanel>
        <ul aria-label={listLabel} className="space-y-2">
          {entries.map((entry) => (
            <EntryRow
              key={entry.id}
              language={language}
              entry={entry}
              settings={settings}
              capabilities={capabilities}
            />
          ))}
        </ul>
      </DisclosurePanel>
    </Disclosure>
  );
}
