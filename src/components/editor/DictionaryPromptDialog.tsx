import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Modal, Select, Switch } from "@/components/ui";
import { LANGUAGE_OPTIONS, type Language } from "@/features/settings/types";

interface DictionaryPromptDialogProps {
  isOpen: boolean;
  defaultLanguage: Language;
  openInBrowser: boolean;
  onOpenInBrowserChange: (value: boolean) => void;
  onClose: () => void;
  onSubmit: (word: string, language: Language) => void;
}

export function DictionaryPromptDialog({
  isOpen,
  defaultLanguage,
  openInBrowser,
  onOpenInBrowserChange,
  onClose,
  onSubmit,
}: DictionaryPromptDialogProps) {
  const { t } = useTranslation();
  const [word, setWord] = useState("");
  const [language, setLanguage] = useState<Language>(defaultLanguage);

  useEffect(() => {
    if (isOpen) {
      setWord("");
      setLanguage(defaultLanguage);
    }
  }, [isOpen, defaultLanguage]);

  const trimmed = word.trim();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmed) return;
    onSubmit(trimmed, language);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("dictionary.promptTitle")}
      footer={
        <Button type="submit" form="dictionary-prompt-form" disabled={!trimmed}>
          {t("dictionary.lookUp")}
        </Button>
      }
    >
      <form id="dictionary-prompt-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          id="dictionary-prompt-word"
          label={t("dictionary.wordLabel")}
          placeholder={t("dictionary.wordPlaceholder")}
          value={word}
          onChange={(event) => setWord(event.target.value)}
          autoFocus
        />
        <div className="flex flex-col gap-1.5">
          <span className="block text-sm font-medium">{t("dictionary.languageLabel")}</span>
          <Select
            value={language}
            onChange={setLanguage}
            options={LANGUAGE_OPTIONS}
            ariaLabel={t("dictionary.languageLabel")}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">{t("settings.dictionaryOpenInBrowser")}</span>
          <Switch
            checked={openInBrowser}
            onChange={onOpenInBrowserChange}
            label={t("settings.dictionaryOpenInBrowser")}
          />
        </div>
      </form>
    </Modal>
  );
}
