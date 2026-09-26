import { useCallback, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { Collection } from "react-aria-components/Collection";
import {
  GridList,
  GridListHeader,
  GridListItem,
  GridListSection,
} from "react-aria-components/GridList";
import { DropIndicator } from "react-aria-components";
import { useDragAndDrop } from "react-aria-components/useDragAndDrop";
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Feather,
  FolderTree,
  List,
  Search,
  Tags,
} from "lucide-react";
import type { Book } from "@/features/books/types";
import type { ReorderNoteItem } from "@/features/notes";
import { AddIcon } from "@/components/icons/AddIcon";
import { FileDropImportStatus, ResponsiveToggleGroup, Tooltip } from "@/components/ui";
import {
  SectionDropIndicators,
  SectionedDropTargetDelegate,
} from "@/components/ui/SectionedGridListDnd";
import { toast } from "@/components/ui/Toast";
import type { ResponsiveToggleOption } from "@/components/ui";
import { DeleteNoteDialog } from "@/components/notes/DeleteNoteDialog";
import { NoteListItem } from "@/components/notes/NoteListItem";
import type { NoteMoveTarget } from "@/components/notes/NoteListItem";
import { useTouchDragFromHandle } from "@/hooks/useItemContextMenu";
import { readDroppedItems, useTextFileDrop } from "@/hooks/useTextFileDrop";
import type { DroppedTextFile } from "@/hooks/useTextFileDrop";
import type { DropPoint } from "@/hooks/useTextFileDrop";
import { dropTargetFromPoint } from "@/lib/drop-target";
import type { ListDropTarget } from "@/lib/drop-target";
import { useDragAutoScroll } from "@/hooks/useDragAutoScroll";
import { useSettingsStore } from "@/features/settings/store";
import { tagColor } from "@/components/notes/tagColor";
import {
  buildBookNoteGroups,
  buildDateNoteGroups,
  buildListNoteSections,
  buildTagNoteGroups,
  filterNotes,
} from "@/components/notes/notes-list-model";
import type {
  NoteWithBook,
  NoteSection,
  NotesListViewMode,
  NotesTreeGroupMode,
} from "@/components/notes/notes-list-model";

const NOTE_DND_TYPE = "note";

type DropPlacement = "before" | "after";

interface DropTarget {
  sectionId: NoteSection["id"];
  targetId: string | null;
  placement: DropPlacement;
}

interface NotesListProps {
  notes: NoteWithBook[];
  books?: Book[];
  currentNoteId: string | null;
  onSelectNote: (note: NoteWithBook) => void;
  onCreateNote: (bookId?: string | null) => void;
  onReorderNotes: (items: string[] | ReorderNoteItem[]) => Promise<void>;
  onReassignNoteBook?: (noteId: string, bookId: string | null) => void;
  onDeleteNote?: (id: string) => void | Promise<void>;
  onDuplicateNote?: (note: NoteWithBook) => void;
  onRenameNote?: (id: string, title: string) => void;
  onImportFiles?: (files: DroppedTextFile[], target: ListDropTarget | null) => void | Promise<void>;
}

export function NotesList({
  notes,
  books = [],
  currentNoteId,
  onSelectNote,
  onCreateNote,
  onReorderNotes,
  onReassignNoteBook,
  onDeleteNote,
  onDuplicateNote,
  onRenameNote,
  onImportFiles,
}: NotesListProps) {
  const { t } = useTranslation();
  const listContainerRef = useRef<HTMLDivElement>(null);
  const newNoteButtonRef = useRef<HTMLButtonElement>(null);
  const activatedNoteIdsRef = useRef(new Set<string>());
  const autoScroll = useDragAutoScroll(listContainerRef);
  const [search, setSearch] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [activeReactAriaImports, setActiveReactAriaImports] = useState(0);
  const onImportFilesRef = useRef(onImportFiles);
  onImportFilesRef.current = onImportFiles;
  const onReorderNotesRef = useRef(onReorderNotes);
  onReorderNotesRef.current = onReorderNotes;
  // The row a Delete was confirmed from, and the row that should take focus
  // once it is gone (next, else previous, else the create control).
  const deleteFocusRef = useRef<{ row: HTMLElement | null; neighbor: HTMLElement | null }>({
    row: null,
    neighbor: null,
  });
  const touchDragGuard = useTouchDragFromHandle();
  const viewMode = useSettingsStore((s) => s.notesListView);
  const setViewMode = useSettingsStore((s) => s.setNotesListView);
  const treeGroupMode = useSettingsStore((s) => s.notesTreeGroupMode);
  const setTreeGroupMode = useSettingsStore((s) => s.setNotesTreeGroupMode);
  const collapsedGroupsList = useSettingsStore((s) => s.notesCollapsedGroups);
  const expandedEmptyGroupsList = useSettingsStore((s) => s.notesExpandedEmptyGroups);
  const toggleCollapsed = useSettingsStore((s) => s.toggleNotesGroupCollapsed);
  const toggleEmptyExpanded = useSettingsStore((s) => s.toggleNotesEmptyGroupExpanded);
  const collapsedGroups = useMemo(() => new Set(collapsedGroupsList), [collapsedGroupsList]);
  const expandedEmptyGroups = useMemo(
    () => new Set(expandedEmptyGroupsList),
    [expandedEmptyGroupsList]
  );
  const viewToggleOptions = useMemo<ResponsiveToggleOption<NotesListViewMode>[]>(
    () => [
      {
        value: "list",
        label: t("notes.viewList"),
        icon: <List className="h-3.5 w-3.5" />,
        labelTestId: "notes-view-label-list",
      },
      {
        value: "tree",
        label: t("notes.viewTree"),
        icon: <FolderTree className="h-3.5 w-3.5" />,
        labelTestId: "notes-view-label-tree",
      },
    ],
    [t]
  );
  const groupToggleOptions = useMemo<ResponsiveToggleOption<NotesTreeGroupMode>[]>(
    () => [
      {
        value: "book",
        label: t("notes.groupBook"),
        icon: <BookOpen className="h-3.5 w-3.5" />,
        labelTestId: "notes-group-label-book",
      },
      {
        value: "tag",
        label: t("notes.groupTag"),
        icon: <Tags className="h-3.5 w-3.5" />,
        labelTestId: "notes-group-label-tag",
      },
      {
        value: "date",
        label: t("notes.groupDate"),
        icon: <CalendarDays className="h-3.5 w-3.5" />,
        labelTestId: "notes-group-label-date",
      },
    ],
    [t]
  );

  const query = search.trim().toLowerCase();
  const filtered = filterNotes(notes, query);
  const listSections = buildListNoteSections(notes, query);
  const listSectionsRef = useRef(listSections);
  listSectionsRef.current = listSections;
  const pinnedCount = notes.filter((note) => note.pinned).length;
  const isSearchActive = query.length > 0;
  // The list view reorders through React Aria drag-and-drop, which is also its
  // keyboard path. Search hides Notes, so an order written then would be partial.
  const canReorder = viewMode === "list" && !isSearchActive && filtered.length > 0;

  const resolveFileDropTarget = useCallback(
    (point: DropPoint | null): ListDropTarget | null => {
      const container = listContainerRef.current;
      if (!point || !container || viewMode !== "list") return null;
      return dropTargetFromPoint(container, point.y, "[data-drop-id]", "data-drop-id");
    },
    [viewMode]
  );

  const { isDraggingFile, isImportingFiles, dropHandlers } = useTextFileDrop(listContainerRef, {
    // React Aria owns web drops over a reorderable list (it stops dragover).
    disableWeb: canReorder,
    onImport: async (files, point) => {
      setDropTarget(null);
      await onImportFiles?.(files, resolveFileDropTarget(point));
    },
    onDragMove: (point) => {
      const target = resolveFileDropTarget(point);
      if (!target) {
        setDropTarget(null);
        return;
      }
      const sectionId = listSectionsRef.current.find((section) =>
        section.notes.some((note) => note.id === target.id)
      )?.id;
      setDropTarget(
        sectionId ? { sectionId, targetId: target.id, placement: target.placement } : null
      );
    },
  });

  const activateNote = (note: NoteWithBook) => {
    if (activatedNoteIdsRef.current.has(note.id)) return;
    activatedNoteIdsRef.current.add(note.id);
    queueMicrotask(() => activatedNoteIdsRef.current.delete(note.id));
    onSelectNote(note);
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, id: string) => {
    if (isSearchActive) return;
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    autoScroll.onDragOver(e.clientY);
  };

  // A section header takes a dragged Note at the section's end, which is the
  // only way to drop into an empty section. React Aria does not see the event.
  const handleSectionDragOver = (e: DragEvent<HTMLElement>, sectionId: NoteSection["id"]) => {
    if (!draggedId) return;
    e.stopPropagation();
    handleDragOver(e);
    if (isSearchActive) return;
    setDropTarget({ sectionId, targetId: null, placement: "after" });
  };

  const emitSectionOrder = (sections: NoteSection[]) => {
    void onReorderNotesRef.current(
      sections.flatMap((section) =>
        section.notes.map((note) => ({
          id: note.id,
          pinned: section.id === "pinned",
        }))
      )
    );
  };

  const importDroppedItems = async (
    items: Parameters<typeof readDroppedItems>[0],
    target: ListDropTarget | null
  ) => {
    setActiveReactAriaImports((active) => active + 1);
    try {
      const files = await readDroppedItems(items);
      if (files.length > 0) await onImportFilesRef.current?.(files, target);
    } catch (error) {
      console.error("Failed to import dropped files:", error);
      toast.error(t("dropImport.importFailed"));
    } finally {
      setActiveReactAriaImports((active) => Math.max(0, active - 1));
    }
  };

  const gridRef = useRef<HTMLDivElement>(null);
  const [dropTargetDelegate] = useState(() => new SectionedDropTargetDelegate(gridRef));
  const { dragAndDropHooks } = useDragAndDrop({
    // Always passed to the GridList (swapping hooks on a mounted list breaks
    // React's hook order), and off while a search hides Notes.
    isDisabled: !canReorder,
    dropTargetDelegate,
    getItems: (keys) => [...keys].map((key) => ({ [NOTE_DND_TYPE]: String(key) })),
    onDragStart: (e) => setDraggedId(String([...e.keys][0] ?? "") || null),
    onDragEnd: () => {
      setDraggedId(null);
      setDropTarget(null);
    },
    // Dropping among the Pinned Notes pins; among the rest unpins. `onMove`,
    // not `onReorder`: React Aria limits a reorder to the dragged row's own
    // section, and crossing sections is how a drag pins or unpins.
    onMove: (e) => {
      const key = String([...e.keys][0] ?? "");
      const targetKey = String(e.target.key);
      if (!key || key === targetKey) return;
      const sections = listSectionsRef.current;
      const dragged = sections.flatMap((section) => section.notes).find((n) => n.id === key);
      if (!dragged) return;
      const nextSections = sections.map((section) => ({
        ...section,
        notes: section.notes.filter((note) => note.id !== key),
      }));
      const targetSection = nextSections.find((section) =>
        section.notes.some((note) => note.id === targetKey)
      );
      if (!targetSection) return;
      const targetIndex = targetSection.notes.findIndex((note) => note.id === targetKey);
      targetSection.notes.splice(
        e.target.dropPosition === "after" ? targetIndex + 1 : targetIndex,
        0,
        dragged
      );
      emitSectionOrder(nextSections);
    },
    getDropOperation: (target, types, allowedOperations) => {
      // Notes do not nest: only the gaps between rows take a drop.
      if (target.type === "item" && target.dropPosition === "on") return "cancel";
      if (types.has(NOTE_DND_TYPE)) {
        return allowedOperations.includes("move") ? "move" : "cancel";
      }
      return onImportFilesRef.current ? "copy" : "cancel";
    },
    onInsert: (e) =>
      void importDroppedItems([...e.items], {
        id: String(e.target.key),
        placement: e.target.dropPosition === "after" ? "after" : "before",
      }),
    onRootDrop: (e) => void importDroppedItems([...e.items], null),
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

  const handleSectionDrop = (e: DragEvent<HTMLElement>, targetSectionId: NoteSection["id"]) => {
    if (!draggedId) return;
    e.preventDefault();
    e.stopPropagation();
    autoScroll.stop();
    if (isSearchActive) return;

    const draggedNote = notes.find((note) => note.id === draggedId);
    if (!draggedNote) return;

    const nextSections = listSections.map((section) => ({
      ...section,
      notes: section.notes.filter((note) => note.id !== draggedId),
    }));
    const targetSection = nextSections.find((section) => section.id === targetSectionId);
    if (!targetSection) return;

    targetSection.notes.push(draggedNote);
    emitSectionOrder(nextSections);
    setDraggedId(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    autoScroll.stop();
    setDraggedId(null);
    setDropTarget(null);
  };

  const handleGroupDragOver = (e: DragEvent<HTMLDivElement>, groupId: string) => {
    if (!draggedId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverGroupId(groupId);
    autoScroll.onDragOver(e.clientY);
  };

  const handleGroupDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOverGroupId(null);
  };

  const handleGroupDrop = (e: DragEvent<HTMLDivElement>, targetBookId: string | null) => {
    e.preventDefault();
    autoScroll.stop();
    setDragOverGroupId(null);
    const noteId = draggedId;
    setDraggedId(null);
    if (!noteId) return;
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;
    const currentBookId = note.bookId ?? null;
    if (currentBookId === targetBookId) return;
    onReassignNoteBook?.(noteId, targetBookId);
  };

  // Pinning from the item menu reuses the drag path's ordering write, over
  // every note rather than the search-filtered sections.
  const togglePinned = (note: NoteWithBook) => {
    const sections = buildListNoteSections(notes, "").map((section) => ({
      ...section,
      notes: section.notes.filter((sectionNote) => sectionNote.id !== note.id),
    }));
    const pinned = sections.find((section) => section.id === "pinned");
    const all = sections.find((section) => section.id === "all");
    if (!pinned || !all) return;
    if (note.pinned) all.notes.unshift(note);
    else pinned.notes.push(note);
    emitSectionOrder(sections);
  };

  const moveTargets: NoteMoveTarget[] =
    onReassignNoteBook && books.length > 0
      ? [
          { bookId: null, label: t("notes.unfiled") },
          ...books.map((book) => ({ bookId: book.id, label: book.title })),
        ]
      : [];
  const moveNote = (note: { id: string }, bookId: string | null) =>
    onReassignNoteBook?.(note.id, bookId);
  const requestDelete = onDeleteNote
    ? (id: string) => {
        const rows = [
          ...(listContainerRef.current?.querySelectorAll<HTMLElement>("[data-key]") ?? []),
        ];
        const index = rows.findIndex((row) => row.dataset.key === id);
        deleteFocusRef.current = {
          row: index === -1 ? null : rows[index],
          neighbor: index === -1 ? null : (rows[index + 1] ?? rows[index - 1] ?? null),
        };
        setPendingDeleteId(id);
      }
    : undefined;
  const pendingDeleteNote = notes.find((note) => note.id === pendingDeleteId) ?? null;

  // The row that opened the dialog on cancel; the surviving neighbour (or the
  // create control) once a confirmed delete has removed it.
  const getDeleteRestoreTarget = () => {
    const { row, neighbor } = deleteFocusRef.current;
    if (row?.isConnected) return row;
    if (neighbor?.isConnected) return neighbor;
    return newNoteButtonRef.current;
  };

  const confirmDelete = async () => {
    const id = pendingDeleteId;
    if (!id) return;
    // The dialog closes when the Note leaves the list, so focus restoration
    // already sees the row gone and can land on its neighbour.
    await onDeleteNote?.(id);
    setPendingDeleteId(null);
  };

  const renderDropIndicator = (note: NoteWithBook, placement: DropPlacement) => {
    if (dropTarget?.targetId !== note.id || dropTarget.placement !== placement) {
      return null;
    }

    return (
      <div
        data-testid={`note-drop-indicator-${placement}-${note.id}`}
        className="mx-2 my-1 h-0.5 rounded-full bg-primary shadow-[0_0_0_1px_var(--color-primary)]"
      />
    );
  };

  const renderSectionAppendIndicator = (sectionId: NoteSection["id"]) => {
    if (dropTarget?.sectionId !== sectionId || dropTarget.targetId !== null) {
      return null;
    }

    return (
      <div
        data-testid={`note-drop-indicator-section-${sectionId}`}
        className="mx-2 my-2 h-0.5 rounded-full bg-primary shadow-[0_0_0_1px_var(--color-primary)]"
      />
    );
  };

  const renderNote = (note: NoteWithBook) => (
    <GridListItem
      id={note.id}
      textValue={note.title || t("notes.untitled")}
      onAction={() => activateNote(note)}
      className={({ isFocusVisible }) =>
        `rounded-md ${isFocusVisible ? "ring-2 ring-primary ring-offset-1" : ""}`
      }
    >
      {renderDropIndicator(note, "before")}
      <NoteListItem
        note={note}
        isSelected={currentNoteId === note.id}
        onSelect={activateNote}
        onDelete={requestDelete}
        onDuplicate={onDuplicateNote}
        onRename={(targetNote, title) => onRenameNote?.(targetNote.id, title)}
        onTogglePinned={() => togglePinned(note)}
        moveTargets={moveTargets}
        onMove={moveNote}
        reorderLabel={canReorder ? t("notes.reorder") : undefined}
        isDragging={draggedId === note.id}
      />
      {renderDropIndicator(note, "after")}
    </GridListItem>
  );

  const renderTreeNote = (note: NoteWithBook) => (
    <NoteListItem
      key={note.id}
      note={note}
      isSelected={currentNoteId === note.id}
      onSelect={activateNote}
      onDelete={requestDelete}
      onDuplicate={onDuplicateNote}
      onRename={(targetNote, title) => onRenameNote?.(targetNote.id, title)}
      onTogglePinned={() => togglePinned(note)}
      moveTargets={moveTargets}
      onMove={moveNote}
      draggable={treeGroupMode === "book" && !isSearchActive ? true : undefined}
      onDragStart={(e) => handleDragStart(e, note.id)}
      onDragEnd={handleDragEnd}
      isDragging={draggedId === note.id}
    />
  );

  // Namespace group keys by mode so identical ids across book/tag/date groups
  // (e.g. a tag named "today" and the "today" date bucket) don't share state.
  const groupKey = (id: string) => `${treeGroupMode}:${id}`;

  const toggleGroup = (id: string, defaultCollapsed = false) => {
    const key = groupKey(id);
    if (defaultCollapsed) {
      toggleEmptyExpanded(key);
      return;
    }
    toggleCollapsed(key);
  };

  const renderTreeGroups = () => {
    if (treeGroupMode === "book") {
      return buildBookNoteGroups(filtered, books).map((group) => {
        const defaultCollapsed = Boolean(group.book && group.notes.length === 0);
        const isCollapsed = defaultCollapsed
          ? !expandedEmptyGroups.has(groupKey(group.id))
          : collapsedGroups.has(groupKey(group.id));
        const title = group.id === "unfiled" ? t("notes.unfiled") : group.title;
        const GroupIcon = group.id === "unfiled" ? Feather : BookOpen;

        const targetBookId = group.book?.id ?? null;
        return (
          <div
            key={group.id}
            data-testid={`book-group-${group.id}`}
            onDragOver={(e) => handleGroupDragOver(e, group.id)}
            onDragLeave={handleGroupDragLeave}
            onDrop={(e) => handleGroupDrop(e, targetBookId)}
            className={`px-2 py-1 rounded-md transition-colors ${
              dragOverGroupId === group.id ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""
            }`}
          >
            <div className="group flex items-center gap-1 rounded-md px-1 py-1.5 hover:bg-muted/50 transition-colors duration-200">
              <button
                type="button"
                onClick={() => toggleGroup(group.id, defaultCollapsed)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-200"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              <GroupIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span
                data-testid={`book-title-action-${group.id}`}
                className="flex min-w-0 items-center gap-1"
              >
                <span className="min-w-0 truncate text-sm font-medium">{title}</span>
                {group.book && (
                  <Tooltip content={t("notes.addNoteToBook")}>
                    <button
                      type="button"
                      onClick={() => onCreateNote(group.book?.id ?? null)}
                      aria-label={t("notes.addNoteToBook")}
                      className="shrink-0 rounded p-0.5 pointer-coarse:p-1.5 text-muted-foreground opacity-0 transition-all duration-200 hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                    >
                      <AddIcon className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                )}
              </span>
              <span
                data-testid={`book-count-${group.id}`}
                className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {group.notes.length}
              </span>
            </div>
            {!isCollapsed && (
              <div className="ml-5">
                {group.notes.length > 0 ? (
                  <div className="space-y-1">{group.notes.map(renderTreeNote)}</div>
                ) : (
                  <p className="px-2 py-2 text-xs text-muted-foreground">{t("notes.noNotesYet")}</p>
                )}
              </div>
            )}
          </div>
        );
      });
    }

    if (treeGroupMode === "tag") {
      const groups = buildTagNoteGroups(filtered);
      return groups.map((group) => {
        const isCollapsed = collapsedGroups.has(groupKey(group.id));
        const color = tagColor(group.tag);

        return (
          <div key={group.id} className="px-2 py-1">
            <div className="flex items-center gap-1 rounded-md px-1 py-1.5 hover:bg-muted/50 transition-colors duration-200">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-200"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.title}</span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {group.notes.length}
              </span>
            </div>
            {!isCollapsed && (
              <div className="ml-5 space-y-1">{group.notes.map(renderTreeNote)}</div>
            )}
          </div>
        );
      });
    }

    return buildDateNoteGroups(filtered).map((group) => {
      const isCollapsed = collapsedGroups.has(groupKey(group.id));
      const title =
        group.id === "today"
          ? t("notes.today")
          : group.id === "this-week"
            ? t("notes.thisWeek")
            : group.title;

      return (
        <div key={group.id} className="px-2 py-1">
          <div className="flex items-center gap-1 rounded-md px-1 py-1.5 hover:bg-muted/50 transition-colors duration-200">
            <button
              type="button"
              onClick={() => toggleGroup(group.id)}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-200"
            >
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {group.notes.length}
            </span>
          </div>
          {!isCollapsed && <div className="ml-5 space-y-1">{group.notes.map(renderTreeNote)}</div>}
        </div>
      );
    });
  };

  return (
    <aside className="w-full border-r border-border flex flex-col bg-background h-full shrink-0">
      <div className="p-4 pt-12 md:pt-4 flex items-center justify-between gap-2 bg-background z-10 shrink-0">
        <h3 className="min-w-0 truncate font-medium">{t("notes.title")}</h3>
        <ResponsiveToggleGroup
          value={viewMode}
          options={viewToggleOptions}
          onChange={setViewMode}
          testId="notes-view"
          className="flex-1"
          tutorialAnchor="notes.tree"
        />
        <Tooltip content={t("notes.newNote")}>
          <button
            ref={newNoteButtonRef}
            type="button"
            onClick={() => onCreateNote(null)}
            aria-label={t("notes.newNote")}
            className="p-1 hover:bg-muted rounded transition-colors"
          >
            <AddIcon className="w-5 h-5" />
          </button>
        </Tooltip>
      </div>

      <div className="px-3 pb-3 shrink-0">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("notes.search")}
            className="w-full rounded-lg border border-border bg-muted/50 py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:bg-background"
          />
        </div>
        {viewMode === "tree" && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("notes.group")}
            </span>
            <ResponsiveToggleGroup
              value={treeGroupMode}
              options={groupToggleOptions}
              onChange={setTreeGroupMode}
              testId="notes-group"
              className="flex-1"
            />
          </div>
        )}
      </div>

      <div
        ref={listContainerRef}
        className={`flex-1 overflow-auto transition-all duration-200 ${isDraggingFile ? "ring-2 ring-inset ring-primary" : ""}`}
        {...touchDragGuard}
        {...(onImportFiles ? dropHandlers : {})}
      >
        {(isImportingFiles || activeReactAriaImports > 0) && <FileDropImportStatus />}
        {filtered.length === 0 &&
        (viewMode !== "tree" || treeGroupMode !== "book" || books.length === 0) ? (
          <div className="text-center py-8 px-4 text-muted-foreground text-sm">
            <p>{t("notes.empty")}</p>
          </div>
        ) : viewMode === "tree" ? (
          <div className="pb-2">{renderTreeGroups()}</div>
        ) : (
          <SectionDropIndicators>
            <GridList
              ref={gridRef}
              aria-label={t("notes.title")}
              keyboardNavigationBehavior="tab"
              dependencies={[
                currentNoteId,
                draggedId,
                dropTarget,
                canReorder,
                onDeleteNote,
                onDuplicateNote,
                onRenameNote,
                books,
              ]}
              selectedKeys={currentNoteId ? [currentNoteId] : []}
              selectionMode="single"
              selectionBehavior="replace"
              disallowEmptySelection
              className="p-2"
              dragAndDropHooks={dragAndDropHooks}
            >
              {listSections.map((section) => (
                <GridListSection
                  key={section.id}
                  id={section.id}
                  className="mb-3 min-h-8 last:mb-0"
                >
                  <GridListHeader>
                    <div
                      data-testid={`notes-section-${section.id}`}
                      data-drop-active={dropTarget?.sectionId === section.id ? "true" : undefined}
                      onDragOver={(e) => handleSectionDragOver(e, section.id)}
                      onDrop={(e) => handleSectionDrop(e, section.id)}
                      className={`min-h-8 rounded-md px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors ${
                        dropTarget?.sectionId === section.id
                          ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
                          : ""
                      }`}
                    >
                      {section.id === "pinned" ? t("notes.sectionPinned") : t("notes.sectionAll")}
                      {renderSectionAppendIndicator(section.id)}
                    </div>
                  </GridListHeader>
                  <Collection items={section.notes}>{renderNote}</Collection>
                </GridListSection>
              ))}
            </GridList>
          </SectionDropIndicators>
        )}
      </div>

      {notes.length > 0 && (
        <div className="p-3 border-t border-border text-xs text-muted-foreground bg-background shrink-0">
          {t("notes.pinnedCount", { count: pinnedCount })}
        </div>
      )}

      <DeleteNoteDialog
        note={pendingDeleteNote}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => void confirmDelete()}
        restoreFocusTarget={getDeleteRestoreTarget}
      />
    </aside>
  );
}
