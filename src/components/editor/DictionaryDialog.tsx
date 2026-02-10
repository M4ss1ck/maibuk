import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import type { Language } from "../../features/settings/types";
import { lookupWord, type DictionaryEntry } from "../../lib/dictionary";

interface DictionaryDialogProps {
  isOpen: boolean;
  word: string;
  language: Language;
  onClose: () => void;
}

export function DictionaryDialog({ isOpen, word, language, onClose }: DictionaryDialogProps) {
  const { t } = useTranslation();
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const normalizedWord = useMemo(() => word.trim(), [word]);

  useEffect(() => {
    if (!isOpen || !normalizedWord) return;

    let cancelled = false;
    setIsLoading(true);
    setHasError(false);
    setEntry(null);

    lookupWord(normalizedWord, language)
      .then((result) => {
        if (cancelled) return;
        setEntry(result);
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setHasError(true);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, normalizedWord, language]);

  const wiktionaryUrl = normalizedWord
    ? `https://${language}.wiktionary.org/wiki/${encodeURIComponent(normalizedWord)}`
    : "";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={normalizedWord ?? t("dictionary.title")}
      footer={
        wiktionaryUrl ? (
          <a
            href={wiktionaryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline"
          >
            {t("dictionary.viewOnWiktionary")}
          </a>
        ) : null
      }
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : hasError || !entry || entry.meanings.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("dictionary.noDefinition")}</p>
      ) : (
        <div className="space-y-4">
          {entry.phonetic && (
            <div className="text-sm text-muted-foreground">
              {t("dictionary.phonetic")}: {entry.phonetic}
            </div>
          )}

          {entry.meanings.map((meaning, index) => (
            <div key={`${meaning.partOfSpeech}-${index}`} className="space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                {meaning.partOfSpeech}
              </p>
              <ol className="list-decimal pl-5 space-y-2 text-sm">
                {meaning.definitions.map((definition, defIndex) => (
                  <li key={`${definition.definition}-${defIndex}`}>
                    <p>{definition.definition}</p>
                    {definition.example && (
                      <p className="text-xs text-muted-foreground mt-1">
                        “{definition.example}”
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}

          {entry.translations && entry.translations.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                {t("dictionary.translations")}
              </p>
              <ul className="space-y-2 text-sm">
                {entry.translations.slice(0, 8).map((translation) => (
                  <li key={translation.language} className="flex flex-wrap gap-x-2">
                    <span className="font-medium text-foreground">{translation.language}:</span>
                    <span className="text-muted-foreground">
                      {translation.words.slice(0, 6).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
