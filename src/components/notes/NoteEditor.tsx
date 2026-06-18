import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Pin } from "lucide-react";
import { Extension } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { NodeSelection, Plugin } from "@tiptap/pm/state";
import { dropPoint } from "@tiptap/pm/transform";
import type { Note, UpdateNoteInput } from "../../features/notes";
import { useNoteStore } from "../../features/notes/store";
import { Editor, SaveStatus } from "../editor";
import type { InternalTarget, InternalTargetChildrenLoader } from "../editor/LinkDialog";
import { CollapsibleHeading } from "../editor/extensions";
import { collapsibleHeadingPluginKey } from "../editor/extensions/CollapsibleHeading";
import { useDebouncedCallback } from "../../hooks/useAutoSave";
import { useShortcuts } from "../../lib/shortcuts";
import { BackIcon } from "../icons";
import { TagEditor } from "./TagEditor";
import { tagColor } from "./tagColor";
import { timeAgo } from "./timeAgo";
import { ThemeToggle } from "../ThemeToggle";
import { SyncStatusButton } from "../sync/SyncStatusButton";
import { toast } from "../ui/Toast";
import {
  editorHtmlToMarkdown,
  markdownFilename,
  saveMarkdownFile,
} from "../../features/markdown";
import {
  generateDocumentPdf,
  elementToPngBytes,
  saveBinaryFile,
  exportFilename,
} from "../../features/export";
import { useSettingsStore } from "../../features/settings/store";
import { IS_TAURI } from "../../lib/platform";
import { useNavigate } from "react-router-dom";
import { isInternalLink, parseLinkUri } from "../../features/links/link-uri";
import { navigateToLinkTarget } from "../../features/links/navigate";
import { Wikilink } from "../editor/extensions";
import { createWikilinkRenderer } from "../editor/WikilinkSuggestion";
import { buildWikilinkCandidates } from "../../features/links/wikilink-targets";
import { useBookStore } from "../../features/books/store";
import { assignHeadingIds } from "../../features/links/heading-ids";
import {
  getChapterForLinking,
  listChaptersForBookLinking,
} from "../../features/chapters/store";
import { NoteBacklinks } from "./NoteBacklinks";

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
  onReturnToBook?: () => void;
  returnLabel?: string;
  suppressRestore?: boolean;
}

export function NoteEditor({
  note,
  onSave,
  onBack,
  onReturnToBook,
  returnLabel,
  suppressRestore = false,
}: NoteEditorProps) {
  const { t, i18n } = useTranslation();
  const [title, setTitle] = useState(note.title);
  const [wordCount, setWordCount] = useState(note.wordCount);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "idle">("idle");
  const notes = useNoteStore((s) => s.notes);
  const alwaysOnTop = useSettingsStore((s) => s.alwaysOnTop);
  const setAlwaysOnTop = useSettingsStore((s) => s.setAlwaysOnTop);
  const books = useBookStore((s) => s.books);
  const navigate = useNavigate();
  // Latest editor HTML, captured for the debounced save without re-rendering on keystroke.
  const contentRef = useRef(note.content);

  const wikilinkExtension = useMemo(
    () =>
      Wikilink.configure({
        suggestion: {
          items: ({ query }: { query: string }) =>
            buildWikilinkCandidates(query, {
              notes: notes.map((n) => ({ id: n.id, title: n.title })),
              books: books.map((b) => ({ id: b.id, title: b.title })),
              chapters: [],
              headings: [],
            }),
          onCreateNote: async (title: string) => {
            const created = await useNoteStore.getState().createNote({ title });
            return { noteId: created.id };
          },
          render: createWikilinkRenderer(),
        },
      }),
    [notes, books],
  );

  const internalTargets = useMemo<InternalTarget[]>(
    () => [
      ...notes.map((n) => ({ type: "note" as const, noteId: n.id, title: n.title })),
      ...books.map((b) => ({ type: "book" as const, bookId: b.id, title: b.title })),
    ],
    [notes, books],
  );

  const loadInternalTargetChildren = useCallback<InternalTargetChildrenLoader>(
    async (target) => {
      if (target.type === "book") {
        const chapters = await listChaptersForBookLinking(target.bookId);
        return chapters.map((chapter) => ({
          type: "chapter" as const,
          chapterId: chapter.id,
          title: chapter.title,
          headingId: null,
        }));
      }

      if (target.type === "chapter") {
        const chapter = await getChapterForLinking(target.chapterId);
        if (!chapter) return [];
        return assignHeadingIds(chapter.content).headings.map((heading) => ({
          type: "heading" as const,
          chapterId: chapter.id,
          title: heading.text,
          headingId: heading.id,
        }));
      }

      if (target.type === "note") {
        const targetNote =
          target.noteId === note.id
            ? { ...note, content: contentRef.current }
            : notes.find((existingNote) => existingNote.id === target.noteId);
        if (!targetNote) return [];
        return assignHeadingIds(targetNote.content).headings.map((heading) => ({
          type: "noteHeading" as const,
          noteId: target.noteId,
          title: heading.text,
          headingId: heading.id,
        }));
      }

      return [];
    },
    [note, notes],
  );

  const resolveBookIdForChapter = useCallback(async (chapterId: string) => {
    const chapter = await getChapterForLinking(chapterId);
    return chapter?.bookId;
  }, []);

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

  useShortcuts([
    {
      keys: ["ctrl+s", "meta+s"],
      onTrigger: () => {
        void saveNow();
      },
      allowInInput: true,
    },
  ]);

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

  const handleExportMarkdown = useCallback(async () => {
    try {
      const markdown = editorHtmlToMarkdown(contentRef.current || "");
      const saved = await saveMarkdownFile(
        markdownFilename(title || note.title),
        markdown,
      );
      if (saved) toast.success(t("editor.exportMarkdownSuccess"));
    } catch (error) {
      console.error("Markdown export failed:", error);
      toast.error(t("editor.exportMarkdownFailed"));
    }
  }, [title, note.title, t]);

  const handleExportPdf = useCallback(async () => {
    const noteTitle = title || note.title;
    try {
      const blob = await generateDocumentPdf(contentRef.current || "", noteTitle);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const saved = await saveBinaryFile(
        exportFilename(noteTitle, "pdf"),
        bytes,
        "application/pdf",
        { name: "PDF", extensions: ["pdf"] },
      );
      if (saved) toast.success(t("editor.exportPdfSuccess"));
    } catch (error) {
      console.error("PDF export failed:", error);
      toast.error(t("editor.exportPdfFailed"));
    }
  }, [title, note.title, t]);

  const handleExportImage = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      const bytes = await elementToPngBytes(editor.view.dom as HTMLElement);
      const saved = await saveBinaryFile(
        exportFilename(title || note.title, "png"),
        bytes,
        "image/png",
        { name: "PNG Image", extensions: ["png"] },
      );
      if (saved) toast.success(t("editor.exportImageSuccess"));
    } catch (error) {
      console.error("Image export failed:", error);
      toast.error(t("editor.exportImageFailed"));
    }
  }, [title, note.title, t]);

  const handleEditorReady = useCallback(
    (editor: import("@tiptap/core").Editor | null) => {
      editorRef.current = editor;
      if (!editor) return;
      const dom = editor.view.dom;
      const onClick = (event: MouseEvent) => {
        const target = (event.target as HTMLElement).closest("a.wikilink");
        if (!(target instanceof HTMLAnchorElement)) return;
        const href = target.getAttribute("href");
        if (href && isInternalLink(href)) {
          event.preventDefault();
          const parsed = parseLinkUri(href);
          if (parsed?.targetType === "chapter" || parsed?.targetType === "heading") {
            void getChapterForLinking(parsed.targetId).then((chapter) => {
              navigateToLinkTarget(href, navigate, {
                bookIdForChapter: () => chapter?.bookId,
              });
            });
            return;
          }
          navigateToLinkTarget(href, navigate);
        } else {
          const broken = (event.target as HTMLElement).closest("a.wikilink-broken");
          if (broken instanceof HTMLAnchorElement) {
            event.preventDefault();
            const label = broken.getAttribute("data-label") ?? broken.textContent ?? "";
            if (!label) return;
            void useNoteStore
              .getState()
              .createNote({ title: label })
              .then((created) => {
                navigate("/notes", { state: { openNoteId: created.id } });
              });
          }
        }
      };
      dom.addEventListener("click", onClick);

      const onTransaction = ({ transaction }: { transaction: import("@tiptap/pm/state").Transaction }) => {
        const meta = transaction.getMeta(collapsibleHeadingPluginKey);
        if (meta && typeof meta.toggle === "string") {
          const pluginState = collapsibleHeadingPluginKey.getState(editor.state);
          if (pluginState) {
            void useNoteStore.getState().saveCollapsedHeadings(note.id, [...pluginState.collapsed]);
          }
        }
      };

      editor.on("transaction", onTransaction);
    },
    [navigate, note.id],
  );

  const collapsedHeadingsKey = note.collapsedHeadings.join(",");

  // Sync persisted collapsed state into the ProseMirror plugin when
  // the editor becomes available or the stored collapsed headings change
  // (e.g. when switching notes).  The plugin's `init()` only runs once
  // when `useEditor` creates the editor; this effect updates it after
  // the fact so we don't rely on editor recreation.
  const editorRef = useRef<import("@tiptap/core").Editor | null>(null);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const pluginState = collapsibleHeadingPluginKey.getState(editor.state);
    if (!pluginState) return;
    const desired = new Set(note.collapsedHeadings);
    const current = pluginState.collapsed;
    if (current.size === desired.size && [...desired].every((id) => current.has(id))) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(collapsibleHeadingPluginKey, { replace: note.collapsedHeadings }),
    );
  }, [collapsedHeadingsKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
        collapsedHeadings: note.collapsedHeadings,
      }),
    ],
    [t, collapsedHeadingsKey],
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

        {onReturnToBook && (
          <button
            type="button"
            onClick={onReturnToBook}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="max-w-40 truncate">
              {t("notes.backToBook", { title: returnLabel ?? "" })}
            </span>
          </button>
        )}

        <div className="flex-1" />

        <SaveStatus status={saveStatus} onSave={() => void saveNow()} />

        <span className="text-xs text-muted-foreground">
          {wordCount.toLocaleString()} {t("common.words")}
        </span>
        
        <SyncStatusButton />

        <ThemeToggle variant="dropdown" />

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
        onExportMarkdown={handleExportMarkdown}
        onExportPdf={handleExportPdf}
        onExportImage={handleExportImage}
        restoreKey={`note:${note.id}`}
        suppressRestore={suppressRestore}
        placeholder={t("notes.bodyPlaceholder")}
        extraExtensions={allNotesExtensions}
        internalTargets={internalTargets}
        onEditorReady={handleEditorReady}
        loadInternalTargetChildren={loadInternalTargetChildren}
        resolveBookIdForChapter={resolveBookIdForChapter}
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
      <NoteBacklinks
        noteId={note.id}
        onOpen={(sourceId) => {
          void useNoteStore.getState().loadNote(sourceId);
        }}
      />
    </div>
  );
}
