import { Fragment, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { useTranslation } from "react-i18next";
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
import { ResponsiveToggleGroup } from "@/components/ui";
import type { ResponsiveToggleOption } from "@/components/ui";
import { NoteListItem } from "@/components/notes/NoteListItem";
import { useMarkdownFileDrop } from "@/hooks/useMarkdownFileDrop";
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
  onDeleteNote?: (id: string) => void;
  onDuplicateNote?: (note: NoteWithBook) => void;
  onRenameNote?: (id: string, title: string) => void;
  onImportMarkdown?: (markdown: string, filenameStem: string) => void;
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
  onImportMarkdown,
}: NotesListProps) {
  const { t } = useTranslation();
  const listContainerRef = useRef<HTMLDivElement>(null);
  const { isDraggingFile, dropHandlers } = useMarkdownFileDrop(
    listContainerRef,
    onImportMarkdown ?? (() => {})
  );
  const autoScroll = useDragAutoScroll(listContainerRef);
  const [search, setSearch] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
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
  const pinnedCount = notes.filter((note) => note.pinned).length;
  const isSearchActive = query.length > 0;

  const handleDragStart = (e: DragEvent<HTMLLIElement>, id: string) => {
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

  const handleSectionDragOver = (e: DragEvent<HTMLElement>, sectionId: NoteSection["id"]) => {
    handleDragOver(e);
    if (!draggedId || isSearchActive) return;
    setDropTarget({ sectionId, targetId: null, placement: "after" });
  };

  const handleNoteDragOver = (e: DragEvent<HTMLLIElement>, note: NoteWithBook) => {
    e.stopPropagation();
    handleDragOver(e);
    if (!draggedId || draggedId === note.id || isSearchActive) return;

    const sectionId = listSections.find((section) =>
      section.notes.some((sectionNote) => sectionNote.id === note.id)
    )?.id;
    if (!sectionId) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const placement: DropPlacement = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setDropTarget({ sectionId, targetId: note.id, placement });
  };

  const handleDrop = (e: DragEvent<HTMLLIElement>, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    autoScroll.stop();
    if (!draggedId || draggedId === targetId || isSearchActive) return;

    const draggedNote = notes.find((note) => note.id === draggedId);
    if (!draggedNote) return;

    const targetSectionId = listSections.find((section) =>
      section.notes.some((note) => note.id === targetId)
    )?.id;
    if (!targetSectionId) return;

    const nextSections = listSections.map((section) => ({
      ...section,
      notes: section.notes.filter((note) => note.id !== draggedId),
    }));
    const targetSection = nextSections.find((section) => section.id === targetSectionId);
    if (!targetSection) return;

    const targetIndex = targetSection.notes.findIndex((note) => note.id === targetId);
    if (targetIndex === -1) return;

    const insertIndex =
      dropTarget?.targetId === targetId && dropTarget.placement === "after"
        ? targetIndex + 1
        : targetIndex;
    targetSection.notes.splice(insertIndex, 0, draggedNote);
    emitSectionOrder(nextSections);
    setDraggedId(null);
    setDropTarget(null);
  };

  const emitSectionOrder = (sections: NoteSection[]) => {
    void onReorderNotes(
      sections.flatMap((section) =>
        section.notes.map((note) => ({
          id: note.id,
          pinned: section.id === "pinned",
        }))
      )
    );
  };

  const handleSectionDrop = (e: DragEvent<HTMLElement>, targetSectionId: NoteSection["id"]) => {
    e.preventDefault();
    e.stopPropagation();
    autoScroll.stop();
    if (!draggedId || isSearchActive) return;

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
    <Fragment key={note.id}>
      {renderDropIndicator(note, "before")}
      <NoteListItem
        note={note}
        isSelected={currentNoteId === note.id}
        onSelect={onSelectNote}
        onDelete={onDeleteNote}
        onDuplicate={onDuplicateNote}
        onRename={(targetNote, title) => onRenameNote?.(targetNote.id, title)}
        draggable={viewMode === "list" && !isSearchActive ? true : undefined}
        onDragStart={(e) => handleDragStart(e, note.id)}
        onDragOver={(e) => handleNoteDragOver(e, note)}
        onDrop={(e) => handleDrop(e, note.id)}
        onDragEnd={handleDragEnd}
        isDragging={draggedId === note.id}
      />
      {renderDropIndicator(note, "after")}
    </Fragment>
  );

  const renderTreeNote = (note: NoteWithBook) => (
    <NoteListItem
      key={note.id}
      note={note}
      isSelected={currentNoteId === note.id}
      onSelect={onSelectNote}
      onDelete={onDeleteNote}
      onDuplicate={onDuplicateNote}
      onRename={(targetNote, title) => onRenameNote?.(targetNote.id, title)}
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
                  <button
                    type="button"
                    onClick={() => onCreateNote(group.book?.id ?? null)}
                    title={t("notes.addNoteToBook")}
                    aria-label={t("notes.addNoteToBook")}
                    className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-all duration-200 hover:bg-muted hover:text-foreground group-hover:opacity-100"
                  >
                    <AddIcon className="h-3.5 w-3.5" />
                  </button>
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
                  <ul className="space-y-1">{group.notes.map(renderTreeNote)}</ul>
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
            {!isCollapsed && <ul className="ml-5 space-y-1">{group.notes.map(renderNote)}</ul>}
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
          {!isCollapsed && <ul className="ml-5 space-y-1">{group.notes.map(renderNote)}</ul>}
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
        />
        <button
          type="button"
          onClick={() => onCreateNote(null)}
          aria-label={t("notes.newNote")}
          className="p-1 hover:bg-muted rounded transition-colors"
          title={t("notes.newNote")}
        >
          <AddIcon className="w-5 h-5" />
        </button>
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
        {...(onImportMarkdown ? dropHandlers : {})}
      >
        {filtered.length === 0 &&
        (viewMode !== "tree" || treeGroupMode !== "book" || books.length === 0) ? (
          <div className="text-center py-8 px-4 text-muted-foreground text-sm">
            <p>{t("notes.empty")}</p>
          </div>
        ) : viewMode === "tree" ? (
          <div className="pb-2">{renderTreeGroups()}</div>
        ) : (
          <div className="p-2">
            {listSections.map((section) => (
              <section
                key={section.id}
                data-testid={`notes-section-${section.id}`}
                data-drop-active={dropTarget?.sectionId === section.id ? "true" : undefined}
                onDragOver={(e) => handleSectionDragOver(e, section.id)}
                onDrop={(e) => handleSectionDrop(e, section.id)}
                className={`mb-3 min-h-8 rounded-md transition-colors last:mb-0 ${
                  dropTarget?.sectionId === section.id
                    ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
                    : ""
                }`}
              >
                <h4 className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {section.id === "pinned" ? t("notes.sectionPinned") : t("notes.sectionAll")}
                </h4>
                {section.notes.length > 0 && (
                  <ul className="space-y-1">{section.notes.map(renderNote)}</ul>
                )}
                {renderSectionAppendIndicator(section.id)}
              </section>
            ))}
          </div>
        )}
      </div>

      {notes.length > 0 && (
        <div className="p-3 border-t border-border text-xs text-muted-foreground bg-background shrink-0">
          {t("notes.pinnedCount", { count: pinnedCount })}
        </div>
      )}
    </aside>
  );
}
