import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GridList } from "react-aria-components/GridList";
import { GridLayout, Size, Virtualizer } from "react-aria-components";
import { BookOpen, Copy, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useNoteStore } from "@/features/notes";
import type { Note } from "@/features/notes";
import { useBookStore } from "@/features/books/store";
import { useSettingsStore } from "@/features/settings/store";
import { normalizeLanguage } from "@/features/settings/types";
import { NoteCard } from "@/components/notes";
import { DeleteNoteDialog } from "@/components/notes/DeleteNoteDialog";
import {
  NOTE_FILTER_ACTIVE_CLASS,
  NoteFilterCountBadge,
  NoteFilterFields,
} from "@/components/notes/NoteFilterFields";
import {
  duplicateNoteInput,
  filterNotes,
  NOTES_SORT_COMMANDS,
  notesSortOptions,
  sortNotesBy,
} from "@/components/notes/notes-list-model";
import type { ItemAction } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { SortSelect } from "@/components/ui/SortSelect";
import { Tooltip } from "@/components/ui/Tooltip";
import { FileDropImportStatus } from "@/components/ui/FileDropImportStatus";
import { AddIcon, MaibukLogo } from "@/components/icons";
import { LibraryLoadError } from "@/components/LibraryLoadError";
import { useShortcuts } from "@/lib/shortcuts";
import { useSearchSwitchesStore } from "@/features/search/switches";
import { droppedTextToEditorHtml } from "@/features/markdown";
import { useNoteFilter } from "@/hooks/useNoteFilter";
import { useTextFileDrop } from "@/hooks/useTextFileDrop";
import type { DroppedTextFile } from "@/hooks/useTextFileDrop";
import { usePluginItemMenuActions } from "@/hooks/usePluginItemMenuActions";

/** The card's height (`h-44`), used only until the Virtualizer measures it. */
export const GALLERY_CARD_ESTIMATE = 176;

/** `gap-4` between cards, both ways. */
export const GALLERY_GAP = 16;

/**
 * The Gallery's container-query breakpoints: `@3xl` is 48rem and `@5xl` is
 * 64rem, the widths at which the CSS grid used to add a column. GridLayout
 * cannot express "at least two columns", so the caller caps its columns here.
 */
export const GALLERY_THREE_COLUMNS_MIN = 768;
export const GALLERY_FOUR_COLUMNS_MIN = 1024;

export function galleryColumnsForWidth(width: number): 2 | 3 | 4 {
  if (width >= GALLERY_FOUR_COLUMNS_MIN) return 4;
  if (width >= GALLERY_THREE_COLUMNS_MIN) return 3;
  return 2;
}

/** `maxColumns` for the GridLayout, read from the content box it lays out in. */
function useGalleryColumns(areaRef: RefObject<HTMLElement | null>, refreshKey: number) {
  const [columns, setColumns] = useState<2 | 3 | 4>(2);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const measure = () => setColumns(galleryColumnsForWidth(area.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [areaRef, refreshKey]);

  return columns;
}

export function NotesGallery() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const notes = useNoteStore((s) => s.notes);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const notesError = useNoteStore((s) => s.error);
  const buildPluginNoteActions = usePluginItemMenuActions("note");
  const createNote = useNoteStore((s) => s.createNote);
  const updateNote = useNoteStore((s) => s.updateNote);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const lastNoteId = useSettingsStore((s) => s.lastNoteId);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const books = useBookStore((s) => s.books);
  const loadBooks = useBookStore((s) => s.loadBooks);
  const setLastNoteId = useSettingsStore((s) => s.setLastNoteId);
  const sort = useSettingsStore((s) => s.notesSort);
  const setSort = useSettingsStore((s) => s.setNotesSort);
  const sortOptions = useMemo(() => notesSortOptions(t, { custom: false }), [t]);
  const currentSortLabel = (sortOptions.find((option) => option.value === sort) ?? sortOptions[0])
    .label;
  const notesFilters = useSettingsStore((s) => s.notesFilters);
  const setNotesFilters = useSettingsStore((s) => s.setNotesFilters);
  const { search, showAdvanced } = notesFilters;
  const filter = useNoteFilter(notes);
  const setSearch = useCallback(
    (value: string) => setNotesFilters({ search: value }),
    [setNotesFilters]
  );
  const setShowAdvanced = useCallback(
    (value: boolean) => setNotesFilters({ showAdvanced: value }),
    [setNotesFilters]
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tagFilterInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // The grid's content box: what the container queries measured before, and
  // what decides how many columns the virtualized GridLayout may draw.
  const gridAreaRef = useRef<HTMLDivElement>(null);
  const newNoteButtonRef = useRef<HTMLButtonElement>(null);
  const galleryDropRef = useRef<HTMLDivElement>(null);
  const activatedNoteIdsRef = useRef(new Set<string>());
  // The row a Note Item Menu's Delete was confirmed from, and the row that
  // should take focus once it is gone (next, else previous, else the create
  // control). Captured before the store removes the Note.
  const deleteFocusRef = useRef<{ row: HTMLElement | null; neighbor: HTMLElement | null }>({
    row: null,
    neighbor: null,
  });

  const handleImportFiles = async (files: DroppedTextFile[]) => {
    const minOrder = notes.reduce((min, note) => Math.min(min, note.order), 0);
    for (const [index, file] of files.entries()) {
      await createNote({
        title: file.stem.trim() || "Untitled",
        bookId: null,
        content: droppedTextToEditorHtml(file.text, file.extension),
        order: minOrder - files.length + index,
      });
    }
  };

  const { isDraggingFile, isImportingFiles, dropHandlers } = useTextFileDrop(galleryDropRef, {
    onImport: handleImportFiles,
  });

  useEffect(() => {
    void loadNotes();
    void loadBooks();
  }, [loadNotes, loadBooks]);

  const bookTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const book of books) map.set(book.id, book.title);
    return map;
  }, [books]);

  const filteredNotes = useMemo(
    () =>
      sortNotesBy(
        filterNotes(notes, {
          query: search,
          tags: filter.tags,
          excludeTags: filter.excludeTags,
          dateFrom: filter.dateFrom,
          dateTo: filter.dateTo,
        }),
        sort
      ),
    [notes, search, filter.tags, filter.excludeTags, filter.dateFrom, filter.dateTo, sort]
  );

  const hasFilters = Boolean(search.trim() || filter.hasFilter);

  // The measured width only matters once the grid is on screen; re-measuring
  // as the result set changes catches the empty state giving way to cards.
  const galleryColumns = useGalleryColumns(gridAreaRef, filteredNotes.length);
  const galleryLayoutOptions = useMemo(
    () => ({
      minItemSize: new Size(1, GALLERY_CARD_ESTIMATE),
      minSpace: new Size(GALLERY_GAP, GALLERY_GAP),
      maxColumns: galleryColumns,
    }),
    [galleryColumns]
  );

  const openNote = useCallback(
    (id: string) => {
      if (activatedNoteIdsRef.current.has(id)) return;
      activatedNoteIdsRef.current.add(id);
      queueMicrotask(() => activatedNoteIdsRef.current.delete(id));
      setLastNoteId(id);
      navigate(`/notes/${id}`);
    },
    [navigate, setLastNoteId]
  );

  // The gallery is where phones browse notes, so each card carries an Item Menu.
  const noteActions = (note: Note): ItemAction[] => [
    ...(books.length > 0
      ? [
          {
            id: "move",
            label: t("notes.moveToBook"),
            icon: BookOpen,
            children: [
              { id: null as string | null, label: t("notes.unfiled"), language: undefined },
              ...books.map((book) => ({ id: book.id, label: book.title, language: book.language })),
              // command-exempt: submenu value (which Book a Note is filed in)
            ].map((target) => ({
              id: `move:${target.id ?? "unfiled"}`,
              label: target.label,
              isCurrent: (note.bookId ?? null) === target.id,
              onAction: () => {
                if ((note.bookId ?? null) === target.id) return;
                void updateNote({
                  id: note.id,
                  bookId: target.id,
                  language: normalizeLanguage(target.language),
                });
              },
            })),
          },
        ]
      : []),
    {
      id: "duplicate",
      label: t("notes.duplicate"),
      icon: Copy,
      commandId: "noteItem.duplicate",
      onAction: () => void createNote(duplicateNoteInput(note)),
    },
    {
      id: "delete",
      label: t("common.delete"),
      icon: Trash2,
      isDestructive: true,
      commandId: "noteItem.delete",
      onAction: () => requestDelete(note.id),
    },
    ...buildPluginNoteActions({ kind: "note", id: note.id }),
  ];

  const pendingDeleteNote = notes.find((note) => note.id === pendingDeleteId) ?? null;

  /** Remembers the row a delete started from and its neighbour before it goes. */
  const requestDelete = (noteId: string) => {
    const rows = [...(gridRef.current?.querySelectorAll<HTMLElement>("[data-key]") ?? [])];
    const index = rows.findIndex((row) => row.dataset.key === noteId);
    deleteFocusRef.current = {
      row: index === -1 ? null : rows[index],
      neighbor: index === -1 ? null : (rows[index + 1] ?? rows[index - 1] ?? null),
    };
    setPendingDeleteId(noteId);
  };

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
    // Delete first: the dialog closes when the Note leaves the store, so focus
    // restoration already sees the row gone.
    await deleteNote(id);
    setPendingDeleteId(null);
    if (lastNoteId === id) setLastNoteId(null);
  };

  const handleCreateNote = async () => {
    const note = await createNote({ title: "", bookId: null });
    openNote(note.id);
  };

  const clearFilters = () => {
    setNotesFilters({ search: "" });
    filter.clear();
  };

  const openAdvancedFilters = useCallback(() => {
    setShowAdvanced(true);
    window.setTimeout(() => {
      tagFilterInputRef.current?.focus();
    }, 0);
  }, []);

  const focusSearch = useCallback(() => {
    const searchInput = searchInputRef.current;
    if (!searchInput) return;
    searchInput.focus();
    searchInput.select();
  }, []);

  useShortcuts(
    [
      {
        id: "common.find",
        allowInInput: true,
        onTrigger: () => {
          if (document.activeElement === searchInputRef.current) {
            openAdvancedFilters();
            return;
          }

          focusSearch();
        },
      },
      {
        id: "notes.advancedFilters",
        allowInInput: true,
        onTrigger: openAdvancedFilters,
      },
      // The shared search switches: the Gallery keeps its own search, but the
      // switches flip the same device state Library Search reads.
      {
        id: "common.matchCase",
        onTrigger: () => useSearchSwitchesStore.getState().toggleMatchCase(),
      },
      {
        id: "common.wholeWord",
        onTrigger: () => useSearchSwitchesStore.getState().toggleWholeWord(),
      },
      {
        id: "common.useRegex",
        onTrigger: () => useSearchSwitchesStore.getState().toggleRegex(),
      },
      {
        id: "notes.newNote",
        onTrigger: () => void handleCreateNote(),
      },
      {
        id: "notes.clearFilters",
        enabled: hasFilters,
        onTrigger: clearFilters,
      },
      // The Sort Commands act on the Gallery's own Sort; it has no Custom, so
      // that Command stays unbound (unavailable) here.
      ...NOTES_SORT_COMMANDS.flatMap(({ id, sort: commandSort }) =>
        commandSort === "custom" ? [] : [{ id, onTrigger: () => setSort(commandSort) }]
      ),
    ],
    { enabled: notes.length > 0 }
  );

  // Stable per-card props: the virtualized grid re-renders its mounted rows on
  // each arrow move, and a memoized card skips the work when these hold.
  const cardOpen = useMemo(
    () => new Map(filteredNotes.map((note) => [note.id, () => openNote(note.id)])),
    [filteredNotes, openNote]
  );
  const cardActions = useMemo(
    () => new Map(filteredNotes.map((note) => [note.id, noteActions(note)])),
    [filteredNotes, books, t, updateNote, createNote, buildPluginNoteActions]
  );

  // The header can be taller than a phone viewport with the advanced filters
  // open, so the column scrolls rather than clipping them; the grid keeps a
  // minimum height and scrolls its own cards (#562).
  return (
    <div
      ref={galleryDropRef}
      {...dropHandlers}
      className={`@container flex h-full flex-col overflow-y-auto p-4 sm:p-8 transition-all duration-200 ${isDraggingFile ? "ring-2 ring-inset ring-primary" : ""}`}
    >
      {isImportingFiles && <FileDropImportStatus />}
      <div className="mb-6 grid shrink-0 gap-4 @xl:mb-8 @xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="row-start-1">
          <h1 data-route-heading className="text-xl font-semibold tracking-tight @xl:text-2xl">
            {t("notes.title")}
          </h1>
          {notes.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {hasFilters
                ? t("notes.matchingCount", {
                    count: filteredNotes.length,
                    total: notes.length,
                  })
                : t("notes.noteCount", { count: notes.length })}
            </p>
          )}
        </div>

        {notes.length > 0 && (
          <div className="@container row-start-3 rounded-lg border border-border bg-card p-3 shadow-sm @xl:col-span-2 @xl:row-start-2">
            <div className="flex gap-3">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("notes.search")}
                  className="h-11 w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={showAdvanced ? "secondary" : "ghost"}
                  data-tutorial="notes.filters"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  aria-expanded={showAdvanced}
                  aria-label={
                    filter.hasFilter
                      ? t("notes.filtersActive", { count: filter.activeCount })
                      : t("notes.advancedFilters")
                  }
                  className={`relative h-11 shrink-0 border border-border ${
                    filter.hasFilter ? NOTE_FILTER_ACTIVE_CLASS : ""
                  }`}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  {/* Narrow panels keep the icon beside the search box; the
                      aria-label carries the name the hidden text gives up. */}
                  <span className="hidden @sm:inline">{t("notes.advancedFilters")}</span>
                  <NoteFilterCountBadge count={filter.activeCount} />
                </Button>
                {hasFilters && (
                  <Tooltip content={t("notes.clearFilters")}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={clearFilters}
                      className="h-11 border border-border px-3"
                      aria-label={t("notes.clearFilters")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </Tooltip>
                )}
              </div>
            </div>

            {showAdvanced && (
              <NoteFilterFields
                filter={filter}
                tagInputRef={tagFilterInputRef}
                className="mt-3 grid gap-3 border-t border-border pt-3 @md:grid-cols-2 @3xl:grid-cols-[minmax(200px,1.2fr)_minmax(200px,1.2fr)_minmax(150px,0.8fr)_minmax(150px,0.8fr)]"
              />
            )}
          </div>
        )}

        <div className="row-start-2 flex items-center gap-2 @xl:col-start-2 @xl:row-start-1 @xl:ml-auto">
          {notes.length > 0 && (
            <SortSelect
              look="labeled"
              value={sort}
              options={sortOptions}
              onChange={setSort}
              triggerLabel={t("notes.sortTrigger", { sort: currentSortLabel })}
            />
          )}
          <Button
            ref={newNoteButtonRef}
            onClick={handleCreateNote}
            className="text-sm"
            data-tutorial="notes.new"
          >
            <AddIcon className="w-5 h-5" />
            <span>{t("notes.newNote")}</span>
          </Button>
        </div>
      </div>

      {notes.length === 0 && notesError ? (
        <LibraryLoadError error={notesError} onRetry={() => void loadNotes()} />
      ) : notes.length === 0 ? (
        <div className="flex min-h-64 flex-1 flex-col items-center justify-center overflow-auto py-20 sm:py-28 text-center">
          <div className="w-20 h-20 mb-8">
            <MaibukLogo className="w-full h-full text-primary opacity-70" />
          </div>
          <h3 className="text-2xl sm:text-3xl font-semibold mb-3 tracking-tight">
            {t("notes.empty")}
          </h3>
          <Button size="lg" onClick={handleCreateNote}>
            <AddIcon className="w-5 h-5" />
            {t("notes.newNote")}
          </Button>
        </div>
      ) : filteredNotes.length === 0 ? (
        <div className="flex min-h-64 flex-1 flex-col items-center justify-center overflow-auto py-16 text-center">
          <div className="mb-5 rounded-full bg-muted p-4 text-muted-foreground">
            <Search className="h-8 w-8" />
          </div>
          <h3 className="text-xl font-semibold tracking-tight">{t("notes.noMatches")}</h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            {t("notes.noMatchesDescription")}
          </p>
          <Button type="button" variant="secondary" onClick={clearFilters} className="mt-5">
            <X className="h-4 w-4" />
            {t("notes.clearFilters")}
          </Button>
        </div>
      ) : (
        // One GridList owns the scroll, so the Virtualizer mounts the cards
        // near the viewport instead of every Note in the Library (#562).
        <div ref={gridAreaRef} className="min-h-64 flex-1">
          <Virtualizer layout={GridLayout} layoutOptions={galleryLayoutOptions}>
            <GridList
              ref={gridRef}
              data-tutorial="notes.gallery"
              aria-label={t("notes.collectionLabel")}
              data-focus-pane-entry=""
              items={filteredNotes}
              layout="grid"
              selectionMode="none"
              onAction={(key) => openNote(String(key))}
              className="h-full overflow-auto"
            >
              {(note) => (
                <NoteCard
                  note={note}
                  tutorialAnchor={note.id === filteredNotes[0]?.id ? "notes.card" : undefined}
                  bookTitle={note.bookId ? bookTitleById.get(note.bookId) : null}
                  onClick={cardOpen.get(note.id) ?? (() => openNote(note.id))}
                  actions={cardActions.get(note.id)}
                />
              )}
            </GridList>
          </Virtualizer>
        </div>
      )}

      <DeleteNoteDialog
        note={pendingDeleteNote}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => void confirmDelete()}
        restoreFocusTarget={getDeleteRestoreTarget}
      />
    </div>
  );
}
