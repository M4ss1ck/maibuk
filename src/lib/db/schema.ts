import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Books table
export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  authorName: text("author_name").notNull(),
  description: text("description"),
  genre: text("genre"),
  language: text("language").default("en"),

  // Cover data
  coverImagePath: text("cover_image_path"),
  coverData: text("cover_data"), // Fabric.js JSON for cover design

  // Statistics
  wordCount: integer("word_count").default(0),
  targetWordCount: integer("target_word_count"),

  // Status: draft, in-progress, completed
  status: text("status").default("draft"),

  // Timestamps (stored as Unix timestamps)
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  lastOpenedAt: integer("last_opened_at"),
});

// Chapters table
export const chapters = sqliteTable("chapters", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),

  title: text("title").notNull(),
  content: text("content"), // Tiptap JSON string
  synopsis: text("synopsis"),

  // Ordering and structure
  order: integer("order").notNull(),
  parentId: text("parent_id"),
  // chapter, prologue, epilogue, part, frontmatter, backmatter
  chapterType: text("chapter_type").default("chapter"),

  // Statistics
  wordCount: integer("word_count").default(0),

  // Status: draft, revised, final
  status: text("status").default("draft"),
  isIncludedInExport: integer("is_included_in_export", { mode: "boolean" }).default(true),

  // Timestamps
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// Cover templates table
export const coverTemplates = sqliteTable("cover_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  fabricJson: text("fabric_json").notNull(),
  thumbnailPath: text("thumbnail_path"),
  isBuiltIn: integer("is_built_in", { mode: "boolean" }).default(false),
  createdAt: integer("created_at").notNull(),
});

// Settings table (key-value store)
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// TypeScript types derived from schema
export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;
export type Chapter = typeof chapters.$inferSelect;
export type NewChapter = typeof chapters.$inferInsert;
export type CoverTemplate = typeof coverTemplates.$inferSelect;
export type Setting = typeof settings.$inferSelect;
