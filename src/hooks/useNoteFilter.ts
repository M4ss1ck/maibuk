import { useCallback, useMemo } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { countFilterCriteria } from "@/components/notes/notes-list-model";
import type { NoteWithBook } from "@/components/notes/notes-list-model";

/**
 * The Note Filter shared by the Notes Gallery and the Notes list (GLOSSARY.md):
 * the Tags a Note must have, the Tags it must not have, and the Last Edited
 * range, persisted per device. Search is not part of it: each place keeps its
 * own search text.
 */
export function useNoteFilter(notes: NoteWithBook[]) {
  const tags = useSettingsStore((s) => s.notesFilters.tags);
  const excludeTags = useSettingsStore((s) => s.notesFilters.excludeTags);
  const dateFrom = useSettingsStore((s) => s.notesFilters.dateFrom);
  const dateTo = useSettingsStore((s) => s.notesFilters.dateTo);
  const setNotesFilters = useSettingsStore((s) => s.setNotesFilters);

  const setTags = useCallback(
    (value: string[]) => setNotesFilters({ tags: value }),
    [setNotesFilters]
  );
  const setExcludeTags = useCallback(
    (value: string[]) => setNotesFilters({ excludeTags: value }),
    [setNotesFilters]
  );
  const setDateFrom = useCallback(
    (value: string) => setNotesFilters({ dateFrom: value }),
    [setNotesFilters]
  );
  const setDateTo = useCallback(
    (value: string) => setNotesFilters({ dateTo: value }),
    [setNotesFilters]
  );

  const tagOptions = useMemo(() => {
    const allTags = new Set<string>();
    for (const note of notes) {
      for (const rawTag of note.tags) {
        const tag = rawTag.trim();
        if (tag) allTags.add(tag);
      }
    }

    return [...allTags].sort((a, b) => a.localeCompare(b));
  }, [notes]);

  // A tag can only mean one thing at a time, so each list drops what the other
  // already claims rather than resolving a contradiction after the fact.
  const includeTagOptions = useMemo(
    () => tagOptions.filter((tag) => !excludeTags.includes(tag)),
    [tagOptions, excludeTags]
  );
  const excludeTagOptions = useMemo(
    () => tagOptions.filter((tag) => !tags.includes(tag)),
    [tagOptions, tags]
  );

  const activeCount = countFilterCriteria({ tags, excludeTags, dateFrom, dateTo });

  const clear = useCallback(
    () => setNotesFilters({ tags: [], excludeTags: [], dateFrom: "", dateTo: "" }),
    [setNotesFilters]
  );

  return {
    tags,
    excludeTags,
    dateFrom,
    dateTo,
    setTags,
    setExcludeTags,
    setDateFrom,
    setDateTo,
    tagOptions,
    includeTagOptions,
    excludeTagOptions,
    activeCount,
    hasFilter: activeCount > 0,
    clear,
  };
}
