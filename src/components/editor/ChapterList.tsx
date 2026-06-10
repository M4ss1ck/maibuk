import { Fragment, useState, useEffect, useRef } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Chapter, ChapterType } from "../../features/chapters/types";
import { ChapterOutline } from "./ChapterOutline";
import { Select } from "../ui/Select";
import { useTranslation } from "react-i18next";
import { List, ListTree, Rows3 } from "lucide-react";
import { ChapterIcon, EditIcon } from "../icons";
import { DeleteIcon } from "../icons/DeleteIcon";
import { AddIcon } from "../icons/AddIcon";
import { useSettingsStore } from "../../features/settings/store";
import { useMarkdownFileDrop } from "../../hooks/useMarkdownFileDrop";

interface ChapterListProps {
  chapters: Chapter[];
  currentChapterId: string | null;
  editor?: TiptapEditor | null;
  onSelectChapter: (chapter: Chapter) => void;
  onCreateChapter: (title: string, type: ChapterType) => void;
  onUpdateChapter: (id: string, title: string, type: ChapterType) => void;
  onDeleteChapter: (id: string) => void;
  onReorderChapters: (chapterIds: string[]) => void;
  onImportMarkdown?: (markdown: string, filenameStem: string) => void;
}

const chapterTypeLabels: Record<ChapterType, string> = {
  chapter: "Chapter",
  prologue: "Prologue",
  epilogue: "Epilogue",
  part: "Part",
  frontmatter: "Front Matter",
  backmatter: "Back Matter",
};

export function ChapterList({
  chapters,
  currentChapterId,
  editor,
  onSelectChapter,
  onCreateChapter,
  onUpdateChapter,
  onDeleteChapter,
  onReorderChapters,
  onImportMarkdown,
}: ChapterListProps) {
  const { t } = useTranslation();
  const chapterListView = useSettingsStore((state) => state.chapterListView);
  const setChapterListView = useSettingsStore((state) => state.setChapterListView);
  const showChapterOutline = useSettingsStore((state) => state.showChapterOutline);
  const setShowChapterOutline = useSettingsStore((state) => state.setShowChapterOutline);
  const isCompactView = chapterListView === "compact";
  const listContainerRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLLIElement>(null);
  const { isDraggingFile, dropHandlers } = useMarkdownFileDrop(
    listContainerRef,
    onImportMarkdown ?? (() => {}),
  );

  const toggleChapterListView = () => {
    setChapterListView(isCompactView ? "normal" : "compact");
  };

  // Scroll to selected chapter or bottom of list on mount/change
  useEffect(() => {
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ block: "nearest" });
    } else if (listContainerRef.current) {
      listContainerRef.current.scrollTop = listContainerRef.current.scrollHeight;
    }
  }, [currentChapterId, chapters.length]);

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<ChapterType>("chapter");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editType, setEditType] = useState<ChapterType>("chapter");

  const handleCreate = () => {
    if (newTitle.trim()) {
      onCreateChapter(newTitle.trim(), newType);
      setNewTitle("");
      setNewType("chapter");
      setShowNewDialog(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) return;

    const draggedIndex = chapters.findIndex((c) => c.id === draggedId);
    const targetIndex = chapters.findIndex((c) => c.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const newOrder = [...chapters];
    const [removed] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, removed);

    onReorderChapters(newOrder.map((c) => c.id));
    setDraggedId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
  };

  const handleDelete = (id: string) => {
    onDeleteChapter(id);
    setDeleteConfirmId(null);
  };

  const startEditing = (chapter: Chapter) => {
    setEditingId(chapter.id);
    setEditTitle(chapter.title);
    setEditType(chapter.chapterType);
    setDeleteConfirmId(null);
  };

  const handleUpdate = () => {
    if (editingId && editTitle.trim()) {
      onUpdateChapter(editingId, editTitle.trim(), editType);
      setEditingId(null);
    }
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle("");
    setEditType("chapter");
  };

  return (
    <aside className="w-full border-r border-border flex flex-col bg-background h-full shrink-0">
      {/* Sticky header */}
      <div className="p-4 pt-12 md:pt-4 border-b border-border flex items-center justify-between bg-background z-10 shrink-0">
        <h3 className="font-medium">{t("chapters.title")}</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleChapterListView}
            className="p-1 hover:bg-muted rounded transition-colors"
            title={
              isCompactView ? t("chapters.switchToNormalView") : t("chapters.switchToCompactView")
            }
            aria-label={
              isCompactView ? t("chapters.switchToNormalView") : t("chapters.switchToCompactView")
            }
            aria-pressed={isCompactView}
          >
            {isCompactView ? <Rows3 className="w-5 h-5" /> : <List className="w-5 h-5" />}
          </button>
          <button
            type="button"
            onClick={() => setShowNewDialog(true)}
            className="p-1 hover:bg-muted rounded transition-colors"
            title={t("chapters.addChapter")}
          >
            <AddIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* New chapter dialog */}
      {showNewDialog && (
        <div className="p-3 border-b border-border bg-muted/20">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t("chapters.chapterTitlePlaceholder")}
            className="w-full px-3 py-2 text-sm border border-border rounded mb-2 bg-background text-foreground"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setShowNewDialog(false);
            }}
          />
          <Select
            value={newType}
            onChange={(value) => setNewType(value)}
            className="mb-2"
            options={Object.entries(chapterTypeLabels).map(([value, label]) => ({
              value: value as ChapterType,
              label,
            }))}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={!newTitle.trim()}
              className="flex-1 px-3 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {t("common.create")}
            </button>
            <button
              type="button"
              onClick={() => setShowNewDialog(false)}
              className="px-3 py-1.5 text-sm border border-border rounded hover:bg-muted transition-colors"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Chapter list */}
      <div
        ref={listContainerRef}
        className={`flex-1 overflow-auto ${isDraggingFile ? "ring-2 ring-inset ring-primary" : ""}`}
        {...(onImportMarkdown ? dropHandlers : {})}
      >
        {chapters.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <p>{t("chapters.noChapters")}</p>
          </div>
        ) : (
          <ul className="p-2 space-y-1">
            {chapters.map((chapter) => {
              const isActive = currentChapterId === chapter.id;
              const outlineToggle =
                isActive && editor ? (
                  <button
                    type="button"
                    draggable={false}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowChapterOutline(!showChapterOutline);
                    }}
                    title={showChapterOutline ? t("toc.hideOutline") : t("toc.showOutline")}
                    aria-label={showChapterOutline ? t("toc.hideOutline") : t("toc.showOutline")}
                    aria-pressed={showChapterOutline}
                    className={`shrink-0 p-1 rounded transition-colors ${showChapterOutline
                      ? "text-primary bg-primary/10 hover:bg-primary/20"
                      : "text-muted-foreground hover:bg-muted"
                      }`}
                  >
                    <ListTree className="w-3.5 h-3.5" />
                  </button>
                ) : null;

              return (
                <Fragment key={chapter.id}>
                  <li
                    ref={isActive ? selectedItemRef : null}
                    draggable={true}
                    onDragStart={(e) => handleDragStart(e, chapter.id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, chapter.id)}
                    onDragEnd={handleDragEnd}
                    className={`group relative rounded transition-colors cursor-pointer ${draggedId === chapter.id ? "opacity-50" : ""
                      } ${isActive ? "bg-primary/10 border-l-2 border-primary" : "hover:bg-muted/50"
                      }${isActive && showChapterOutline ? " sticky top-0 backdrop-blur-sm" : ""}`}
                  >
                    {/* Edit form overlay */}
                    {editingId === chapter.id ? (
                      <div className="p-2">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-border rounded mb-2 bg-background text-foreground"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleUpdate();
                            if (e.key === "Escape") cancelEditing();
                          }}
                        />
                        <Select
                          value={editType}
                          onChange={(value) => setEditType(value)}
                          options={Object.entries(chapterTypeLabels).map(([value, label]) => ({
                            value: value as ChapterType,
                            label,
                          }))}
                          className="mb-2"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleUpdate}
                            disabled={!editTitle.trim()}
                            className="flex-1 px-2 py-1 text-xs bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-50"
                          >
                            {t("common.save")}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditing}
                            className="px-2 py-1 text-xs border border-border rounded hover:bg-muted"
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* biome-ignore lint/a11y/useSemanticElements: Cannot use <button> because it contains nested action <button> elements */}
                        <div
                          role="button"
                          tabIndex={0}
                          draggable={false}
                          onClick={() => onSelectChapter(chapter)}
                          onKeyDown={() => onSelectChapter(chapter)}
                          className={`w-full text-left ${isCompactView ? "px-2 py-1.5" : "p-3"}`}
                        >
                          {/* Title line: icon, title, inline edit/delete actions */}
                          <div className="flex min-w-0 items-center gap-2">
                            <ChapterIcon
                              className={`shrink-0 text-muted-foreground ${isCompactView ? "w-3.5 h-3.5" : "w-4 h-4"
                                }`}
                            />
                            <span
                              className={`flex-1 min-w-0 truncate font-medium ${isCompactView ? "text-xs" : "text-sm"
                                }`}
                            >
                              {chapter.title}
                            </span>

                            {/* Edit/Delete - revealed on hover and focus */}
                            <span className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                              <button
                                type="button"
                                draggable={false}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEditing(chapter);
                                }}
                                className="p-1 hover:bg-muted rounded transition-colors"
                                title={t("chapters.editChapter")}
                              >
                                <EditIcon className="w-4 h-4 text-foreground" />
                              </button>
                              <button
                                type="button"
                                draggable={false}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteConfirmId(chapter.id);
                                }}
                                className="p-1 hover:bg-destructive/10 rounded transition-colors"
                                title={t("chapters.deleteChapter")}
                              >
                                <DeleteIcon className="w-4 h-4 text-destructive" />
                              </button>
                            </span>

                            {/* Compact view has no metadata line: keep the toggle here */}
                            {isCompactView && outlineToggle}
                          </div>

                          {/* Metadata line: word count, status, outline toggle */}
                          {!isCompactView && (
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground truncate">
                              <span>
                                {chapter.wordCount.toLocaleString()} {t("common.words")}
                              </span>
                              <span>•</span>
                              <span className="capitalize">{chapter.status}</span>
                              {outlineToggle && (
                                <span className="ml-auto flex">{outlineToggle}</span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Delete confirmation */}
                        {deleteConfirmId === chapter.id && (
                          <div className="absolute inset-0 bg-background rounded flex items-center justify-center gap-2 p-2">
                            <span className="text-xs">{t("common.deleteConfirm")}</span>
                            <button
                              type="button"
                              onClick={() => handleDelete(chapter.id)}
                              className="px-2 py-1 text-xs bg-destructive text-white rounded hover:bg-destructive-hover"
                            >
                              {t("common.yes")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(null)}
                              className="px-2 py-1 text-xs border border-border rounded hover:bg-muted"
                            >
                              {t("common.no")}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </li>
                  {isActive && editor && showChapterOutline && (
                    <li className="list-none">
                      <ChapterOutline editor={editor} />
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ul>
        )}
      </div>

      {/* Sticky footer - Word count summary */}
      {chapters.length > 0 && (
        <div className="p-3 border-t border-border text-xs text-muted-foreground bg-background shrink-0">
          <div className="flex justify-between">
            <span>{t("common.totalWords")}</span>
            <span className="font-medium">
              {chapters.reduce((sum, c) => sum + c.wordCount, 0).toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between mt-1">
            <span>{t("common.chaptersCount")}</span>
            <span className="font-medium">{chapters.length}</span>
          </div>
        </div>
      )}
    </aside>
  );
}
