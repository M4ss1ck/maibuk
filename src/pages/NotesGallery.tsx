import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  Tags,
  X,
} from "lucide-react";
import { useNoteStore } from "@/features/notes";
import { useBookStore } from "@/features/books/store";
import { useSettingsStore } from "@/features/settings/store";
import { NoteCard } from "@/components/notes";
import { NotesSortMenu } from "@/components/notes/NotesSortMenu";
import { filterNotes, sortNotesBy } from "@/components/notes/notes-list-model";
import { Button } from "@/components/ui/Button";
import { MultiSelectCombobox } from "@/components/ui/MultiSelectCombobox";
import { Tooltip } from "@/components/ui/Tooltip";
import { AddIcon, MaibukLogo } from "@/components/icons";
import { useShortcuts } from "@/lib/shortcuts";

export function NotesGallery() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const notes = useNoteStore((s) => s.notes);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const createNote = useNoteStore((s) => s.createNote);
  const books = useBookStore((s) => s.books);
  const loadBooks = useBookStore((s) => s.loadBooks);
  const setLastNoteId = useSettingsStore((s) => s.setLastNoteId);
  const sort = useSettingsStore((s) => s.notesSort);
  const setSort = useSettingsStore((s) => s.setNotesSort);
  const [search, setSearch] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tagFilterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadNotes();
    void loadBooks();
  }, [loadNotes, loadBooks]);

  const bookTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const book of books) map.set(book.id, book.title);
    return map;
  }, [books]);

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const note of notes) {
      for (const rawTag of note.tags) {
        const tag = rawTag.trim();
        if (tag) tags.add(tag);
      }
    }

    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [notes]);

  const filteredNotes = useMemo(
    () =>
      sortNotesBy(
        filterNotes(notes, {
          query: search,
          tags: tagFilters,
          dateFrom,
          dateTo,
        }),
        sort
      ),
    [notes, search, tagFilters, dateFrom, dateTo, sort]
  );

  const hasFilters = Boolean(search.trim() || tagFilters.length > 0 || dateFrom || dateTo);

  const openNote = (id: string) => {
    setLastNoteId(id);
    navigate(`/notes/${id}`);
  };

  const handleCreateNote = async () => {
    const note = await createNote({ title: "", bookId: null });
    openNote(note.id);
  };

  const clearFilters = () => {
    setSearch("");
    setTagFilters([]);
    setDateFrom("");
    setDateTo("");
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
        keys: ["ctrl+f", "meta+f"],
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
        keys: ["ctrl+shift+f", "meta+shift+f"],
        allowInInput: true,
        onTrigger: openAdvancedFilters,
      },
    ],
    { enabled: notes.length > 0 }
  );

  return (
    <div className="p-4 sm:p-8 overflow-auto h-full">
      <div className="mb-6 flex flex-col gap-4 sm:mb-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("notes.title")}</h2>
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
          <div className="flex items-center gap-2 sm:ml-auto">
            {notes.length > 0 && <NotesSortMenu value={sort} onChange={setSort} />}
            <Button onClick={handleCreateNote} className="text-sm">
              <AddIcon className="w-5 h-5" />
              <span>{t("notes.newNote")}</span>
            </Button>
          </div>
        </div>

        {notes.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row">
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
                  onClick={() => setShowAdvanced((current) => !current)}
                  aria-expanded={showAdvanced}
                  className="h-11 flex-1 border border-border sm:flex-none"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  <span>{t("notes.advancedFilters")}</span>
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
              <div className="mt-3 grid gap-3 border-t border-border pt-3 md:grid-cols-[minmax(180px,1fr)_minmax(150px,0.7fr)_minmax(150px,0.7fr)]">
                <div className="min-w-0">
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Tags className="h-3.5 w-3.5" />
                    {t("notes.tagFilter")}
                  </span>
                  <MultiSelectCombobox
                    ref={tagFilterInputRef}
                    value={tagFilters}
                    onChange={setTagFilters}
                    options={tagOptions}
                    placeholder={t("notes.anyTag")}
                    removeLabel={(tag) => t("notes.removeTag", { tag })}
                  />
                </div>

                <div>
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {t("notes.dateFrom")}
                  </span>
                  <DateFilter
                    value={dateFrom}
                    onChange={setDateFrom}
                    label={t("notes.dateFrom")}
                    language={i18n.language}
                    clearLabel={t("notes.clearDate")}
                    previousMonthLabel={t("notes.previousMonth")}
                    nextMonthLabel={t("notes.nextMonth")}
                  />
                </div>

                <div>
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {t("notes.dateTo")}
                  </span>
                  <DateFilter
                    value={dateTo}
                    onChange={setDateTo}
                    label={t("notes.dateTo")}
                    language={i18n.language}
                    clearLabel={t("notes.clearDate")}
                    previousMonthLabel={t("notes.previousMonth")}
                    nextMonthLabel={t("notes.nextMonth")}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 sm:py-28 text-center">
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
        <div className="flex flex-col items-center justify-center py-16 text-center">
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
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              bookTitle={note.bookId ? bookTitleById.get(note.bookId) : null}
              onClick={() => openNote(note.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DateFilterProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  language: string;
  clearLabel: string;
  previousMonthLabel: string;
  nextMonthLabel: string;
}

function DateFilter({
  value,
  onChange,
  label,
  language,
  clearLabel,
  previousMonthLabel,
  nextMonthLabel,
}: DateFilterProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const selectedDate = parseLocalDate(value);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(selectedDate ?? new Date()));

  useEffect(() => {
    if (isOpen) {
      setVisibleMonth(startOfMonth(selectedDate ?? new Date()));
    }
  }, [isOpen, selectedDate?.getTime()]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  const formattedValue = selectedDate
    ? new Intl.DateTimeFormat(language, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(selectedDate)
    : "";
  const monthLabel = new Intl.DateTimeFormat(language, {
    month: "long",
    year: "numeric",
  }).format(visibleMonth);

  const days = buildCalendarDays(visibleMonth);
  const weekLabels = buildWeekLabels(language);

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") setIsOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-label={label}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-background px-3 text-left text-sm text-foreground outline-none transition-colors hover:border-primary/60 focus:border-primary focus:ring-2 focus:ring-primary/20"
      >
        <span className="min-w-0 flex-1 truncate">{formattedValue}</span>
        <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-background p-3 shadow-lg">
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setVisibleMonth(addMonths(visibleMonth, -1))}
              aria-label={previousMonthLabel}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-sm font-medium">{monthLabel}</div>
            <button
              type="button"
              onClick={() => setVisibleMonth(addMonths(visibleMonth, 1))}
              aria-label={nextMonthLabel}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {weekLabels.map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {days.map((day, index) =>
              day ? (
                <button
                  key={dateToValue(day)}
                  type="button"
                  onClick={() => {
                    onChange(dateToValue(day));
                    setIsOpen(false);
                  }}
                  className={`h-8 rounded-md text-sm transition-colors ${
                    value === dateToValue(day)
                      ? "bg-primary text-white"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  {day.getDate()}
                </button>
              ) : (
                <div key={`empty-${index}`} />
              )
            )}
          </div>

          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setIsOpen(false);
              }}
              className="mt-3 w-full rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {clearLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function parseLocalDate(value: string): Date | null {
  if (!value) return null;
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function buildCalendarDays(month: Date): Array<Date | null> {
  const firstDay = startOfMonth(month);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  return Array.from({ length: totalCells }, (_, index) => {
    const day = index - startOffset + 1;
    return day > 0 && day <= daysInMonth
      ? new Date(month.getFullYear(), month.getMonth(), day)
      : null;
  });
}

function buildWeekLabels(language: string): string[] {
  const monday = new Date(2026, 5, 1);
  const formatter = new Intl.DateTimeFormat(language, { weekday: "short" });
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return formatter.format(date).slice(0, 2);
  });
}

function dateToValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
