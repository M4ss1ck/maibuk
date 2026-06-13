import { useMemo, useRef, useState } from "react";
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
import type { Book } from "../../features/books/types";
import { AddIcon } from "../icons/AddIcon";
import { ResponsiveToggleGroup } from "../ui";
import type { ResponsiveToggleOption } from "../ui";
import { NoteListItem } from "./NoteListItem";
import { useMarkdownFileDrop } from "../../hooks/useMarkdownFileDrop";
import { tagColor } from "./tagColor";
import {
  buildBookNoteGroups,
  buildDateNoteGroups,
  buildListNoteSections,
  buildTagNoteGroups,
  filterNotes,
} from "./notes-list-model";
import type {
  NoteWithBook,
  NotesListViewMode,
  NotesTreeGroupMode,
} from "./notes-list-model";

interface NotesListProps {
  notes: NoteWithBook[];
  books?: Book[];
  currentNoteId: string | null;
  onSelectNote: (note: NoteWithBook) => void;
  onCreateNote: (bookId?: string | null) => void;
  onReorderNotes: (ids: string[]) => Promise<void>;
  onPinNote?: (note: NoteWithBook) => void;
  onDeleteNote?: (id: string) => void;
  onDuplicateNote?: (note: NoteWithBook) => void;
  onImportMarkdown?: (markdown: string, filenameStem: string) => void;
}

export function NotesList({
  notes,
  books = [],
  currentNoteId,
  onSelectNote,
  onCreateNote,
  onReorderNotes,
  onPinNote,
  onDeleteNote,
  onDuplicateNote,
  onImportMarkdown,
}: NotesListProps) {
  const { t } = useTranslation();
  const listContainerRef = useRef<HTMLDivElement>(null);
  const { isDraggingFile, dropHandlers } = useMarkdownFileDrop(
    listContainerRef,
    onImportMarkdown ?? (() => {}),
  );
  const [search, setSearch] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<NotesListViewMode>("list");
  const [treeGroupMode, setTreeGroupMode] = useState<NotesTreeGroupMode>("book");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedEmptyGroups, setExpandedEmptyGroups] = useState<Set<string>>(new Set());
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
    [t],
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
    [t],
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

  const handleDragOver = (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: DragEvent<HTMLLIElement>, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId || isSearchActive) return;

    const draggedIndex = notes.findIndex((n) => n.id === draggedId);
    const targetIndex = notes.findIndex((n) => n.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    const newOrder = [...notes];
    const [removed] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, removed);

    void onReorderNotes(newOrder.map((n) => n.id));
    setDraggedId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
  };

  const renderNote = (note: NoteWithBook) => (
    <NoteListItem
      key={note.id}
      note={note}
      isSelected={currentNoteId === note.id}
      onSelect={onSelectNote}
      onPinToggle={onPinNote}
      onDelete={onDeleteNote}
      onDuplicate={onDuplicateNote}
      draggable={viewMode === "list" && !isSearchActive ? true : undefined}
      onDragStart={(e) => handleDragStart(e, note.id)}
      onDragOver={handleDragOver}
      onDrop={(e) => handleDrop(e, note.id)}
      onDragEnd={handleDragEnd}
      isDragging={draggedId === note.id}
    />
  );

  const toggleGroup = (id: string, defaultCollapsed = false) => {
    if (defaultCollapsed) {
      setExpandedEmptyGroups((current) => {
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      return;
    }

    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const renderTreeGroups = () => {
    if (treeGroupMode === "book") {
      return buildBookNoteGroups(filtered, books).map((group) => {
        const defaultCollapsed = Boolean(group.book && group.notes.length === 0);
        const isCollapsed = defaultCollapsed
          ? !expandedEmptyGroups.has(group.id)
          : collapsedGroups.has(group.id);
        const title = group.id === "unfiled" ? t("notes.unfiled") : group.title;
        const GroupIcon = group.id === "unfiled" ? Feather : BookOpen;

        return (
          <div key={group.id} className="px-2 py-1">
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
                  <ul className="space-y-1">{group.notes.map(renderNote)}</ul>
                ) : (
                  <p className="px-2 py-2 text-xs text-muted-foreground">
                    {t("notes.noNotesYet")}
                  </p>
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
        const isCollapsed = collapsedGroups.has(group.id);
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
      const isCollapsed = collapsedGroups.has(group.id);
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
        {filtered.length === 0 && (viewMode !== "tree" || treeGroupMode !== "book" || books.length === 0) ? (
          <div className="text-center py-8 px-4 text-muted-foreground text-sm">
            <p>{t("notes.empty")}</p>
          </div>
        ) : viewMode === "tree" ? (
          <div className="pb-2">{renderTreeGroups()}</div>
        ) : (
          <div className="p-2">
            {listSections.map((section) => (
              <section key={section.id} className="mb-3 last:mb-0">
                <h4 className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {section.id === "pinned" ? t("notes.sectionPinned") : t("notes.sectionAll")}
                </h4>
                {section.notes.length > 0 && <ul className="space-y-1">{section.notes.map(renderNote)}</ul>}
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
