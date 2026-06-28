import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { DEFAULT_CANVAS_DOC_JSON } from "../canvas/defaultDoc";

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
  bookId: text("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),

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

// Book versions table (point-in-time snapshots)
export const bookVersions = sqliteTable("book_versions", {
  id: text("id").primaryKey(),
  bookId: text("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  name: text("name"), // NULL = auto checkpoint, set = named milestone
  snapshot: text("snapshot").notNull(), // serializeBook() JSON, verbatim
  wordCount: integer("word_count").notNull().default(0),
  checksum: text("checksum").notNull(),
  triggerType: text("trigger_type").notNull().default("manual"),
  createdAt: integer("created_at").notNull(),
  syncedAt: integer("synced_at"),
});

// Project assets imported from EPUBs or created inside Maibuk.
export const projectAssets = sqliteTable("project_assets", {
  id: text("id").primaryKey(),
  bookId: text("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  href: text("href").notNull(),
  mediaType: text("media_type").notNull(),
  role: text("role"),
  dataBase64: text("data_base64"),
  textContent: text("text_content"),
  sizeBytes: integer("size_bytes"),
  checksum: text("checksum"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// Rich book metadata that does not fit the core books columns.
export const bookMetadata = sqliteTable("book_metadata", {
  id: text("id").primaryKey(),
  bookId: text("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  namespace: text("namespace"),
  key: text("key").notNull(),
  value: text("value").notNull(),
  attributesJson: text("attributes_json"),
  order: integer("order").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// Imported/custom book-level CSS profiles.
export const bookStyles = sqliteTable("book_styles", {
  id: text("id").primaryKey(),
  bookId: text("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  css: text("css").notNull(),
  sourceHref: text("source_href"),
  isDefault: integer("is_default", { mode: "boolean" }).default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// EPUB package/spine/nav model retained for project-aware import/export.
export const epubStructures = sqliteTable("epub_structures", {
  id: text("id").primaryKey(),
  bookId: text("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  epubVersion: text("epub_version"),
  packagePath: text("package_path").notNull(),
  manifestJson: text("manifest_json").notNull(),
  spineJson: text("spine_json").notNull(),
  navJson: text("nav_json"),
  compatibilityJson: text("compatibility_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// Mapping from Maibuk chapters back to EPUB spine items.
export const chapterEpubMeta = sqliteTable("chapter_epub_meta", {
  chapterId: text("chapter_id")
    .primaryKey()
    .references(() => chapters.id, { onDelete: "cascade" }),
  bookId: text("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  href: text("href").notNull(),
  mediaType: text("media_type").notNull(),
  navTitle: text("nav_title"),
  spineIndex: integer("spine_index").notNull(),
  linear: integer("linear", { mode: "boolean" }).default(true),
  capabilitiesJson: text("capabilities_json"),
});

// Notes table (separate Notes workspace, optionally associated with a book)
export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  bookId: text("book_id"),
  title: text("title").notNull(),
  content: text("content"), // Tiptap JSON string
  language: text("language").default("en"),
  tags: text("tags"), // JSON array of tag names
  pinned: integer("pinned", { mode: "boolean" }).default(false),
  order: integer("order").notNull(),
  wordCount: integer("word_count").default(0),
  collapsedHeadings: text("collapsed_headings").default("[]"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  contentUpdatedAt: integer("content_updated_at"),
});

export const canvases = sqliteTable("canvases", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  doc: text("doc").notNull().default(DEFAULT_CANVAS_DOC_JSON),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  order: integer("order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  contentUpdatedAt: integer("content_updated_at").notNull(),
});

// Link index: edges extracted from note/chapter content (powers backlinks).
export const links = sqliteTable("links", {
  id: text("id").primaryKey(),
  sourceType: text("source_type").notNull(), // 'note' | 'chapter'
  sourceId: text("source_id").notNull(),
  sourceBookId: text("source_book_id"),
  targetType: text("target_type").notNull(), // 'note' | 'book' | 'chapter' | 'heading'
  targetId: text("target_id").notNull(),
  targetHeadingId: text("target_heading_id"),
  label: text("label"),
  resolved: integer("resolved", { mode: "boolean" }).default(true),
  updatedAt: integer("updated_at").notNull(),
});

// Local deletion markers used by sync to prevent remote resurrection and to
// require explicit confirmation before destructive remote deletes.
export const syncTombstones = sqliteTable("sync_tombstones", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  title: text("title").notNull(),
  deletedAt: integer("deleted_at").notNull(),
  confirmedAt: integer("confirmed_at"),
  pushedAt: integer("pushed_at"),
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
export type NoteRow = typeof notes.$inferSelect;
export type NewNoteRow = typeof notes.$inferInsert;
export type CanvasRow = typeof canvases.$inferSelect;
export type NewCanvasRow = typeof canvases.$inferInsert;
export type SyncTombstoneRow = typeof syncTombstones.$inferSelect;
export type NewSyncTombstoneRow = typeof syncTombstones.$inferInsert;
export type CoverTemplate = typeof coverTemplates.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type BookVersionRow = typeof bookVersions.$inferSelect;
export type NewBookVersionRow = typeof bookVersions.$inferInsert;
export type ProjectAssetRow = typeof projectAssets.$inferSelect;
export type NewProjectAssetRow = typeof projectAssets.$inferInsert;
export type BookMetadataRow = typeof bookMetadata.$inferSelect;
export type NewBookMetadataRow = typeof bookMetadata.$inferInsert;
export type BookStyleRow = typeof bookStyles.$inferSelect;
export type NewBookStyleRow = typeof bookStyles.$inferInsert;
export type EpubStructureRow = typeof epubStructures.$inferSelect;
export type NewEpubStructureRow = typeof epubStructures.$inferInsert;
export type ChapterEpubMetaRow = typeof chapterEpubMeta.$inferSelect;
export type NewChapterEpubMetaRow = typeof chapterEpubMeta.$inferInsert;
export type LinkRow = typeof links.$inferSelect;
export type NewLinkRow = typeof links.$inferInsert;
