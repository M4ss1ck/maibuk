import { BOOK_STATUSES, type Book, type BookStatus } from "@/features/books/types";

// Archived is deliberately absent: hiding it by default is what makes
// archiving declutter the projects page.
export const DEFAULT_STATUS_FILTER: BookStatus[] = ["draft", "in-progress", "completed"];

export function filterBooksByStatus(books: Book[], selected: BookStatus[]): Book[] {
  const allowed = new Set(selected);
  return books.filter((book) => allowed.has(book.status));
}

export function countBooksByStatus(books: Book[]): Record<BookStatus, number> {
  const counts = Object.fromEntries(BOOK_STATUSES.map((status) => [status, 0])) as Record<
    BookStatus,
    number
  >;

  for (const book of books) {
    counts[book.status]++;
  }

  return counts;
}
