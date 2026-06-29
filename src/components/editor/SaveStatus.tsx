import { useTranslation } from "react-i18next";
import { CheckIcon, SaveIcon, SpinnerIcon } from "@/components/icons";

interface SaveStatusProps {
  status: "idle" | "saving" | "saved";
  onSave: () => void;
  disabled?: boolean;
  /** Optional shortcut hint appended to the save button tooltip, e.g. "Ctrl+S". */
  saveShortcut?: string;
}

export function SaveStatus({ status, onSave, disabled, saveShortcut }: SaveStatusProps) {
  const { t } = useTranslation();

  if (status === "saving") {
    return (
      <span className="flex items-center gap-1 text-sm text-muted-foreground">
        <SpinnerIcon className="w-4 h-4 animate-spin" />
        <span className="hidden sm:inline">{t("editor.saving")}</span>
      </span>
    );
  }

  if (status === "saved") {
    return (
      <span className="flex items-center gap-1 text-sm text-success">
        <CheckIcon className="w-4 h-4" />
        <span className="hidden sm:inline">{t("editor.saved")}</span>
      </span>
    );
  }

  const title = saveShortcut ? `${t("common.save")} (${saveShortcut})` : t("common.save");

  return (
    <button
      type="button"
      onClick={onSave}
      disabled={disabled}
      title={title}
      className="p-2 rounded transition-colors text-muted-foreground hover:text-primary"
    >
      <SaveIcon className="w-5 h-5" />
    </button>
  );
}
