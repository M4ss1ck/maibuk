import { useCallback, useMemo, useRef, useState } from "react";
import type { DragEvent, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Collection } from "react-aria-components/Collection";
import {
  GridList,
  GridListHeader,
  GridListItem,
  GridListSection,
} from "react-aria-components/GridList";
import { DropIndicator, ListLayout, Virtualizer } from "react-aria-components";
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
import { FileDropImportStatus, ResponsiveToggleGroup, SortSelect, Tooltip } from "@/components/ui";
import {
  SectionDropIndicators,
  SectionedDropTargetDelegate,
} from "@/components/ui/SectionedGridListDnd";
import { toast } from "@/components/ui/Toast";
import type { ResponsiveToggleOption } from "@/components/ui";
import { DeleteNoteDialog } from "@/components/notes/DeleteNoteDialog";
import { CommandPaletteButton } from "@/components/command-palette/CommandPaletteButton";
import { NoteListItem } from "@/components/notes/NoteListItem";
import type { NoteMoveTarget } from "@/components/notes/NoteListItem";
import { useTouchDragFromHandle } from "@/hooks/useItemContextMenu";
import { useParkSelectionWhileDragging } from "@/hooks/useParkSelectionWhileDragging";
import { readDroppedItems, useTextFileDrop } from "@/hooks/useTextFileDrop";
import type { DroppedTextFile } from "@/hooks/useTextFileDrop";
import type { DropPoint } from "@/hooks/useTextFileDrop";
import { dropTargetFromPoint } from "@/lib/drop-target";
import type { ListDropTarget } from "@/lib/drop-target";
import { useDragAutoScroll } from "@/hooks/useDragAutoScroll";
import { useFlipReorder } from "@/hooks/useFlipReorder";
import { useSettingsStore } from "@/features/settings/store";
import { useShortcuts } from "@/lib/shortcuts";
import { tagColor } from "@/components/notes/tagColor";
import {
  buildBookNoteGroups,
  buildDateNoteGroups,
  buildListNoteSections,
  buildTagNoteGroups,
  filterNotes,
  NOTES_SORT_COMMANDS,
  notesSortOptions,
  placeNote,
  sortNotesBy,
} from "@/components/notes/notes-list-model";
import type {
  NoteWithBook,
  NoteSection,
  NotesListViewMode,
  NotesSidebarSort,
  NotesTreeGroupMode,
} from "@/components/notes/notes-list-model";

const NOTE_DND_TYPE = "note";

/**
 * React Aria layout for the list view, sections included (#550). Rows are
 * variable height, so `estimatedRowSize` only places rows that are not mounted
 * yet; mounted rows are measured. A section heading is 44px: the 32px label
 * row plus the 12px gap that the section margin used to give. `gap` and
 * `padding` replace the former `space-y` and `p-2`.
 */
const NOTE_LIST_LAYOUT = {
  estimatedRowSize: 88,
  estimatedHeadingSize: 44,
  headingSize: 44,
  gap: 0,
  padding: 8,
} as const;
const REVEAL_FRAMES = 3;

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
  // The list view's scroll view is the GridList the Virtualizer scrolls.
  const gridRef = useRef<HTMLDivElement>(null);
  const newNoteButtonRef = useRef<HTMLButtonElement>(null);
  const activatedNoteIdsRef = useRef(new Set<string>());
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
  const deleteFocusRef = useRef<{ row: HTMLElement | null; neighborId: string | null }>({
    row: null,
    neighborId: null,
  });
  const touchDragGuard = useTouchDragFromHandle();
  const viewMode = useSettingsStore((s) => s.notesListView);
  const setViewMode = useSettingsStore((s) => s.setNotesListView);
  // The scroll view: the GridList in the list view, the wrapper in the tree.
  // Read at call time, so a drag or a reorder follows the view that is shown.
  const scrollViewRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return viewMode === "list" ? gridRef.current : listContainerRef.current;
      },
    }),
    [viewMode]
  );
  const autoScroll = useDragAutoScroll(scrollViewRef);
  const treeGroupMode = useSettingsStore((s) => s.notesTreeGroupMode);
  const setTreeGroupMode = useSettingsStore((s) => s.setNotesTreeGroupMode);
  const listSort = useSettingsStore((s) => s.notesListSort);
  const setListSort = useSettingsStore((s) => s.setNotesListSort);
  const treeSort = useSettingsStore((s) => s.notesTreeSort);
  const setTreeSort = useSettingsStore((s) => s.setNotesTreeSort);
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

  const sortOptions = useMemo(() => notesSortOptions(t, { custom: true }), [t]);
  const activeSort = viewMode === "list" ? listSort : treeSort;
  const activeSortLabel =
    sortOptions.find((option) => option.value === activeSort)?.label ?? sortOptions[0].label;

  const query = search.trim().toLowerCase();
  const filtered = filterNotes(notes, query);
  const listSections = buildListNoteSections(notes, query, listSort);
  const listSectionsRef = useRef(listSections);
  listSectionsRef.current = listSections;
  // Rows glide to the place a Sort gives them; another view or search just redraws.
  useFlipReorder(
    scrollViewRef,
    viewMode === "list"
      ? listSections.flatMap((section) => section.notes.map((note) => note.id))
      : sortNotesBy(filtered, treeSort).map((note) => note.id),
    { skipKey: draggedId, scope: `${viewMode}:${treeGroupMode}:${query}` }
  );
  const pinnedCount = notes.filter((note) => note.pinned).length;
  const isSearchActive = query.length > 0;
  // The list view reorders through React Aria drag-and-drop, which is also its
  // keyboard path. Search hides Notes, so an order written then would be partial.
  const canReorder = viewMode === "list" && !isSearchActive && filtered.length > 0;

  // A list Sort is a view; leaving it keeps the order it showed as the Custom
  // Order (ADR 0028). The tree's Sort never writes.
  const applySort = (sort: NotesSidebarSort) => {
    if (viewMode === "tree") {
      setTreeSort(sort);
      return;
    }
    if (sort === "custom" && listSort !== "custom") {
      emitSectionOrder(buildListNoteSections(notes, "", listSort));
    }
    setListSort(sort);
  };

  useShortcuts([
    { id: "notes.newNote", onTrigger: () => onCreateNote(null) },
    {
      id: "notes.addNoteToBook",
      enabled: books.length > 0,
      onTrigger: () => onCreateNote(books[0]?.id ?? null),
    },
    ...NOTES_SORT_COMMANDS.map(({ id, sort }) => ({ id, onTrigger: () => applySort(sort) })),
  ]);

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

  // A drag while sorted makes the shown order, with the move, the Custom Order.
  const emitDraggedOrder = (sections: NoteSection[]) => {
    emitSectionOrder(sections);
    if (listSort !== "custom") setListSort("custom");
  };

  function emitSectionOrder(sections: NoteSection[]) {
    void onReorderNotesRef.current(
      sections.flatMap((section) =>
        section.notes.map((note) => ({
          id: note.id,
          pinned: section.id === "pinned",
        }))
      )
    );
  }

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

  const [dropTargetDelegate] = useState(() => new SectionedDropTargetDelegate(gridRef));
  const dragHandlers = useParkSelectionWhileDragging({
    onDragStart: (e: { keys: Set<string | number> }) =>
      setDraggedId(String([...e.keys][0] ?? "") || null),
    onDragEnd: () => {
      setDraggedId(null);
      setDropTarget(null);
    },
  });
  const { dragAndDropHooks } = useDragAndDrop({
    // Always passed to the GridList (swapping hooks on a mounted list breaks
    // React's hook order), and off while a search hides Notes.
    isDisabled: !canReorder,
    dropTargetDelegate,
    getItems: (keys) => [...keys].map((key) => ({ [NOTE_DND_TYPE]: String(key) })),
    ...dragHandlers,
    // Dropping among the Pinned Notes pins; among the rest unpins. `onMove`,
    // not `onReorder`: React Aria limits a reorder to the dragged row's own
    // section, and crossing sections is how a drag pins or unpins.
    onMove: (e) => {
      const key = String([...e.keys][0] ?? "");
      const sections = listSectionsRef.current;
      const dragged = sections.flatMap((section) => section.notes).find((n) => n.id === key);
      if (!dragged || e.target.dropPosition === "on") return;
      const nextSections = placeNote(sections, dragged, {
        noteId: String(e.target.key),
        placement: e.target.dropPosition,
      });
      if (nextSections) emitDraggedOrder(nextSections);
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
    const nextSections =
      draggedNote &&
      placeNote(listSections, draggedNote, { sectionId: targetSectionId, at: "end" });
    if (nextSections) emitDraggedOrder(nextSections);
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
    const sections = placeNote(
      buildListNoteSections(notes, ""),
      note,
      note.pinned ? { sectionId: "all", at: "start" } : { sectionId: "pinned", at: "end" }
    );
    if (sections) emitSectionOrder(sections);
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
  const noteRowElement = (id: string): HTMLElement | null =>
    listContainerRef.current?.querySelector<HTMLElement>(
      `[role="row"][data-key="${CSS.escape(id)}"]`
    ) ?? null;

  /** Note ids in the order they are shown: the list's sections, or the tree's rendered rows. */
  const shownNoteIds = (): string[] =>
    viewMode === "list"
      ? listSectionsRef.current.flatMap((section) => section.notes.map((note) => note.id))
      : [...(listContainerRef.current?.querySelectorAll<HTMLElement>("[data-key]") ?? [])].map(
          (row) => row.dataset.key ?? ""
        );

  /** Where the Note at `id` sits by estimate, for a row the Virtualizer has not mounted. */
  const estimatedNoteTop = (id: string): number | null => {
    const { padding, gap, headingSize, estimatedRowSize } = NOTE_LIST_LAYOUT;
    let top = padding;
    for (const section of listSectionsRef.current) {
      top += headingSize + gap;
      for (const note of section.notes) {
        if (note.id === id) return top;
        top += estimatedRowSize + gap;
      }
    }
    return null;
  };

  /**
   * Runs `onRow` on the row for `id`, once it is mounted. A row the Virtualizer
   * has not mounted gets the scroll view moved to its estimated offset, then is
   * checked again on the next frame. The order comes from the data, not the DOM.
   */
  const revealNoteRow = (
    id: string,
    onRow: (row: HTMLElement) => void,
    framesLeft = REVEAL_FRAMES
  ): void => {
    const row = noteRowElement(id);
    if (row) {
      row.scrollIntoView({ block: "nearest" });
      onRow(row);
      return;
    }
    const top = viewMode === "list" ? estimatedNoteTop(id) : null;
    const scroll = gridRef.current;
    if (top === null || !scroll || framesLeft === 0) return;
    scroll.scrollTop = top;
    requestAnimationFrame(() => revealNoteRow(id, onRow, framesLeft - 1));
  };

  const requestDelete = onDeleteNote
    ? (id: string) => {
        const order = shownNoteIds();
        const index = order.indexOf(id);
        deleteFocusRef.current = {
          row: noteRowElement(id),
          neighborId: index === -1 ? null : (order[index + 1] ?? order[index - 1] ?? null),
        };
        setPendingDeleteId(id);
      }
    : undefined;
  const pendingDeleteNote = notes.find((note) => note.id === pendingDeleteId) ?? null;

  // The row that opened the dialog on cancel. Once a delete is confirmed the
  // row is gone: the neighbour if it is mounted, else the create control, and
  // confirmDelete then reveals the neighbour.
  const getDeleteRestoreTarget = () => {
    const { row, neighborId } = deleteFocusRef.current;
    if (row?.isConnected) return row;
    const neighbor = neighborId ? noteRowElement(neighborId) : null;
    if (neighbor) return neighbor;
    return newNoteButtonRef.current;
  };

  const confirmDelete = async () => {
    const id = pendingDeleteId;
    if (!id) return;
    const { neighborId } = deleteFocusRef.current;
    await onDeleteNote?.(id);
    setPendingDeleteId(null);
    // The neighbour may be off-screen, so it is revealed and focused after the
    // dialog's own focus restoration has run.
    if (neighborId) requestAnimationFrame(() => revealNoteRow(neighborId, (row) => row.focus()));
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

  const renderTreeNotes = (notes: NoteWithBook[], label: string) => (
    <GridList
      aria-label={label}
      selectedKeys={currentNoteId ? [currentNoteId] : []}
      selectionMode="single"
      selectionBehavior="replace"
      className="space-y-1"
    >
      {notes.map(renderTreeNote)}
    </GridList>
  );

  const renderTreeNote = (note: NoteWithBook) => (
    <GridListItem
      key={note.id}
      id={note.id}
      textValue={note.title || t("notes.untitled")}
      onAction={() => activateNote(note)}
      className={({ isFocusVisible }) =>
        `rounded-md ${isFocusVisible ? "ring-2 ring-primary ring-offset-1" : ""}`
      }
    >
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
        draggable={treeGroupMode === "book" && !isSearchActive ? true : undefined}
        onDragStart={(e) => handleDragStart(e, note.id)}
        onDragEnd={handleDragEnd}
        isDragging={draggedId === note.id}
      />
    </GridListItem>
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
      return buildBookNoteGroups(filtered, books, treeSort).map((group) => {
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
                aria-label={title}
                aria-expanded={!isCollapsed}
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
                  renderTreeNotes(group.notes, title)
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
      const groups = buildTagNoteGroups(filtered, treeSort);
      return groups.map((group) => {
        const isCollapsed = collapsedGroups.has(groupKey(group.id));
        const color = tagColor(group.tag);

        return (
          <div key={group.id} className="px-2 py-1">
            <div className="flex items-center gap-1 rounded-md px-1 py-1.5 hover:bg-muted/50 transition-colors duration-200">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-label={group.title}
                aria-expanded={!isCollapsed}
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
              <div className="ml-5">{renderTreeNotes(group.notes, group.title)}</div>
            )}
          </div>
        );
      });
    }

    return buildDateNoteGroups(filtered, undefined, treeSort).map((group) => {
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
              aria-label={title}
              aria-expanded={!isCollapsed}
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
          {!isCollapsed && <div className="ml-5">{renderTreeNotes(group.notes, title)}</div>}
        </div>
      );
    });
  };

  return (
    <aside className="w-full border-r border-border flex flex-col bg-background h-full shrink-0">
      <div className="p-4 pt-12 md:pt-4 flex items-center justify-between gap-2 bg-background z-10 shrink-0">
        {" "}
        <h2 className="min-w-0 truncate font-medium">{t("notes.title")}</h2>
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
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("notes.search")}
              className="w-full rounded-lg border border-border bg-muted/50 py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:bg-background"
            />
          </div>
          <SortSelect
            look="icon"
            value={activeSort}
            options={sortOptions}
            onChange={applySort}
            triggerLabel={t("notes.sortTrigger", { sort: activeSortLabel })}
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
        className={`flex min-h-0 flex-1 flex-col overflow-auto transition-all duration-200 ${isDraggingFile ? "ring-2 ring-inset ring-primary" : ""}`}
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
          <Virtualizer layout={ListLayout} layoutOptions={NOTE_LIST_LAYOUT}>
            <SectionDropIndicators>
              <GridList
                ref={gridRef}
                aria-label={t("notes.title")}
                data-focus-pane-entry=""
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
                className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
                dragAndDropHooks={dragAndDropHooks}
              >
                {listSections.map((section) => (
                  <GridListSection key={section.id} id={section.id}>
                    <GridListHeader>
                      <div
                        data-testid={`notes-section-${section.id}`}
                        data-drop-active={dropTarget?.sectionId === section.id ? "true" : undefined}
                        onDragOver={(e) => handleSectionDragOver(e, section.id)}
                        onDrop={(e) => handleSectionDrop(e, section.id)}
                        className={`min-h-11 rounded-md px-2 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors ${
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
          </Virtualizer>
        )}
      </div>

      {/* The footer always renders so the Command Palette entry point is
          reachable from the list; the pinned count shows only in list view
          with at least one pinned Note. */}
      <div className="p-3 border-t border-border text-xs text-muted-foreground bg-background shrink-0 flex items-center gap-2">
        <span className="flex-1 min-w-0">
          {viewMode === "list" && pinnedCount > 0
            ? t("notes.pinnedCount", { count: pinnedCount })
            : null}
        </span>
        <CommandPaletteButton size="sm" />
      </div>

      <DeleteNoteDialog
        note={pendingDeleteNote}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => void confirmDelete()}
        restoreFocusTarget={getDeleteRestoreTarget}
      />
    </aside>
  );
}
