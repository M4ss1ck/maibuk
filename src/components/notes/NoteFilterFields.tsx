import { useEffect, useRef, useState } from "react";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronLeft, ChevronRight, EyeOff, Info, Tags } from "lucide-react";
import type { useNoteFilter } from "@/hooks/useNoteFilter";
import { MultiSelectCombobox } from "@/components/ui/MultiSelectCombobox";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * The tint both Filters buttons take while the Note Filter is not empty. It is
 * important (`!`) because it overrides the Button variant's own background,
 * border, and text colors, which no class order would settle.
 */
export const NOTE_FILTER_ACTIVE_CLASS = "border-primary/40! bg-primary/10! text-primary!";

/**
 * The field labels are uppercase: caps have no descenders, so their ink sits
 * above the middle of the line box that `items-center` centers the icons on,
 * by up to 1.6px in the mono and serif App Fonts. Trimming the text box to the
 * cap height centers the icons on the letters for any font; a browser without
 * `text-box` keeps the line-box centering.
 */
const LABEL_TEXT_CLASS = "[text-box:trim-both_cap_alphabetic]";

/** How many criteria the Note Filter has, pinned to its trigger's top-right corner. */
export function NoteFilterCountBadge({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
    >
      {count}
    </span>
  );
}

interface NoteFilterFieldsProps {
  filter: ReturnType<typeof useNoteFilter>;
  className?: string;
  tagInputRef?: Ref<HTMLInputElement>;
}

/**
 * The Note Filter's four labeled fields: the Tags a Note must have, the Tags
 * it must not have, and the Last Edited range. The parent owns the layout
 * through `className`, so the Gallery panel and the sidebar Popover show the
 * same controls.
 */
export function NoteFilterFields({ filter, className, tagInputRef }: NoteFilterFieldsProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className={className}>
      <div className="min-w-0">
        <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Tags className="h-3.5 w-3.5" />
          <span className={LABEL_TEXT_CLASS}>{t("notes.tagFilter")}</span>
          <FilterHelp label={t("notes.tagFilterHelp")} />
        </span>
        <MultiSelectCombobox
          ref={tagInputRef}
          value={filter.tags}
          onChange={filter.setTags}
          options={filter.includeTagOptions}
          placeholder={t("notes.anyTag")}
          removeLabel={(tag) => t("notes.removeTag", { tag })}
        />
      </div>

      <div className="min-w-0">
        <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <EyeOff className="h-3.5 w-3.5" />
          <span className={LABEL_TEXT_CLASS}>{t("notes.excludeTagFilter")}</span>
          <FilterHelp label={t("notes.excludeTagFilterHelp")} />
        </span>
        <MultiSelectCombobox
          value={filter.excludeTags}
          onChange={filter.setExcludeTags}
          options={filter.excludeTagOptions}
          placeholder={t("notes.noExcludedTags")}
          removeLabel={(tag) => t("notes.removeExcludedTag", { tag })}
        />
      </div>

      <div>
        <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          <span className={LABEL_TEXT_CLASS}>{t("notes.dateFrom")}</span>
        </span>
        <DateFilter
          value={filter.dateFrom}
          onChange={filter.setDateFrom}
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
          <span className={LABEL_TEXT_CLASS}>{t("notes.dateTo")}</span>
        </span>
        <DateFilter
          value={filter.dateTo}
          onChange={filter.setDateTo}
          label={t("notes.dateTo")}
          language={i18n.language}
          clearLabel={t("notes.clearDate")}
          previousMonthLabel={t("notes.previousMonth")}
          nextMonthLabel={t("notes.nextMonth")}
        />
      </div>
    </div>
  );
}

/**
 * The tag filters read alike but behave differently — one requires every tag,
 * the other rejects any. The label carries the explanation so it reaches
 * screen readers and keyboard users, not just hover.
 */
function FilterHelp({ label }: { label: string }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
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
        // The calendar nests inside a Popover in the sidebar: Escape here
        // closes only the calendar, so the Popover stays open.
        if (event.key !== "Escape" || !isOpen) return;
        event.stopPropagation();
        setIsOpen(false);
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
        <div className="absolute left-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-background p-3 shadow-lg">
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
                      ? "bg-primary text-primary-foreground"
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
