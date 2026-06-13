import { useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  List,
  Search,
  Tags,
  TreePine,
} from "lucide-react";
import type { Book } from "../../features/books/types";
import { AddIcon } from "../icons/AddIcon";
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

function ToggleButton({
  isActive,
  onClick,
  children,
}: {
  isActive: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${isActive
        ? "bg-primary text-white"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
    >
      {children}
    </button>
  );
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

  const toggleGroup = (id: string) => {
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
        const isCollapsed = collapsedGroups.has(group.id);
        const title = group.id === "unfiled" ? t("notes.unfiled") : group.title;

        return (
          <div key={group.id} className="px-2 py-1">
            <div className="group flex items-center gap-1 rounded-md px-1 py-1.5 hover:bg-muted/50">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
              {group.book && (
                <button
                  type="button"
                  onClick={() => onCreateNote(group.book?.id ?? null)}
                  title={t("notes.addNoteToBook")}
                  aria-label={t("notes.addNoteToBook")}
                  className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                >
                  <AddIcon className="h-3.5 w-3.5" />
                </button>
              )}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
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
            <div className="flex items-center gap-1 rounded-md px-1 py-1.5 hover:bg-muted/50">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
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
          <div className="flex items-center gap-1 rounded-md px-1 py-1.5 hover:bg-muted/50">
            <button
              type="button"
              onClick={() => toggleGroup(group.id)}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
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
        <h3 className="font-medium">{t("notes.title")}</h3>
        <div className="flex rounded-lg bg-muted/60 p-0.5">
          <ToggleButton isActive={viewMode === "list"} onClick={() => setViewMode("list")}>
            <List className="h-3.5 w-3.5" />
            {t("notes.viewList")}
          </ToggleButton>
          <ToggleButton isActive={viewMode === "tree"} onClick={() => setViewMode("tree")}>
            <TreePine className="h-3.5 w-3.5" />
            {t("notes.viewTree")}
          </ToggleButton>
        </div>
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
            <div className="flex rounded-lg bg-muted/60 p-0.5">
              <ToggleButton
                isActive={treeGroupMode === "book"}
                onClick={() => setTreeGroupMode("book")}
              >
                <BookOpen className="h-3.5 w-3.5" />
                {t("notes.groupBook")}
              </ToggleButton>
              <ToggleButton
                isActive={treeGroupMode === "tag"}
                onClick={() => setTreeGroupMode("tag")}
              >
                <Tags className="h-3.5 w-3.5" />
                {t("notes.groupTag")}
              </ToggleButton>
              <ToggleButton
                isActive={treeGroupMode === "date"}
                onClick={() => setTreeGroupMode("date")}
              >
                <CalendarDays className="h-3.5 w-3.5" />
                {t("notes.groupDate")}
              </ToggleButton>
            </div>
          </div>
        )}
      </div>

      <div
        ref={listContainerRef}
        className={`flex-1 overflow-auto ${isDraggingFile ? "ring-2 ring-inset ring-primary" : ""}`}
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
