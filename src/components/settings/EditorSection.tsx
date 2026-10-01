import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/features/settings";
import { Button, Modal, Switch } from "@/components/ui";
import { PasteCleanupSection } from "@/components/settings/PasteCleanupSection";
import { SettingRow } from "@/components/settings/SettingRow";

const ROW_CLASS =
  "flex flex-col @lg:flex-row @lg:items-center justify-between py-2 gap-2 @lg:gap-4";

export function EditorSection() {
  const { t } = useTranslation();
  const {
    spellCheckEnabled,
    customDictionary,
    dictionaryOpenInBrowser,
    showInlineFootnotes,
    showNotesChapter,
    hideKeyboardHints,
    setSpellCheckEnabled,
    removeCustomWord,
    setDictionaryOpenInBrowser,
    setShowInlineFootnotes,
    setShowNotesChapter,
    setHideKeyboardHints,
    editorAutoClose,
    setEditorAutoClose,
  } = useSettings();
  const [customDictionaryOpen, setCustomDictionaryOpen] = useState(false);

  return (
    <section
      data-tutorial="settings.editor"
      className="mb-6 @lg:mb-8 rounded-xl border border-border p-4 @lg:p-5"
    >
      <h2
        tabIndex={-1}
        data-settings-section="editor"
        className="text-lg text-primary font-medium mb-4"
      >
        {t("settings.editor")}
      </h2>
      <div className="space-y-4">
        <SettingRow id="spellCheck" className={ROW_CLASS}>
          <Switch
            checked={spellCheckEnabled}
            onChange={setSpellCheckEnabled}
            label={t("settings.toggleSpellCheck")}
          />
        </SettingRow>

        <SettingRow id="dictionaryOpenInBrowser" className={ROW_CLASS}>
          <Switch
            checked={dictionaryOpenInBrowser}
            onChange={setDictionaryOpenInBrowser}
            label={t("settings.toggleDictionaryOpenInBrowser")}
          />
        </SettingRow>

        <SettingRow
          id="customDictionary"
          className={ROW_CLASS}
          labelExtra={
            <p className="text-xs text-muted-foreground mt-1">
              {t("settings.customDictionaryCount", {
                count: customDictionary.length,
              })}
            </p>
          }
        >
          <Button variant="primary" size="sm" onClick={() => setCustomDictionaryOpen(true)}>
            {t("settings.editCustomDictionary")}
          </Button>
        </SettingRow>

        <SettingRow id="showInlineFootnotes" className={ROW_CLASS}>
          <Switch
            checked={showInlineFootnotes}
            onChange={setShowInlineFootnotes}
            label={t("settings.toggleInlineFootnotes")}
          />
        </SettingRow>

        <SettingRow id="showNotesChapter" className={ROW_CLASS}>
          <Switch
            checked={showNotesChapter}
            onChange={setShowNotesChapter}
            label={t("settings.toggleNotesChapter")}
          />
        </SettingRow>

        <SettingRow id="hideKeyboardHints" className={ROW_CLASS}>
          <Switch
            checked={hideKeyboardHints}
            onChange={setHideKeyboardHints}
            label={t("settings.toggleHideKeyboardHints")}
          />
        </SettingRow>

        <SettingRow id="editorAutoClose" className={ROW_CLASS}>
          <Switch
            checked={editorAutoClose}
            onChange={setEditorAutoClose}
            label={t("settings.toggleEditorAutoClose")}
          />
        </SettingRow>

        <div className="border-t border-border pt-4">
          <p className="font-medium">{t("settings.pasteCleanup.title")}</p>
          <p className="text-sm text-muted-foreground mb-3">
            {t("settings.pasteCleanup.description")}
          </p>
          <PasteCleanupSection />
        </div>
      </div>

      <Modal
        isOpen={customDictionaryOpen}
        onClose={() => setCustomDictionaryOpen(false)}
        title={t("settings.customDictionaryTitle")}
        footer={
          <Button variant="destructive" onClick={() => setCustomDictionaryOpen(false)}>
            {t("common.close")}
          </Button>
        }
      >
        {customDictionary.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.customDictionaryEmpty")}</p>
        ) : (
          <div className="space-y-2">
            {customDictionary.map((word) => (
              <div
                key={word}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border"
              >
                <span className="text-sm">{word}</span>
                <Button variant="ghost" size="sm" onClick={() => removeCustomWord(word)}>
                  {t("settings.removeWord")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </section>
  );
}
