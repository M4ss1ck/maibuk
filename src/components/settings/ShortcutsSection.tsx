import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui";
import { ShortcutEditorDialog } from "@/components/shortcuts/ShortcutEditorDialog";
import { SettingRow } from "@/components/settings/SettingRow";

export function ShortcutsSection() {
  const { t } = useTranslation();
  const [showShortcutEditor, setShowShortcutEditor] = useState(false);

  return (
    <section className="mb-6 @lg:mb-8">
      <h2
        tabIndex={-1}
        data-settings-section="shortcuts"
        className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3"
      >
        {t("shortcuts.title")}
      </h2>
      <SettingRow
        id="customizeShortcuts"
        labelHidden
        className="flex flex-col @lg:flex-row @lg:items-center justify-between py-3 gap-2 @lg:gap-4"
      >
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
    </section>
  );
}
