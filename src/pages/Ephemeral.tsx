import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Feather, Pin, Trash2 } from "lucide-react";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Editor } from "@/components/editor";
import { CollapsibleHeading } from "@/components/editor/extensions";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Tooltip } from "@/components/ui";
import { useEphemeralStore } from "@/features/ephemeral";
import { useNoteStore } from "@/features/notes";
import { useSettingsStore } from "@/features/settings/store";
import { IS_TAURI } from "@/lib/platform";

export function Ephemeral() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const content = useEphemeralStore((s) => s.content);
  const wordCount = useEphemeralStore((s) => s.wordCount);
  const setContent = useEphemeralStore((s) => s.setContent);
  const setWordCount = useEphemeralStore((s) => s.setWordCount);
  const reset = useEphemeralStore((s) => s.reset);
  const alwaysOnTop = useSettingsStore((s) => s.alwaysOnTop);
  const setAlwaysOnTop = useSettingsStore((s) => s.setAlwaysOnTop);

  const isEmpty = wordCount === 0;

  const ephemeralExtensions = useMemo(
    () => [
      TaskList,
      TaskItem.configure({ nested: true }),
      CollapsibleHeading.configure({
        collapseLabel: t("notes.collapseHeading"),
        expandLabel: t("notes.expandHeading"),
        collapsedHeadings: [],
      }),
    ],
    [t]
  );

  const handleCreateNote = async () => {
    const note = await useNoteStore.getState().createNote({ title: "", content });
    reset();
    navigate(`/notes/${note.id}`);
  };

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <h1 data-route-heading className="sr-only">
        {t("common.ephemeral")}
      </h1>
      <div className="px-4 py-1 border-b border-border flex items-center gap-2 shrink-0">
        <Tooltip content={t("ephemeral.clear")}>
          <button
            type="button"
            onClick={reset}
            disabled={isEmpty}
            className="inline-flex items-center gap-1.5 rounded px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label={t("ephemeral.clear")}
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </Tooltip>

        <button
          type="button"
          onClick={handleCreateNote}
          disabled={isEmpty}
          className="inline-flex items-center gap-1.5 rounded px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <Feather className="h-5 w-5" />
          <span>{t("ephemeral.createNote")}</span>
        </button>

        <span className="ml-auto text-xs text-muted-foreground">
          {wordCount.toLocaleString()} {t("common.words")}
        </span>

        <ThemeToggle variant="dropdown" />

        {IS_TAURI && (
          <Tooltip content={t("settings.alwaysOnTop")} shortcut="global.toggleAlwaysOnTop">
            <button
              type="button"
              onClick={() => setAlwaysOnTop(!alwaysOnTop)}
              className={`rounded p-1 transition-colors ${
                alwaysOnTop ? "bg-muted text-primary" : "text-foreground hover:bg-muted"
              }`}
              aria-label={t("settings.alwaysOnTop")}
            >
              <Pin className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </div>

      <Editor
        content={content}
        onUpdate={setContent}
        onWordCountChange={setWordCount}
        restoreKey={null}
        placeholder={t("ephemeral.placeholder")}
        extraExtensions={ephemeralExtensions}
      />
    </div>
  );
}
