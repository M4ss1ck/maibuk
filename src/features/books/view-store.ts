import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_STATUS_FILTER } from "@/components/project/book-list-model";
import type { BookStatus } from "@/features/books/types";

// The projects page filter outlives its page: it is a stated preference, not a
// per-visit convenience, so it survives navigation and restarts.
interface BookViewState {
  statusFilter: BookStatus[];
  setStatusFilter: (statusFilter: BookStatus[]) => void;
}

export const useBookViewStore = create<BookViewState>()(
  persist(
    (set) => ({
      statusFilter: DEFAULT_STATUS_FILTER,
      setStatusFilter: (statusFilter) => set({ statusFilter }),
    }),
    { name: "maibuk-book-view" }
  )
);
