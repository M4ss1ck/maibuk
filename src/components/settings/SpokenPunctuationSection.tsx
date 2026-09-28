import { useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import {
  entriesFor,
  findAliasRefusal,
  isEntryEnabled,
  type AliasRefusal,
  type PhraseAction,
  type SpokenPunctuationEntry,
  type SpokenPunctuationLanguageSettings,
} from "@/features/dictation/spoken-punctuation";
import { useDictationStore } from "@/features/dictation/store";
import type { DictationLanguage, ModelSpec } from "@/features/dictation/types";

interface SpokenPunctuationSectionProps {
  /** The Dictation Languages this build offers, in display order. */
  languages: readonly DictationLanguage[];
  /** What the picked Dictation Model of a language can do; sets the entry defaults. */
  capabilitiesFor: (language: DictationLanguage) => ModelSpec["capabilities"];
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
    case "literal":
      return t("dictation.spokenPunctuation.insertsLabels.literal");
    case "scratch":
      return t("dictation.spokenPunctuation.insertsLabels.scratch");
  }
}

function refusalMessage(t: TFunction, refusal: AliasRefusal, phrase: string): string {
  switch (refusal.kind) {
    case "empty":
      return t("dictation.spokenPunctuation.refused.empty");
    case "duplicate":
      return t("dictation.spokenPunctuation.refused.duplicate", { phrase });
    case "escape":
      return t("dictation.spokenPunctuation.refused.escape", {
        phrase,
        word: refusal.word,
      });
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
  const [refusal, setRefusal] = useState<AliasRefusal | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const refusalId = useId();

  const entryName = entry.phrases[0];
  const enabled = isEntryEnabled(entry, settings, capabilities);
  const aliases = settings.aliases[entry.id] ?? [];
  const customized = aliases.length > 0 || settings.entries[entry.id] !== undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = phrase.trim();
    if (trimmed === "") return;
    const nextRefusal = findAliasRefusal({
      language,
      entryId: entry.id,
      alias: trimmed,
      settings,
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
                  onClick={() => removeAlias(language, entry.id, alias)}
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
              }}
              aria-label={t("dictation.spokenPunctuation.aliasLabel", { entry: entryName })}
              placeholder={t("dictation.spokenPunctuation.aliasPlaceholder")}
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
              }}
              aria-label={t("dictation.spokenPunctuation.reset", { entry: entryName })}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("dictation.spokenPunctuation.resetShort")}
            </Button>
          )}
        </form>

        {refusal && (
          <div
            id={refusalId}
            role="alert"
            className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-foreground"
          >
            {refusalMessage(t, refusal, phrase.trim())}
          </div>
        )}
      </fieldset>
    </li>
  );
}

/**
 * Settings → Dictation's Spoken Punctuation list: every entry of the chosen
 * Dictation Language with its phrases and what it inserts, a master switch,
 * a switch per entry, extra phrases, and a reset. Device-local (ADR 0014).
 */
export function SpokenPunctuationSection({
  languages,
  capabilitiesFor,
}: SpokenPunctuationSectionProps) {
  const { t, i18n } = useTranslation();
  const override = useDictationStore((state) => state.languageOverride);
  const spoken = useDictationStore((state) => state.spokenPunctuation);
  const setLanguageEnabled = useDictationStore((state) => state.setSpokenPunctuationEnabled);
  const [chosen, setChosen] = useState<DictationLanguage>(() => {
    const uiLanguage: DictationLanguage = i18n.language.startsWith("es") ? "es" : "en";
    return override ?? uiLanguage;
  });

  if (languages.length === 0) return null;
  const language = languages.includes(chosen) ? chosen : languages[0];
  const settings = spoken[language];
  const capabilities = capabilitiesFor(language);
  const languageName = t(`dictation.languageNames.${language}`);
  const masterLabel = t("dictation.spokenPunctuation.master", { language: languageName });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">{t("dictation.spokenPunctuation.title")}</h3>
        <Select<DictationLanguage>
          ariaLabel={t("dictation.language")}
          value={language}
          options={languages.map((value) => ({
            value,
            label: t(`dictation.languageNames.${value}`),
          }))}
          onChange={setChosen}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {t("dictation.spokenPunctuation.description")}
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{masterLabel}</span>
        <Switch
          checked={settings.enabled}
          onChange={(enabled) => setLanguageEnabled(language, enabled)}
          label={masterLabel}
        />
      </div>
      <ul
        aria-label={t("dictation.spokenPunctuation.listLabel", { language: languageName })}
        className="space-y-2"
      >
        {entriesFor(language).map((entry) => (
          <EntryRow
            key={entry.id}
            language={language}
            entry={entry}
            settings={settings}
            capabilities={capabilities}
          />
        ))}
      </ul>
    </div>
  );
}
