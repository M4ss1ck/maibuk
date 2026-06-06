import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pin } from "lucide-react";
import { Extension } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { NodeSelection, Plugin } from "@tiptap/pm/state";
import { dropPoint } from "@tiptap/pm/transform";
import type { Note, UpdateNoteInput } from "../../features/notes";
import { useNoteStore } from "../../features/notes/store";
import { Editor } from "../editor";
import { CollapsibleHeading } from "../editor/extensions";
import { useDebouncedCallback } from "../../hooks/useAutoSave";
import { BackIcon, CheckIcon, SpinnerIcon } from "../icons";
import { TagEditor } from "./TagEditor";
import { tagColor } from "./tagColor";
import { timeAgo } from "./timeAgo";
import { ThemeToggle } from "../ThemeToggle";
import { SyncStatusButton } from "../sync/SyncStatusButton";
import { useSettingsStore } from "../../features/settings/store";
import { IS_TAURI } from "../../lib/platform";
import { useNavigate } from "react-router-dom";
import { isInternalLink } from "../../features/links/link-uri";
import { navigateToLinkTarget } from "../../features/links/navigate";
import { Wikilink } from "../editor/extensions";
import { createWikilinkRenderer } from "../editor/WikilinkSuggestion";
import { buildWikilinkCandidates } from "../../features/links/wikilink-targets";
import { useBookStore } from "../../features/books/store";
import { assignHeadingIds } from "../../features/links/heading-ids";
import { listAllChaptersForLinking } from "../../features/chapters/store";

let activeTaskHandleDragSourcePos: number | null = null;

const NotesTaskItem = TaskItem.extend({
  draggable: true,
  addNodeView() {
    const parent = this.parent?.();
    if (!parent) return null;

    return (...args) => {
      const nodeView = parent(...args);
      if (!nodeView || !(nodeView.dom instanceof HTMLElement)) {
        return nodeView;
      }

      const nodeViewProps = args[0] as {
        getPos?: (() => number | undefined) | boolean;
        editor?: {
          view?: {
            state: {
              doc: Parameters<typeof NodeSelection.create>[0];
            };
            dragging: null | {
              slice: ReturnType<NodeSelection["content"]>;
              move: boolean;
            };
          };
          chain: () => {
            focus: (
              position?: number | null,
              options?: { scrollIntoView?: boolean }
            ) => {
              setNodeSelection: (pos: number) => { run: () => boolean };
            };
          };
        };
      };

      const listItem = nodeView.dom as HTMLLIElement;
      const dragHandle = listItem.querySelector("label > span");

      if (!(dragHandle instanceof HTMLSpanElement)) {
        return nodeView;
      }

      dragHandle.classList.add("task-item-drag-handle");
      dragHandle.setAttribute("aria-hidden", "true");
      dragHandle.textContent = "";

      let dragFromHandle = false;

      const handlePointerDown = () => {
        if (typeof nodeViewProps.getPos === "function" && nodeViewProps.editor) {
          const pos = nodeViewProps.getPos();
          if (typeof pos === "number") {
            activeTaskHandleDragSourcePos = pos;
            nodeViewProps.editor
              .chain()
              .focus(undefined, { scrollIntoView: false })
              .setNodeSelection(pos)
              .run();
          }
        }
        dragFromHandle = true;
      };

      const handleDragStart = (event: DragEvent) => {
        if (!dragFromHandle) {
          event.preventDefault();
          activeTaskHandleDragSourcePos = null;
          return;
        }

        if (typeof nodeViewProps.getPos === "function") {
          const pos = nodeViewProps.getPos();
          activeTaskHandleDragSourcePos = typeof pos === "number" ? pos : null;
        }

        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
        }
        dragFromHandle = false;
      };

      const resetDragState = () => {
        dragFromHandle = false;
        activeTaskHandleDragSourcePos = null;
      };

      dragHandle.addEventListener("mousedown", handlePointerDown);
      dragHandle.addEventListener("touchstart", handlePointerDown);
      listItem.addEventListener("dragstart", handleDragStart);
      listItem.addEventListener("dragend", resetDragState);
      listItem.addEventListener("mouseup", resetDragState);

      const originalDestroy = nodeView.destroy?.bind(nodeView);
      nodeView.destroy = () => {
        dragHandle.removeEventListener("mousedown", handlePointerDown);
        dragHandle.removeEventListener("touchstart", handlePointerDown);
        listItem.removeEventListener("dragstart", handleDragStart);
        listItem.removeEventListener("dragend", resetDragState);
        listItem.removeEventListener("mouseup", resetDragState);
        originalDestroy?.();
      };

      return nodeView;
    };
  },
});

const NotesTaskDndBehavior = Extension.create({
  name: "notesTaskDndBehavior",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // Keep task-item DnD as move-only to avoid intermittent internal copy behavior.
          dragCopies: () => false,
          handleDrop(view, event, slice) {
            const sourcePos = activeTaskHandleDragSourcePos;
            activeTaskHandleDragSourcePos = null;

            if (sourcePos === null) {
              return false;
            }

            const sourceNode = view.state.doc.nodeAt(sourcePos);
            if (!sourceNode || sourceNode.type.name !== "taskItem") {
              return false;
            }

            const eventPos = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            if (!eventPos) {
              return false;
            }

            event.preventDefault();

            let tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, sourcePos));
            tr = tr.deleteSelection();

            const mappedDropPos = tr.mapping.map(eventPos.pos);
            const insertionPos = dropPoint(tr.doc, mappedDropPos, slice) ?? mappedDropPos;
            const isNode =
              slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1;

            if (isNode && slice.content.firstChild) {
              tr = tr.replaceRangeWith(insertionPos, insertionPos, slice.content.firstChild);
            } else {
              tr = tr.replaceRange(insertionPos, insertionPos, slice);
            }

            view.dispatch(tr.setMeta("uiEvent", "drop").scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});

interface NoteEditorProps {
  note: Note;
  onSave: (input: UpdateNoteInput) => Promise<void>;
  onBack: () => void;
}

export function NoteEditor({ note, onSave, onBack }: NoteEditorProps) {
  const { t, i18n } = useTranslation();
  const [title, setTitle] = useState(note.title);
  const [wordCount, setWordCount] = useState(note.wordCount);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "idle">("idle");
  const notes = useNoteStore((s) => s.notes);
  const alwaysOnTop = useSettingsStore((s) => s.alwaysOnTop);
  const setAlwaysOnTop = useSettingsStore((s) => s.setAlwaysOnTop);
  const books = useBookStore((s) => s.books);
  const navigate = useNavigate();

  const [chapterTargets, setChapterTargets] = useState<
    {
      id: string;
      bookId: string;
      title: string;
      headings: { id: string; text: string }[];
    }[]
  >([]);

  useEffect(() => {
    void listAllChaptersForLinking().then((rows) =>
      setChapterTargets(
        rows.map((c) => ({
          id: c.id,
          bookId: c.bookId,
          title: c.title,
          headings: assignHeadingIds(c.content).headings.map((h) => ({
            id: h.id,
            text: h.text,
          })),
        })),
      ),
    );
  }, []);

  const wikilinkExtension = useMemo(
    () =>
      Wikilink.configure({
        suggestion: {
          items: (query: string) =>
            buildWikilinkCandidates(query, {
              notes: notes.map((n) => ({ id: n.id, title: n.title })),
              books: books.map((b) => ({ id: b.id, title: b.title })),
              chapters: chapterTargets.map((c) => ({
                id: c.id,
                bookId: c.bookId,
                title: c.title,
              })),
              headings: chapterTargets.flatMap((c) =>
                c.headings.map((h) => ({
                  chapterId: c.id,
                  id: h.id,
                  text: h.text,
                })),
              ),
            }),
          onCreateNote: async (title: string) => {
            const created = await useNoteStore.getState().createNote({ title });
            return { noteId: created.id };
          },
          render: createWikilinkRenderer(),
        },
      }),
    [notes, books, chapterTargets],
  );

  // Latest editor HTML, captured for the debounced save without re-rendering on keystroke.
  const contentRef = useRef(note.content);

  const saveNow = useCallback(
    async (extra: Partial<UpdateNoteInput> = {}) => {
      setSaveStatus("saving");
      try {
        await onSave({
          id: note.id,
          title,
          content: contentRef.current,
          wordCount,
          ...extra,
        });
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (error) {
        console.error("Failed to save note:", error);
        setSaveStatus("idle");
      }
    },
    [note.id, onSave, title, wordCount]
  );

  const debouncedSave = useDebouncedCallback(async () => {
    await saveNow();
  }, 1000);

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitle(value);
      debouncedSave();
    },
    [debouncedSave]
  );

  const handleContentUpdate = useCallback(
    (content: string) => {
      contentRef.current = content;
      debouncedSave();
    },
    [debouncedSave]
  );

  const handleWordCountChange = useCallback((count: number) => {
    setWordCount(count);
  }, []);

  const handleEditorReady = useCallback(
    (editor: import("@tiptap/core").Editor | null) => {
      if (!editor) return;
      const dom = editor.view.dom;
      const onClick = (event: MouseEvent) => {
        const target = (event.target as HTMLElement).closest("a.wikilink");
        if (!(target instanceof HTMLAnchorElement)) return;
        const href = target.getAttribute("href");
        if (href && isInternalLink(href)) {
          event.preventDefault();
          navigateToLinkTarget(href, navigate, {
            bookIdForChapter: (chapterId) =>
              chapterTargets.find((c) => c.id === chapterId)?.bookId,
          });
        } else {
          // Unresolved [[ ]] -> Task 17 handles "create note".
        }
      };
      dom.addEventListener("click", onClick);
    },
    [navigate, chapterTargets],
  );

  const notesExtensions = useMemo(
    () => [
      TaskList,
      NotesTaskItem.configure({
        nested: true,
      }),
      NotesTaskDndBehavior,
      CollapsibleHeading.configure({
        collapseLabel: t("notes.collapseHeading"),
        expandLabel: t("notes.expandHeading"),
      }),
    ],
    [t]
  );

  const allNotesExtensions = useMemo(
    () => [...notesExtensions, wikilinkExtension],
    [notesExtensions, wikilinkExtension],
  );

  const allTags = useMemo(() => {
    const uniqueTags = new Set<string>();
    for (const existingNote of notes) {
      for (const tag of existingNote.tags) {
        const normalized = tag.trim();
        if (normalized) uniqueTags.add(normalized);
      }
    }
    return [...uniqueTags].sort((a, b) => a.localeCompare(b));
  }, [notes]);

  const handleTagsChange = useCallback(
    (tags: string[]) => {
      const cleanTags = tags
        .map((tag) => tag.trim())
        .filter((tag, idx, arr) => tag.length > 0 && arr.indexOf(tag) === idx);
      void saveNow({ tags: cleanTags });
    },
    [saveNow]
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
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

        <ThemeToggle variant="dropdown" />

        <SyncStatusButton />

        {IS_TAURI && (
          <button
            type="button"
            onClick={() => setAlwaysOnTop(!alwaysOnTop)}
            className={`p-1 rounded transition-colors ${
              alwaysOnTop ? "bg-muted text-primary" : "hover:bg-muted text-foreground"
            }`}
            title={t("settings.alwaysOnTop")}
          >
            <Pin className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Body */}
      <Editor
        content={note.content}
        onUpdate={handleContentUpdate}
        onWordCountChange={handleWordCountChange}
        placeholder={t("notes.bodyPlaceholder")}
        extraExtensions={allNotesExtensions}
        onEditorReady={handleEditorReady}
        headerContent={
          <div className="px-8 pt-6 max-w-editor-max mx-auto w-full">
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder={t("notes.titlePlaceholder")}
              className="w-full bg-transparent text-3xl font-serif font-semibold outline-none placeholder:text-muted-foreground"
            />
            <div className="relative mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {timeAgo(note.updatedAt, i18n.language, t)}
              </span>
              {note.tags.map((tag) => {
                const color = tagColor(tag);
                return (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                    style={{ borderColor: color, backgroundColor: `${color}22`, color }}
                  >
                    <span>{tag}</span>
                    <button
                      type="button"
                      onClick={() => handleTagsChange(note.tags.filter((t) => t !== tag))}
                      className="leading-none opacity-80 hover:opacity-100"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              <TagEditor tags={note.tags} allTags={allTags} onChange={handleTagsChange} />
            </div>
          </div>
        }
      />
    </div>
  );
}
