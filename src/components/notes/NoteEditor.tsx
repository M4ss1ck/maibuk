import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Note, UpdateNoteInput } from "../../features/notes";
import { Editor } from "../editor";
import { useDebouncedCallback } from "../../hooks/useAutoSave";
import { BackIcon, CheckIcon, SpinnerIcon, DeleteIcon } from "../icons";

interface NoteEditorProps {
  note: Note;
  onSave: (input: UpdateNoteInput) => Promise<void>;
  onDelete: (id: string) => void;
  onBack: () => void;
}

export function NoteEditor({ note, onSave, onDelete, onBack }: NoteEditorProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(note.title);
  const [wordCount, setWordCount] = useState(note.wordCount);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "idle">("idle");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Latest editor HTML, captured for the debounced save without re-rendering on keystroke.
  const contentRef = useRef(note.content);

  const debouncedSave = useDebouncedCallback(async () => {
    setSaveStatus("saving");
    try {
      await onSave({
        id: note.id,
        title,
        content: contentRef.current,
        wordCount,
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (error) {
      console.error("Failed to save note:", error);
      setSaveStatus("idle");
    }
  }, 1000);

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitle(value);
      debouncedSave();
    },
    [debouncedSave],
  );

  const handleContentUpdate = useCallback(
    (content: string) => {
      contentRef.current = content;
      debouncedSave();
    },
    [debouncedSave],
  );

  const handleWordCountChange = useCallback((count: number) => {
    setWordCount(count);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-card">
      {/* Header */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="md:hidden p-1 hover:bg-muted rounded transition-colors"
          aria-label={t("common.back")}
        >
          <BackIcon className="w-5 h-5" />
        </button>

        <div className="flex-1" />

        <span className="flex items-center gap-1 text-xs text-muted-foreground min-w-16 justify-end">
          {saveStatus === "saving" && (
            <>
              <SpinnerIcon className="w-3.5 h-3.5 animate-spin" />
              {t("notes.saving")}
            </>
          )}
          {saveStatus === "saved" && (
            <>
              <CheckIcon className="w-3.5 h-3.5 text-success" />
              {t("notes.saved")}
            </>
          )}
        </span>

        <span className="text-xs text-muted-foreground">
          {wordCount.toLocaleString()} {t("common.words")}
        </span>

        {confirmingDelete ? (
          <span className="flex items-center gap-1">
            <span className="text-xs">{t("notes.deleteConfirm")}</span>
            <button
              type="button"
              onClick={() => onDelete(note.id)}
              className="px-2 py-1 text-xs bg-destructive text-white rounded hover:bg-destructive-hover"
            >
              {t("common.yes")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="px-2 py-1 text-xs border border-border rounded hover:bg-muted"
            >
              {t("common.no")}
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="p-1 hover:bg-destructive/10 rounded transition-colors"
            title={t("notes.delete")}
          >
            <DeleteIcon className="w-4 h-4 text-destructive" />
          </button>
        )}
      </div>

      {/* Title */}
      <div className="px-8 pt-6 max-w-editor-max mx-auto w-full">
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder={t("notes.titlePlaceholder")}
          className="w-full bg-transparent text-3xl font-serif font-semibold outline-none placeholder:text-muted-foreground"
        />
      </div>

      {/* Body */}
      <Editor
        content={note.content}
        onUpdate={handleContentUpdate}
        onWordCountChange={handleWordCountChange}
        placeholder={t("notes.bodyPlaceholder")}
      />
    </div>
  );
}
