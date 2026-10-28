import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  X,
} from "lucide-react";
import type { Book } from "@/features/books/types";
import type { ReorderNoteItem } from "@/features/notes";
import { AddIcon } from "@/components/icons/AddIcon";
import {
  Button,
  FileDropImportStatus,
  ResponsiveToggleGroup,
  SortSelect,
  Tooltip,
} from "@/components/ui";
import {
  SectionDropIndicators,
  SectionedDropTargetDelegate,
} from "@/components/ui/SectionedGridListDnd";
import { keepRowFromActing } from "@/lib/arrow-navigation";
import { toast } from "@/components/ui/Toast";
import type { ResponsiveToggleOption } from "@/components/ui";
import { DeleteNoteDialog } from "@/components/notes/DeleteNoteDialog";
import { NoteFilterPopover } from "@/components/notes/NoteFilterPopover";
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
import { useNoteFilter } from "@/hooks/useNoteFilter";
import { useSettingsStore } from "@/features/settings/store";
import { useShortcuts } from "@/lib/shortcuts";
import { revealVirtualRow } from "@/lib/reveal-virtual-row";
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

/** Estimated height of a Note row, used only to place a row the Virtualizer has not mounted. */
export const NOTE_ROW_ESTIMATE = 88;

/** Height of a section heading: a 12px top inset (`pt-3`) above the 32px label row. */
export const NOTE_HEADING_SIZE = 44;

/**
 * Bottom inset of the GridList (`pb-3`, 12px). The list layout's negative
 * padding takes this much off the top, so the GridList restores it at the bottom.
 */
export const NOTE_GRID_BOTTOM_INSET = 12;

/**
 * React Aria layout for the list view, sections included (#550). Rows are
 * variable height, so `estimatedRowSize` only places rows that are not mounted
 * yet; mounted rows are measured.
 *
 * ListLayout gives every heading the same box, so the first label's position
 * fixes `padding`: the label must sit 8px down as on main, so the padding is
 * -4px (8 - 12, the heading inset). Keep the GridList's
 * `pb-3` in step with NOTE_GRID_BOTTOM_INSET. `gap` stays 0 because it would
 * also space the rows.
 */
const NOTE_LIST_LAYOUT = {
  estimatedRowSize: NOTE_ROW_ESTIMATE,
  headingSize: NOTE_HEADING_SIZE,
  gap: 0,
  padding: -4,
} as const;

/** Height of a tree group's header row, before its rows are measured. */
export const NOTE_TREE_GROUP_HEADING = 40;

/** Space between a tree group's header and its rows, and between rows (`space-y-1`). */
export const NOTE_TREE_GAP = 4;

/**
 * React Aria layout for the tree view (#562), the same shape as the list
 * view: one virtualized GridList sectioned by group, so expanding a group
 * with 500 Notes mounts only the rows near the viewport.
 */
const NOTE_TREE_LAYOUT = {
  estimatedRowSize: NOTE_ROW_ESTIMATE,
  estimatedHeadingSize: NOTE_TREE_GROUP_HEADING,
  gap: NOTE_TREE_GAP,
  padding: 0,
} as const;

type DropPlacement = "before" | "after";

interface DropTarget {
  sectionId: NoteSection["id"];
  targetId: string | null;
  placement: DropPlacement;
}

/** One group of the tree view, whichever mode fills it. */
interface TreeGroup {
  id: string;
  title: string;
  notes: NoteWithBook[];
  book: Book | null;
  tag?: string;
  icon: "book" | "feather" | "tag" | "date";
  /** Book groups with no Notes start folded. */
  defaultCollapsed: boolean;
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
  // Both views are virtualized, and the GridList is what each Virtualizer scrolls.
  const gridRef = useRef<HTMLDivElement>(null);
  const newNoteButtonRef = useRef<HTMLButtonElement>(null);
  const activatedNoteIdsRef = useRef(new Set<string>());
  const [search, setSearch] = useState("");
  const [isFilterOpen, setFilterOpen] = useState(false);
  const filter = useNoteFilter(notes);
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
  // The scroll view both views virtualize: the GridList itself. Read at call
  // time, so a drag or a reorder follows the view that is shown.
  const scrollViewRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return gridRef.current;
      },
    }),
    []
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
  const { tags, excludeTags, dateFrom, dateTo } = filter;
  const filtered = useMemo(
    () => filterNotes(notes, { query, tags, excludeTags, dateFrom, dateTo }),
    [notes, query, tags, excludeTags, dateFrom, dateTo]
  );
  // Sections split the Notes already filtered, so the Library is walked once.
  const listSections = useMemo(
    () => buildListNoteSections(filtered, "", listSort),
    [filtered, listSort]
  );
  const listSectionsRef = useRef(listSections);
  listSectionsRef.current = listSections;
  // Rows glide to the place a Sort gives them; another view or search just redraws.
  // The glide runs on the Virtualizer's view wrapper, not the row: React Aria
  // re-measures that wrapper's scrollHeight, which counts a transformed row's
  // overflow. A row glided up by its own height measured 0px and was dropped
  // from the layout (e2e notes-sidebar-sort.spec.ts "a drag while sorted").
  useFlipReorder(
    scrollViewRef,
    viewMode === "list"
      ? listSections.flatMap((section) => section.notes.map((note) => note.id))
      : sortNotesBy(filtered, treeSort).map((note) => note.id),
    {
      skipKey: draggedId,
      scope: `${viewMode}:${treeGroupMode}:${query}`,
      target: (row) => row.parentElement ?? row,
    }
  );
  const pinnedCount = notes.filter((note) => note.pinned).length;
  const isFiltering = query.length > 0 || filter.hasFilter;
  // The list view reorders through React Aria drag-and-drop, which is also its
  // keyboard path. Search or a Note Filter hides Notes, so an order written
  // then would be partial.
  const canReorder = viewMode === "list" && !isFiltering && filtered.length > 0;
  const clearFilters = () => {
    filter.clear();
    setSearch("");
  };

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
    { id: "notes.advancedFilters", allowInInput: true, onTrigger: () => setFilterOpen(true) },
    { id: "notes.clearFilters", enabled: isFiltering, onTrigger: clearFilters },
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
    if (isFiltering) return;
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
    if (isFiltering) return;
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
            ? "mx-5 my-1 block h-0.5 rounded-full bg-primary shadow-[0_0_0_1px_var(--color-primary)]"
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
    if (isFiltering) return;

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
  // A tree row's key carries its group, so find the row by the Note it shows.
  const noteRowElement = (id: string): HTMLElement | null =>
    listContainerRef.current?.querySelector<HTMLElement>(
      `[role="row"][data-note-id="${CSS.escape(id)}"], [role="row"][data-key="${CSS.escape(id)}"]`
    ) ?? null;

  /** Note ids in the order they are shown: the list's sections, or the tree's rendered rows. */
  const shownNoteIds = (): string[] =>
    viewMode === "list"
      ? listSectionsRef.current.flatMap((section) => section.notes.map((note) => note.id))
      : [
          ...new Set(
            [
              ...(listContainerRef.current?.querySelectorAll<HTMLElement>("[data-note-id]") ?? []),
            ].map((row) => row.dataset.noteId ?? "")
          ),
        ];

  /** Where the Note at `id` sits by estimate, for a row the Virtualizer has not mounted. */
  const estimatedNoteTop = (id: string): number | null => {
    if (viewMode === "tree") {
      let top = 0;
      for (const group of treeGroupsRef.current) {
        top += NOTE_TREE_GROUP_HEADING + NOTE_TREE_GAP;
        if (isGroupCollapsed(group)) continue;
        for (const note of group.notes) {
          if (note.id === id) return top;
          top += NOTE_ROW_ESTIMATE + NOTE_TREE_GAP;
        }
      }
      return null;
    }
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

  // One reveal in flight at a time; a newer one, or unmount, cancels the pending frames.
  const revealCancelRef = useRef<(() => void) | null>(null);
  const focusFramesRef = useRef(new Set<number>());

  useEffect(() => {
    const frames = focusFramesRef.current;
    return () => {
      revealCancelRef.current?.();
      for (const frame of frames) cancelAnimationFrame(frame);
      frames.clear();
    };
  }, []);

  /** Runs `fn` on the next frame, unless unmount cancels it first. */
  const onNextFrame = (fn: () => void) => {
    const frame = requestAnimationFrame(() => {
      focusFramesRef.current.delete(frame);
      fn();
    });
    focusFramesRef.current.add(frame);
  };

  /**
   * Runs `onRow` on the row for `id` once it is mounted, scrolling a row the
   * Virtualizer has not mounted into place first. The order comes from the data,
   * not the DOM. A newer reveal supersedes this one.
   */
  const revealNoteRow = (id: string, onRow: (row: HTMLElement) => void): void => {
    revealCancelRef.current?.();
    revealCancelRef.current = revealVirtualRow({
      getScroll: () => gridRef.current,
      findRow: noteRowElement,
      estimatedTop: estimatedNoteTop,
      id,
      onRow,
    });
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
    if (neighborId) onNextFrame(() => revealNoteRow(neighborId, (row) => row.focus()));
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
      data-note-id={note.id}
      textValue={note.title || t("notes.untitled")}
      onAction={() => activateNote(note)}
      className={({ isFocusVisible }) =>
        `mx-3 rounded-md ${isFocusVisible ? "ring-2 ring-primary ring-offset-1" : ""}`
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

  // Namespace group keys by mode so identical ids across book/tag/date groups
  // (e.g. a tag named "today" and the "today" date bucket) don't share state.
  const groupKey = (id: string) => `${treeGroupMode}:${id}`;

  // A Note can sit in several tag groups, so a row's key carries its group.
  const treeNoteKey = (groupId: string, noteId: string) => `${groupKey(groupId)}:${noteId}`;

  const toggleGroup = (id: string, defaultCollapsed = false) => {
    const key = groupKey(id);
    if (defaultCollapsed) {
      toggleEmptyExpanded(key);
      return;
    }
    toggleCollapsed(key);
  };

  const isGroupCollapsed = (group: TreeGroup) =>
    group.defaultCollapsed
      ? !expandedEmptyGroups.has(groupKey(group.id))
      : collapsedGroups.has(groupKey(group.id));

  const treeGroups: TreeGroup[] =
    treeGroupMode === "book"
      ? buildBookNoteGroups(filtered, books, treeSort)
          // A Note Filter or search hides Notes, so a Book with none left
          // would only add a row of nothing to the tree.
          .filter((group) => !isFiltering || group.notes.length > 0)
          .map((group) => ({
            id: group.id,
            title: group.id === "unfiled" ? t("notes.unfiled") : group.title,
            notes: group.notes,
            book: group.book,
            icon: group.id === "unfiled" ? "feather" : "book",
            defaultCollapsed: Boolean(group.book && group.notes.length === 0),
          }))
      : treeGroupMode === "tag"
        ? buildTagNoteGroups(filtered, treeSort).map((group) => ({
            id: group.id,
            title: group.title,
            notes: group.notes,
            book: null,
            tag: group.tag,
            icon: "tag",
            defaultCollapsed: false,
          }))
        : buildDateNoteGroups(filtered, undefined, treeSort).map((group) => ({
            id: group.id,
            title:
              group.id === "today"
                ? t("notes.today")
                : group.id === "this-week"
                  ? t("notes.thisWeek")
                  : group.title,
            notes: group.notes,
            book: null,
            icon: "date",
            defaultCollapsed: false,
          }));

  const treeGroupsRef = useRef(treeGroups);
  treeGroupsRef.current = treeGroups;

  const treeSelectedKeys = currentNoteId
    ? treeGroups
        .filter((group) => group.notes.some((note) => note.id === currentNoteId))
        .map((group) => treeNoteKey(group.id, currentNoteId))
    : [];

  /** The Book group a native Note drag is over, from the section under the pointer. */
  const treeGroupIdAt = (target: EventTarget | null): string | null => {
    const element = target instanceof Element ? target.closest("[data-group-id]") : null;
    return element?.getAttribute("data-group-id") ?? null;
  };

  const handleTreeDragOver = (e: DragEvent<HTMLDivElement>) => {
    const groupId = treeGroupIdAt(e.target);
    if (groupId) handleGroupDragOver(e, groupId);
  };

  const handleTreeDrop = (e: DragEvent<HTMLDivElement>) => {
    const groupId = treeGroupIdAt(e.target);
    const group = treeGroupsRef.current.find((candidate) => candidate.id === groupId);
    if (group) handleGroupDrop(e, group.book?.id ?? null);
  };

  const renderTreeNote = (group: TreeGroup, note: NoteWithBook) => {
    const key = treeNoteKey(group.id, note.id);
    // The drag feedback tints the whole group, header and rows (#562), the
    // same as the unvirtualized group wrapper did.
    const isDropTarget = dragOverGroupId === group.id;
    return (
      <GridListItem
        key={key}
        id={key}
        data-note-id={note.id}
        textValue={note.title || t("notes.untitled")}
        onAction={() => activateNote(note)}
        className={({ isFocusVisible }) =>
          `ml-7 mr-2 rounded-md ${
            isDropTarget ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""
          } ${isFocusVisible ? "ring-2 ring-primary ring-offset-1" : ""}`
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
          draggable={treeGroupMode === "book" && !isFiltering ? true : undefined}
          onDragStart={(e) => handleDragStart(e, note.id)}
          onDragEnd={handleDragEnd}
          isDragging={draggedId === note.id}
        />
      </GridListItem>
    );
  };

  const renderTreeGroupHeader = (group: TreeGroup) => {
    const isCollapsed = isGroupCollapsed(group);
    const isBookGroup = group.icon === "book" || group.icon === "feather";
    const GroupIcon = group.icon === "feather" ? Feather : BookOpen;
    const isDropTarget = dragOverGroupId === group.id;

    return (
      <div
        className={`rounded-md px-2 py-1 transition-colors ${
          isDropTarget ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""
        }`}
      >
        <div className="group flex items-center gap-1 rounded-md px-1 py-1.5 hover:bg-muted/50 transition-colors duration-200">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggleGroup(group.id, group.defaultCollapsed);
            }}
            onKeyDown={keepRowFromActing}
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
          {group.icon === "tag" ? (
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: tagColor(group.tag ?? "") }}
            />
          ) : group.icon === "date" ? (
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <GroupIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span
            data-testid={isBookGroup ? `book-title-action-${group.id}` : undefined}
            className="flex min-w-0 items-center gap-1"
          >
            <span className="min-w-0 truncate text-sm font-medium">{group.title}</span>
            {group.book && (
              <Tooltip content={t("notes.addNoteToBook")}>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCreateNote(group.book?.id ?? null);
                  }}
                  onKeyDown={keepRowFromActing}
                  aria-label={t("notes.addNoteToBook")}
                  className="shrink-0 rounded p-0.5 pointer-coarse:p-1.5 text-muted-foreground opacity-0 transition-all duration-200 hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                >
                  <AddIcon className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            )}
          </span>
          <span
            data-testid={isBookGroup ? `book-count-${group.id}` : undefined}
            className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {group.notes.length}
          </span>
        </div>
        {!isCollapsed && group.notes.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">{t("notes.noNotesYet")}</p>
        )}
      </div>
    );
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
          <NoteFilterPopover filter={filter} isOpen={isFilterOpen} onOpenChange={setFilterOpen} />
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
        {notes.length > 0 && isFiltering && filtered.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-8 text-center text-sm">
            <div className="mb-3 rounded-full bg-muted p-3 text-muted-foreground">
              <Search className="h-5 w-5" />
            </div>
            <p className="font-semibold">{t("notes.noMatches")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("notes.noMatchesDescription")}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={clearFilters}
              className="mt-3"
            >
              <X className="h-4 w-4" />
              {t("notes.clearFilters")}
            </Button>
          </div>
        ) : filtered.length === 0 &&
          (viewMode !== "tree" || treeGroupMode !== "book" || books.length === 0) ? (
          <div className="text-center py-8 px-4 text-muted-foreground text-sm">
            <p>{t("notes.empty")}</p>
          </div>
        ) : viewMode === "tree" ? (
          // Native Note drops target the Book group under the pointer. The
          // wrapper, not the GridList, carries them: React Aria's props filter
          // its DOM events, and the file-drop handlers stay on the outer box.
          <div
            className="flex min-h-0 flex-1 flex-col"
            onDragOver={handleTreeDragOver}
            onDragLeave={handleGroupDragLeave}
            onDrop={handleTreeDrop}
          >
            <Virtualizer layout={ListLayout} layoutOptions={NOTE_TREE_LAYOUT}>
              <GridList
                ref={gridRef}
                aria-label={t("notes.title")}
                data-focus-pane-entry=""
                dependencies={[
                  currentNoteId,
                  draggedId,
                  dragOverGroupId,
                  treeGroupMode,
                  isFiltering,
                  onDeleteNote,
                  onDuplicateNote,
                  onRenameNote,
                  books,
                ]}
                selectedKeys={treeSelectedKeys}
                selectionMode="single"
                selectionBehavior="replace"
                // Selection is the current Note's highlight, controlled by the
                // route, not a user toggle: a click or Space on it must not
                // clear it, the same as the list view.
                disallowEmptySelection
                className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2"
              >
                {treeGroups.map((group) => (
                  <GridListSection
                    key={group.id}
                    id={group.id}
                    data-group-id={group.id}
                    data-testid={`book-group-${group.id}`}
                  >
                    <GridListItem
                      key={`${groupKey(group.id)}:header`}
                      id={`${groupKey(group.id)}:header`}
                      data-group-header={group.id}
                      textValue={group.title}
                      aria-expanded={!isGroupCollapsed(group)}
                      onAction={() => toggleGroup(group.id, group.defaultCollapsed)}
                      className={({ isFocusVisible }) =>
                        `rounded-md ${isFocusVisible ? "ring-2 ring-primary ring-offset-1" : ""}`
                      }
                    >
                      {renderTreeGroupHeader(group)}
                    </GridListItem>
                    {!isGroupCollapsed(group) && (
                      <Collection items={group.notes}>
                        {(note) => renderTreeNote(group, note)}
                      </Collection>
                    )}
                  </GridListSection>
                ))}
              </GridList>
            </Virtualizer>
          </div>
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
                className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-3"
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
                        className={`mx-3 min-h-11 rounded-md px-2 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors ${
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
