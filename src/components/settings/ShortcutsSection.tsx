import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui";
import { ShortcutEditorDialog } from "@/components/shortcuts/ShortcutEditorDialog";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsSection, SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";

export function ShortcutsSection() {
  const { t } = useTranslation();
  const [showShortcutEditor, setShowShortcutEditor] = useState(false);

  return (
    <SettingsSection sectionId="shortcuts" title={t("shortcuts.title")}>
      <SettingRow id="customizeShortcuts" labelHidden className={SETTINGS_ROW_CLASS}>
        <Button
          variant="secondary"
          data-tutorial="settings.shortcuts dictation.voice-commands"
          onClick={() => setShowShortcutEditor(true)}
        >
          {t("shortcutEditor.open")}
        </Button>
      </SettingRow>
      <ShortcutEditorDialog
        isOpen={showShortcutEditor}
        onClose={() => setShowShortcutEditor(false)}
      />
    </SettingsSection>
  );
}
