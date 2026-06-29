import { Modal, KeyboardShortcut } from "@/components/ui";
import { useTranslation } from "react-i18next";

interface ShortcutItem {
  id: string;
  label: string;
  keys: string[];
}

interface ShortcutsHelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  shortcuts: ShortcutItem[];
}

export function ShortcutsHelpDialog({
  isOpen,
  onClose,
  title,
  shortcuts,
}: ShortcutsHelpDialogProps) {
  const { t } = useTranslation();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} footer={null}>
      <div className="space-y-2">
        {shortcuts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("shortcuts.none")}</p>
        ) : (
          shortcuts.map((shortcut) => (
            <div
              key={shortcut.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
            >
              <span className="text-sm text-foreground">{shortcut.label}</span>
              <KeyboardShortcut keys={shortcut.keys} alwaysVisible />
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
