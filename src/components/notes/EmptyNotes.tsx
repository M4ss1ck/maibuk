import { useTranslation } from "react-i18next";
import logo from "../../../src-tauri/icons/icon.png";

interface EmptyNotesProps {
  onCreateNote: () => void;
}

export function EmptyNotes({ onCreateNote }: EmptyNotesProps) {
  const { t } = useTranslation();

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <img src={logo} alt="Maibuk" className="w-16 opacity-60 mb-4" />
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
  );
}
