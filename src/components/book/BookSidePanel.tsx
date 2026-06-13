import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { Chapter } from "../../features/chapters/types";
import type { Note } from "../../features/notes";
import { FootnotesView } from "../editor/FootnotesView";
import { BookNotesView } from "./BookNotesView";

export type BookSidePanelTab = "footnotes" | "notes";

interface BookSidePanelProps {
  isOpen: boolean;
  activeTab: BookSidePanelTab;
  onTabChange: (tab: BookSidePanelTab) => void;
  onClose: () => void;
  // footnotes
  chapters: Chapter[];
  currentChapterId: string | null;
  onSelectChapter: (chapter: Chapter) => void;
  // notes
  notes: Note[];
  onCreateNote: (html: string) => void;
  onOpenNote: (noteId: string) => void;
}

export function BookSidePanel({
  isOpen,
  activeTab,
  onTabChange,
  onClose,
  chapters,
  currentChapterId,
  onSelectChapter,
  notes,
  onCreateNote,
  onOpenNote,
}: BookSidePanelProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const tab = (value: BookSidePanelTab, label: string) => (
    <button
      type="button"
      aria-pressed={activeTab === value}
      onClick={() => onTabChange(value)}
      className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
        activeTab === value
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <aside className="notes-panel">
      <div className="notes-panel-header">
        <div className="flex items-center gap-1">
          {tab("footnotes", t("bookSidePanel.footnotes"))}
          {tab("notes", t("bookSidePanel.notes"))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="notes-panel-close"
          aria-label={t("common.close")}
          title={t("common.close")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {activeTab === "footnotes" ? (
        <div className="notes-panel-content">
          <FootnotesView
            chapters={chapters}
            currentChapterId={currentChapterId}
            onSelectChapter={onSelectChapter}
          />
        </div>
      ) : (
        <BookNotesView
          notes={notes}
          onCreateNote={onCreateNote}
          onOpenNote={onOpenNote}
        />
      )}
    </aside>
  );
}
