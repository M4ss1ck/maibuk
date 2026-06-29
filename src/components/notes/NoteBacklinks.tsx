import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getBacklinksForNote, type BacklinkEntry } from "@/features/links/link-index";

interface NoteBacklinksProps {
  noteId: string;
  onOpen: (noteId: string) => void;
}

export function NoteBacklinks({ noteId, onOpen }: NoteBacklinksProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<BacklinkEntry[]>([]);

  useEffect(() => {
    let active = true;
    void getBacklinksForNote(noteId).then((rows) => {
      if (active) setEntries(rows);
    });
    return () => {
      active = false;
    };
  }, [noteId]);

  if (entries.length === 0) return null;

  return (
    <div className="border-t border-border px-8 py-4 editor-content-surface mx-auto w-full">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {t("notes.backlinks")}
      </h3>
      <ul className="space-y-1">
        {entries.map((entry) => (
          <li key={entry.sourceId}>
            <button
              type="button"
              onClick={() => onOpen(entry.sourceId)}
              className="text-sm text-primary hover:underline"
            >
              {entry.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
