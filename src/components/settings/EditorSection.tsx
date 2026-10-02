import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/features/settings";
import { Button, Modal, Switch } from "@/components/ui";
import { PasteCleanupSection } from "@/components/settings/PasteCleanupSection";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsSection, SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";

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
    <SettingsSection
      sectionId="editor"
      title={t("settings.editor")}
      data-tutorial="settings.editor"
    >
      <SettingRow id="spellCheck" className={SETTINGS_ROW_CLASS}>
        <Switch
          checked={spellCheckEnabled}
          onChange={setSpellCheckEnabled}
          label={t("settings.toggleSpellCheck")}
        />
      </SettingRow>

      <SettingRow id="dictionaryOpenInBrowser" className={SETTINGS_ROW_CLASS}>
        <Switch
          checked={dictionaryOpenInBrowser}
          onChange={setDictionaryOpenInBrowser}
          label={t("settings.toggleDictionaryOpenInBrowser")}
        />
      </SettingRow>

      <SettingRow
        id="customDictionary"
        className={SETTINGS_ROW_CLASS}
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

      <SettingRow id="showInlineFootnotes" className={SETTINGS_ROW_CLASS}>
        <Switch
          checked={showInlineFootnotes}
          onChange={setShowInlineFootnotes}
          label={t("settings.toggleInlineFootnotes")}
        />
      </SettingRow>

      <SettingRow id="showNotesChapter" className={SETTINGS_ROW_CLASS}>
        <Switch
          checked={showNotesChapter}
          onChange={setShowNotesChapter}
          label={t("settings.toggleNotesChapter")}
        />
      </SettingRow>

      <SettingRow id="hideKeyboardHints" className={SETTINGS_ROW_CLASS}>
        <Switch
          checked={hideKeyboardHints}
          onChange={setHideKeyboardHints}
          label={t("settings.toggleHideKeyboardHints")}
        />
      </SettingRow>

      <SettingRow id="editorAutoClose" className={SETTINGS_ROW_CLASS}>
        <Switch
          checked={editorAutoClose}
          onChange={setEditorAutoClose}
          label={t("settings.toggleEditorAutoClose")}
        />
      </SettingRow>

      <div className="py-3">
        <h3 className="font-medium">{t("settings.pasteCleanup.title")}</h3>
        <p className="text-sm text-muted-foreground mb-1">
          {t("settings.pasteCleanup.description")}
        </p>
        <PasteCleanupSection />
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
    </SettingsSection>
  );
}
