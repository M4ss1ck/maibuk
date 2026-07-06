import { useTranslation } from "react-i18next";
import { CheckIcon, SaveIcon, SpinnerIcon } from "@/components/icons";
import { Tooltip } from "@/components/ui";

interface SaveStatusProps {
  status: "idle" | "saving" | "saved";
  onSave: () => void;
  disabled?: boolean;
}

export function SaveStatus({ status, onSave, disabled }: SaveStatusProps) {
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

  return (
    <Tooltip content={t("common.save")} shortcut="editor.save">
      <button
        type="button"
        onClick={onSave}
        disabled={disabled}
        aria-label={t("common.save")}
        className="p-2 rounded transition-colors text-muted-foreground hover:text-primary"
      >
        <SaveIcon className="w-5 h-5" />
      </button>
    </Tooltip>
  );
}
