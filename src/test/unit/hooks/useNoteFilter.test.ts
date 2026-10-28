import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_NOTES_FILTERS,
  type NoteWithBook,
  type NotesFilters,
} from "@/components/notes/notes-list-model";
import { useSettingsStore } from "@/features/settings/store";
import { useNoteFilter } from "@/hooks/useNoteFilter";

function note(id: string, tags: string[]): NoteWithBook {
  return {
    id,
    title: id,
    content: "",
    language: "en",
    tags,
    pinned: false,
    order: 0,
    wordCount: 0,
    collapsedHeadings: [],
    createdAt: 1,
    updatedAt: 1,
    contentUpdatedAt: 1,
  };
}

const notes = [
  note("a", [" draft ", "Craft"]),
  note("b", ["revision", "  "]),
  note("c", ["Archive"]),
];

function setFilters(filters: Partial<NotesFilters>) {
  act(() => useSettingsStore.setState({ notesFilters: { ...DEFAULT_NOTES_FILTERS, ...filters } }));
}

describe("useNoteFilter()", () => {
  beforeEach(() => {
    useSettingsStore.setState({ notesFilters: DEFAULT_NOTES_FILTERS });
  });

  it("reads the criteria from the persisted Note Filter", () => {
    setFilters({ tags: ["craft"], excludeTags: ["archive"], dateFrom: "2026-06-01" });

    const { result } = renderHook(() => useNoteFilter(notes));

    expect(result.current.tags).toEqual(["craft"]);
    expect(result.current.excludeTags).toEqual(["archive"]);
    expect(result.current.dateFrom).toBe("2026-06-01");
    expect(result.current.dateTo).toBe("");
  });

  it("lists each Tag once, trimmed and sorted, and each list drops the other's picks", () => {
    setFilters({ tags: ["Craft"], excludeTags: ["draft"] });

    const { result } = renderHook(() => useNoteFilter(notes));

    expect(result.current.tagOptions).toEqual(["Archive", "Craft", "draft", "revision"]);
    expect(result.current.includeTagOptions).toEqual(["Archive", "Craft", "revision"]);
    expect(result.current.excludeTagOptions).toEqual(["Archive", "draft", "revision"]);
  });

  it("counts each Tag and each date as one active criterion", () => {
    const { result } = renderHook(() => useNoteFilter(notes));
    expect(result.current.activeCount).toBe(0);
    expect(result.current.hasFilter).toBe(false);

    setFilters({ tags: ["craft"], excludeTags: ["archive"], dateFrom: "2026-06-01" });

    expect(result.current.activeCount).toBe(3);
    expect(result.current.hasFilter).toBe(true);

    setFilters({ dateTo: "2026-06-30" });

    expect(result.current.activeCount).toBe(1);
  });

  it("persists each setter into the Note Filter without touching the other settings", () => {
    const { result } = renderHook(() => useNoteFilter(notes));

    act(() => result.current.setTags(["craft"]));
    act(() => result.current.setExcludeTags(["archive"]));
    act(() => result.current.setDateFrom("2026-06-01"));
    act(() => result.current.setDateTo("2026-06-30"));

    expect(useSettingsStore.getState().notesFilters).toEqual({
      search: "",
      tags: ["craft"],
      excludeTags: ["archive"],
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
      showAdvanced: false,
    });
  });

  it("clears the Note Filter and leaves search and the open panel alone", () => {
    setFilters({ search: "moon", showAdvanced: true, tags: ["craft"], dateFrom: "2026-06-01" });

    const { result } = renderHook(() => useNoteFilter(notes));

    act(() => result.current.clear());

    expect(useSettingsStore.getState().notesFilters).toEqual({
      search: "moon",
      tags: [],
      excludeTags: [],
      dateFrom: "",
      dateTo: "",
      showAdvanced: true,
    });
    expect(result.current.activeCount).toBe(0);
    expect(result.current.hasFilter).toBe(false);
  });
});
