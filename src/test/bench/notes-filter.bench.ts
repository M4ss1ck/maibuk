// @vitest-environment node
// Periodic lane for the Note Filter (issue #650): filter plus sort over
// 5,000 Notes against its 2 ms p99 budget. Run `pnpm bench:notes-filter`;
// scripts/notes-filter-bench-budget.mjs fails the run when a budget is missed.
// Never part of `pnpm test`: the gate lane has no timing assertions.
import { bench, describe } from "vitest";
import { filterNotes, sortNotesBy } from "@/components/notes/notes-list-model";
import type { NotesSidebarSort } from "@/components/notes/notes-list-model";
import { NOTES_FILTER_BENCH_CASES, notesFilterBenchNotes } from "@/test/support/notes-filter-bench";

const notes = notesFilterBenchNotes();

describe("notes filter", () => {
  for (const c of NOTES_FILTER_BENCH_CASES) {
    for (const sort of ["custom", "date-desc", "title-asc"] as const) {
      bench(`filter+sort: ${c.name} / ${sort}`, () => {
        sortNotesBy(filterNotes(notes, c.criteria), sort as NotesSidebarSort);
      });
    }
  }
});
