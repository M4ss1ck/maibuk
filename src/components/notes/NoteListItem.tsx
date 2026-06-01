import { useTranslation } from "react-i18next";
import type { Note } from "../../features/notes";

interface NoteListItemProps {
  note: Note;
  isSelected: boolean;
  onSelect: (note: Note) => void;
}

// Strip HTML tags for a plain-text preview (content is TipTap HTML).
function toPreview(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function NoteListItem({ note, isSelected, onSelect }: NoteListItemProps) {
  const { t } = useTranslation();
  const title = note.title.trim() || t("notes.untitled");
  const preview = toPreview(note.content);

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(note)}
        className={`w-full text-left rounded p-3 transition-colors ${
          isSelected ? "bg-primary/10 border-l-2 border-primary" : "hover:bg-muted/50"
        }`}
      >
        <span className="block truncate font-medium text-sm">{title}</span>
        {preview && (
          <span className="mt-1 block text-xs text-muted-foreground line-clamp-2">
            {preview}
          </span>
        )}
        <span className="mt-1 block text-xs text-muted-foreground">
          {formatDate(note.updatedAt)}
        </span>
      </button>
    </li>
  );
}
