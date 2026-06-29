/**
 * Shared test fixtures for Maibuk tests.
 * Provides factory functions to build common domain objects.
 */
import type { Book } from "@/features/books/types";
import type { Chapter } from "@/features/chapters/types";

let counter = 0;

function nextId(): string {
  counter++;
  return `test-id-${counter}`;
}

/**
 * Reset the fixture counter between tests if needed.
 */
export function resetFixtures(): void {
  counter = 0;
}

/**
 * Build a Book object with sensible defaults.
 * Override any field via the `overrides` parameter.
 */
export function buildBook(overrides: Partial<Book> = {}): Book {
  const now = new Date();
  return {
    id: nextId(),
    title: "Test Book",
    authorName: "Test Author",
    language: "en",
    wordCount: 0,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Build a Chapter object with sensible defaults.
 */
export function buildChapter(overrides: Partial<Chapter> = {}): Chapter {
  const now = new Date();
  return {
    id: nextId(),
    bookId: "book-1",
    title: "Test Chapter",
    content: "<p>Some content</p>",
    order: 1,
    chapterType: "chapter",
    wordCount: 2,
    status: "draft",
    isIncludedInExport: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
