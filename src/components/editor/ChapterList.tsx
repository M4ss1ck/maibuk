import { useCallback, useState, useEffect, useRef, type Key } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { DropItem } from "react-aria-components/useDragAndDrop";
import { DropIndicator } from "react-aria-components";
import type { Chapter, ChapterType } from "@/features/chapters/types";
import { ChapterOutline } from "@/components/editor/ChapterOutline";
import { Select } from "@/components/ui/Select";
import { useTranslation } from "react-i18next";
import { List, ListTree, Rows3, GripVertical } from "lucide-react";
import { ChapterIcon, EditIcon } from "@/components/icons";
import { DeleteIcon } from "@/components/icons/DeleteIcon";
import { AddIcon } from "@/components/icons/AddIcon";
import { useSettingsStore } from "@/features/settings/store";
import { readDroppedWebFiles, useTextFileDrop } from "@/hooks/useTextFileDrop";
import type { DroppedTextFile, DropPoint } from "@/hooks/useTextFileDrop";
import { dropTargetFromPoint } from "@/lib/drop-target";
import type { ListDropTarget } from "@/lib/drop-target";
import { Tooltip } from "@/components/ui";
import { GridList, GridListItem } from "react-aria-components/GridList";
import { Button as AriaButton } from "react-aria-components/Button";
import { useDragAndDrop } from "react-aria-components/useDragAndDrop";

interface ChapterListProps {
  chapters: Chapter[];
  currentChapterId: string | null;
  editor?: TiptapEditor | null;
  onSelectChapter: (chapter: Chapter) => void;
  onCreateChapter: (title: string, type: ChapterType) => void;
  onUpdateChapter: (id: string, title: string, type: ChapterType) => void;
  onDeleteChapter: (id: string) => void;
  onReorderChapters: (chapterIds: string[]) => void;
  onImportFiles?: (files: DroppedTextFile[], target: ListDropTarget | null) => void;
}

const CHAPTER_DND_TYPE = "chapter";

/** Reads supported text files out of react-aria drop items, preserving order. */
export async function readChapterDropItems(
  items: DropItem[],
): Promise<DroppedTextFile[]> {
  const files: File[] = [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    files.push(await item.getFile());
  }
  return readDroppedWebFiles(files);
}

export function ChapterList({
  chapters,
  currentChapterId,
  editor,
  onSelectChapter,
  onCreateChapter,
  onUpdateChapter,
  onDeleteChapter,
  onReorderChapters,
  onImportFiles,
}: ChapterListProps) {
  const { t, i18n } = useTranslation();
  const chapterListView = useSettingsStore((state) => state.chapterListView);
  const setChapterListView = useSettingsStore((state) => state.setChapterListView);
  const showChapterOutline = useSettingsStore((state) => state.showChapterOutline);
  const setShowChapterOutline = useSettingsStore((state) => state.setShowChapterOutline);
  const isCompactView = chapterListView === "compact";
  const listContainerRef = useRef<HTMLDivElement>(null);
  const onImportFilesRef = useRef(onImportFiles);
  onImportFilesRef.current = onImportFiles;

  const resolveFileDropTarget = useCallback(
    (point: DropPoint | null): ListDropTarget | null => {
      const container = listContainerRef.current;
      if (!point || !container) return null;
      return dropTargetFromPoint(container, point.y, "[data-key]", "data-key");
    },
    [],
  );

  const { isDraggingFile } = useTextFileDrop(listContainerRef, {
    disableWeb: true,
    onImport: (files, point) => {
      onImportFilesRef.current?.(files, resolveFileDropTarget(point));
    },
  });

  const toggleChapterListView = () => {
    setChapterListView(isCompactView ? "normal" : "compact");
  };

  useEffect(() => {
    const container = listContainerRef.current;
    if (!container) return;
    if (chapters.length === 0) {
      container.scrollTop = 0;
      return;
    }
    const selectedEl = container.querySelector('[aria-selected="true"]');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }, [currentChapterId, chapters.length]);

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<ChapterType>("chapter");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editType, setEditType] = useState<ChapterType>("chapter");
  const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const chapterTypeLabels: Record<ChapterType, string> = {
    chapter: t("chapters.typeChapter"),
    prologue: t("chapters.typePrologue"),
    epilogue: t("chapters.typeEpilogue"),
    part: t("chapters.typePart"),
    frontmatter: t("chapters.typeFrontmatter"),
    backmatter: t("chapters.typeBackmatter"),
  };

  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  const activatedKeysRef = useRef(new Set<Key>());

  const activateChapter = (key: Key) => {
    if (activatedKeysRef.current.has(key)) return;
    activatedKeysRef.current.add(key);
    queueMicrotask(() => activatedKeysRef.current.delete(key));
    const chapter = chaptersRef.current.find((item) => item.id === String(key));
    if (chapter) onSelectChapter(chapter);
  };

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) =>
      [...keys].map((key) => ({
        [CHAPTER_DND_TYPE]: String(key),
      })),
    onReorder: (e) => {
      const chs = chaptersRef.current;
      const key = [...e.keys][0];
      if (key === undefined) return;
      const fromIndex = chs.findIndex((c) => c.id === key);
      if (fromIndex === -1) return;

      const reordered = [...chs];
      const [moved] = reordered.splice(fromIndex, 1);
      let toIndex = chs.findIndex((c) => c.id === e.target.key);
      if (e.target.dropPosition === "after") toIndex++;
      if (fromIndex < toIndex) toIndex--;
      reordered.splice(toIndex, 0, moved);

      onReorderChapters(reordered.map((c) => c.id));
    },
    getDropOperation: (_target, types, allowedOperations) => {
      if (types.has(CHAPTER_DND_TYPE)) {
        return allowedOperations.includes("move") ? "move" : "cancel";
      }
      return onImportFilesRef.current ? "copy" : "cancel";
    },
    onInsert: (e) => {
      void (async () => {
        const files = await readChapterDropItems([...e.items]);
        if (files.length === 0) return;
        onImportFilesRef.current?.(files, {
          id: String(e.target.key),
          placement: e.target.dropPosition === "after" ? "after" : "before",
        });
      })();
    },
    onRootDrop: (e) => {
      void (async () => {
        const files = await readChapterDropItems([...e.items]);
        if (files.length > 0) onImportFilesRef.current?.(files, null);
      })();
    },
    renderDropIndicator: (target) => (
      <DropIndicator
        target={target}
        className={({ isDropTarget }) =>
          isDropTarget
            ? "mx-2 my-1 block h-0.5 rounded-full bg-primary shadow-[0_0_0_1px_var(--color-primary)]"
            : "h-0"
        }
      />
    ),
  });

  const handleCreate = () => {
    if (newTitle.trim()) {
      onCreateChapter(newTitle.trim(), newType);
      setNewTitle("");
      setNewType("chapter");
      setShowNewDialog(false);
    }
  };

  const handleDelete = (id: string) => {
    const chapterIndex = chaptersRef.current.findIndex((chapter) => chapter.id === id);
    const focusChapter =
      chaptersRef.current[chapterIndex + 1] ?? chaptersRef.current[chapterIndex - 1];
    onDeleteChapter(id);
    setDeleteConfirmId(null);
    requestAnimationFrame(() => {
      const rows = listContainerRef.current?.querySelectorAll<HTMLElement>("[data-key]");
      const focusTarget = [...(rows ?? [])].find(
        (row) => row.getAttribute("data-key") === focusChapter?.id
      );
      (focusTarget ?? addButtonRef.current)?.focus();
    });
  };

  const cancelDelete = (id: string) => {
    setDeleteConfirmId(null);
    requestAnimationFrame(() => deleteButtonRefs.current.get(id)?.focus());
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
    <aside
      className="w-full border-r border-border flex flex-col bg-background h-full shrink-0"
      data-focus-pane="chapter-list"
      tabIndex={-1}
      aria-label={t("panes.chapterList")}
    >
      {/* Sticky header */}
      <div className="p-4 pt-12 md:pt-4 border-b border-border flex items-center justify-between bg-background z-10 shrink-0">
        <h3 className="font-medium">{t("chapters.title")}</h3>
        <div className="flex items-center gap-1">
          <Tooltip
            content={
              isCompactView ? t("chapters.switchToNormalView") : t("chapters.switchToCompactView")
            }
          >
            <button
              type="button"
              onClick={toggleChapterListView}
              className="p-1 hover:bg-muted rounded transition-colors"
              aria-label={
                isCompactView ? t("chapters.switchToNormalView") : t("chapters.switchToCompactView")
              }
              aria-pressed={isCompactView}
            >
              {isCompactView ? <Rows3 className="w-5 h-5" /> : <List className="w-5 h-5" />}
            </button>
          </Tooltip>
          <Tooltip content={t("chapters.addChapter")}>
            <button
              ref={addButtonRef}
              type="button"
              onClick={() => setShowNewDialog(true)}
              className="p-1 hover:bg-muted rounded transition-colors"
              aria-label={t("chapters.addChapter")}
            >
              <AddIcon className="w-5 h-5" />
            </button>
          </Tooltip>
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
            ariaLabel={t("chapters.chapterType")}
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
        className={`relative flex-1 overflow-y-auto overflow-x-hidden ${isDraggingFile ? "ring-2 ring-inset ring-primary" : ""}`}
      >
        <GridList
          aria-label={t("chapters.title")}
          keyboardNavigationBehavior="tab"
          items={chapters}
          dependencies={[
            currentChapterId,
            deleteConfirmId,
            editTitle,
            editType,
            editingId,
            editor,
            isCompactView,
            i18n.resolvedLanguage,
            showChapterOutline,
            t,
          ]}
          selectedKeys={currentChapterId ? [currentChapterId] : []}
          selectionMode="single"
          selectionBehavior="replace"
          disallowEmptySelection
          onAction={activateChapter}
          dragAndDropHooks={dragAndDropHooks}
          className="p-2 space-y-1 data-[drop-target]:ring-2 data-[drop-target]:ring-inset data-[drop-target]:ring-primary"
          renderEmptyState={() => (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <p>{t("chapters.noChapters")}</p>
            </div>
          )}
        >
          {(chapter) => {
            const isActive = currentChapterId === chapter.id;
            const outlineToggle =
              isActive && editor ? (
                <Tooltip content={showChapterOutline ? t("toc.hideOutline") : t("toc.showOutline")}>
                  <AriaButton
                    onPress={() => setShowChapterOutline(!showChapterOutline)}
                    aria-label={showChapterOutline ? t("toc.hideOutline") : t("toc.showOutline")}
                    aria-pressed={showChapterOutline}
                    className={`shrink-0 p-1 rounded transition-colors ${
                      showChapterOutline
                        ? "text-primary bg-primary/10 hover:bg-primary/20"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <ListTree className="w-3.5 h-3.5" />
                  </AriaButton>
                </Tooltip>
              ) : null;

            return (
              <GridListItem
                id={chapter.id}
                textValue={chapter.title}
                onPress={() => activateChapter(chapter.id)}
                className={`group relative rounded transition-colors ${
                  isActive ? "bg-primary/10 border-l-2 border-primary" : "hover:bg-muted/50"
                }`}
              >
                <div
                  className={
                    isActive && showChapterOutline
                      ? "sticky top-0 z-10 rounded backdrop-blur-sm"
                      : ""
                  }
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
                        ariaLabel={t("chapters.chapterType")}
                        value={editType}
                        onChange={(value) => setEditType(value)}
                        options={Object.entries(chapterTypeLabels).map(([value, label]) => ({
                          value: value as ChapterType,
                          label,
                        }))}
                        className="mb-2"
                      />
                      <div className="flex gap-2">
                        <AriaButton
                          onPress={handleUpdate}
                          isDisabled={!editTitle.trim()}
                          className="flex-1 px-2 py-1 text-xs bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-50"
                        >
                          {t("common.save")}
                        </AriaButton>
                        <AriaButton
                          onPress={cancelEditing}
                          className="px-2 py-1 text-xs border border-border rounded hover:bg-muted"
                        >
                          {t("common.cancel")}
                        </AriaButton>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex w-full min-w-0 items-center">
                        <AriaButton
                          slot="drag"
                          aria-label={t("chapters.reorder")}
                          className="shrink-0 cursor-grab rounded p-0.5 mr-1 text-muted-foreground hover:bg-muted active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                          <GripVertical className="w-3.5 h-3.5" aria-hidden="true" />
                        </AriaButton>

                        <div className={`flex-1 min-w-0 ${isCompactView ? "px-2 py-1.5" : "p-3"}`}>
                          {/* Title line: icon, title, inline edit/delete actions */}
                          <div className="flex min-w-0 items-center gap-2">
                            <ChapterIcon
                              className={`shrink-0 text-muted-foreground ${
                                isCompactView ? "w-3.5 h-3.5" : "w-4 h-4"
                              }`}
                            />
                            <span
                              className={`flex-1 min-w-0 truncate font-medium ${
                                isCompactView ? "text-xs" : "text-sm"
                              }`}
                            >
                              {chapter.title}
                            </span>

                            {/* Edit/Delete - revealed on hover and focus */}
                            <span className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                              <Tooltip content={t("chapters.editChapter")}>
                                <AriaButton
                                  onPress={() => startEditing(chapter)}
                                  className="p-1 hover:bg-muted rounded transition-colors"
                                  aria-label={t("chapters.editChapter")}
                                >
                                  <EditIcon className="w-4 h-4 text-foreground" />
                                </AriaButton>
                              </Tooltip>
                              <Tooltip content={t("chapters.deleteChapter")}>
                                <AriaButton
                                  ref={(element) => {
                                    if (element) deleteButtonRefs.current.set(chapter.id, element);
                                    else deleteButtonRefs.current.delete(chapter.id);
                                  }}
                                  onPress={() => setDeleteConfirmId(chapter.id)}
                                  className="p-1 hover:bg-destructive/10 rounded transition-colors"
                                  aria-label={t("chapters.deleteChapter")}
                                >
                                  <DeleteIcon className="w-4 h-4 text-destructive" />
                                </AriaButton>
                              </Tooltip>
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
                      </div>

                      {/* Delete confirmation */}
                      {deleteConfirmId === chapter.id && (
                        <div className="absolute inset-0 bg-background rounded flex items-center justify-center gap-2 p-2">
                          <span className="text-xs">{t("common.deleteConfirm")}</span>
                          <AriaButton
                            onPress={() => handleDelete(chapter.id)}
                            className="px-2 py-1 text-xs bg-destructive text-white rounded hover:bg-destructive-hover"
                          >
                            {t("common.yes")}
                          </AriaButton>
                          <AriaButton
                            onPress={() => cancelDelete(chapter.id)}
                            className="px-2 py-1 text-xs border border-border rounded hover:bg-muted"
                          >
                            {t("common.no")}
                          </AriaButton>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {isActive && editor && showChapterOutline && (
                  <div className="list-none">
                    <ChapterOutline editor={editor} />
                  </div>
                )}
              </GridListItem>
            );
          }}
        </GridList>
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
