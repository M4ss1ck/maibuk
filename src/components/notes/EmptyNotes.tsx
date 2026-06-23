import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { MaibukLogo } from "../icons";

interface EmptyNotesProps {
  onCreateNote: () => void;
  onBack?: () => void;
}

export function EmptyNotes({ onCreateNote, onBack }: EmptyNotesProps) {
  const { t } = useTranslation();

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {onBack && (
        <div className="px-4 py-1 border-b border-border flex items-center shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="max-w-40 truncate">{t("notes.backToProjects")}</span>
          </button>
        </div>
      )}
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <MaibukLogo className="w-16 text-primary opacity-60 mb-4" />
        <h2 className="text-xl font-serif font-medium">{t("notes.emptyEditorTitle")}</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {t("notes.emptyEditorBody")}
        </p>
        <button
          type="button"
          onClick={onCreateNote}
          className="mt-6 px-4 py-2 text-sm bg-primary text-white rounded hover:bg-primary-hover transition-colors"
        >
          {t("notes.newNote")}
        </button>
      </div>
    </div>
  );
}
