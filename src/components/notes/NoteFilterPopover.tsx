import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { SlidersHorizontal } from "lucide-react";
import type { useNoteFilter } from "@/hooks/useNoteFilter";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  NOTE_FILTER_ACTIVE_CLASS,
  NoteFilterCountBadge,
  NoteFilterFields,
} from "@/components/notes/NoteFilterFields";

const TRIGGER_CLASS =
  "relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-foreground pointer-coarse:h-11 pointer-coarse:w-11 transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2";

interface NoteFilterPopoverProps {
  filter: ReturnType<typeof useNoteFilter>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The sidebar's Filters button: the shared Note Filter in a Popover, with the
 * same active tint and count badge the Gallery shows on its own Filters button.
 */
export function NoteFilterPopover({ filter, isOpen, onOpenChange }: NoteFilterPopoverProps) {
  const { t } = useTranslation();
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Opening lands on the include-Tags combobox, ahead of the first chip's
  // remove control that React Aria would focus.
  useEffect(() => {
    if (isOpen) tagInputRef.current?.focus();
  }, [isOpen]);

  const label = filter.hasFilter
    ? t("notes.filtersActive", { count: filter.activeCount })
    : t("notes.advancedFilters");

  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      <Tooltip content={label}>
        <Button
          aria-label={label}
          className={`${TRIGGER_CLASS} ${filter.hasFilter ? NOTE_FILTER_ACTIVE_CLASS : ""}`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <NoteFilterCountBadge count={filter.activeCount} />
        </Button>
      </Tooltip>

      <Popover
        placement="bottom end"
        className="z-50 mt-1 max-h-[calc(100dvh-1rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border bg-background p-3 shadow-lg focus:outline-none"
      >
        <Dialog aria-label={t("notes.advancedFilters")} className="outline-none">
          <NoteFilterFields filter={filter} tagInputRef={tagInputRef} className="grid gap-3" />
          <div className="mt-3 border-t border-border pt-3">
            <Button
              isDisabled={!filter.hasFilter}
              onPress={() => {
                filter.clear();
                // The button disables itself once nothing is left to clear, so
                // focus moves to the first field rather than falling to <body>.
                tagInputRef.current?.focus();
              }}
              className="inline-flex w-full items-center justify-center rounded-lg bg-muted px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/80 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("notes.clearFilters")}
            </Button>
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
