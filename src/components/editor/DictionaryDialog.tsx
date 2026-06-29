import { type MouseEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@/features/settings/types";
import { lookupWord } from "@/lib/dictionary";
import { openExternal } from "@/lib/platform";
import { Modal } from "@/components/ui/Modal";

interface DictionaryDialogProps {
  isOpen: boolean;
  word: string;
  language: Language;
  onClose: () => void;
}

export function DictionaryDialog({ isOpen, word, language, onClose }: DictionaryDialogProps) {
  const { t } = useTranslation();
  const [html, setHtml] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const normalizedWord = useMemo(() => word.trim(), [word]);

  useEffect(() => {
    if (!isOpen || !normalizedWord) return;

    let cancelled = false;
    setIsLoading(true);
    setHasError(false);
    setHtml(null);

    lookupWord(normalizedWord, language)
      .then((result) => {
        if (cancelled) return;
        setHtml(result);
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

  // Open content links in the system browser instead of navigating in-app.
  const handleContentClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    event.preventDefault();
    openExternal(href);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={normalizedWord ?? t("dictionary.title")}
      size="wide"
      footer={
        wiktionaryUrl ? (
          <button
            type="button"
            onClick={() => openExternal(wiktionaryUrl)}
            className="text-sm text-primary hover:underline"
          >
            {t("dictionary.viewOnWiktionary")}
          </button>
        ) : null
      }
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : hasError || !html ? (
        <p className="text-sm text-muted-foreground">{t("dictionary.noDefinition")}</p>
      ) : (
        // biome-ignore lint/a11y/useKeyWithClickEvents: delegated handler only intercepts anchor clicks, which are natively keyboard-accessible
        <div
          className="wiktionary-content"
          onClick={handleContentClick}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is sanitized via DOMPurify in lookupWord
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </Modal>
  );
}
