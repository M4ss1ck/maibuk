import { useTranslation } from "react-i18next";
import { SpinnerIcon } from "@/components/icons";

export function FileDropImportStatus() {
  const { t } = useTranslation();

  return (
    <div className="pointer-events-none sticky top-0 z-10 flex h-0 justify-center overflow-visible">
      <div
        className="mt-3 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground shadow-lg"
        role="status"
        aria-live="polite"
      >
        <SpinnerIcon className="h-4 w-4 animate-spin text-primary" />
        <span>{t("dropImport.importing")}</span>
      </div>
    </div>
  );
}
