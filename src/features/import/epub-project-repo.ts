import { getDatabase } from "../../lib/db";
import type { CompatibilityReport, ParsedEpubNavItem } from "./types";

export interface BookMetadataInput {
  id?: string;
  namespace?: string | null;
  key: string;
  value: string;
  attributes?: Record<string, string>;
  order: number;
}

export interface BookMetadata {
  id: string;
  bookId: string;
  namespace: string | null;
  key: string;
  value: string;
  attributes: Record<string, string>;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BookStyleInput {
  id?: string;
  name: string;
  css: string;
  sourceHref?: string | null;
  isDefault?: boolean;
}

export interface BookStyle {
  id: string;
  bookId: string;
  name: string;
  css: string;
  sourceHref: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EpubStructureInput {
  id?: string;
  epubVersion?: string | null;
  packagePath: string;
  manifest: unknown[];
  spine: unknown[];
  nav?: ParsedEpubNavItem[] | null;
  compatibility: CompatibilityReport;
}

export interface EpubStructure {
  id: string;
  bookId: string;
  epubVersion: string | null;
  packagePath: string;
  manifest: unknown[];
  spine: unknown[];
  nav: ParsedEpubNavItem[] | null;
  compatibility: CompatibilityReport;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChapterEpubMetaInput {
  chapterId: string;
  bookId: string;
  href: string;
  mediaType: string;
  navTitle?: string | null;
  spineIndex: number;
  linear: boolean;
  capabilities?: Record<string, unknown> | null;
}

export interface ChapterEpubMeta extends ChapterEpubMetaInput {
  navTitle: string | null;
  capabilities: Record<string, unknown> | null;
}

interface BookMetadataRow {
  id: string;
  book_id: string;
  namespace: string | null;
  key: string;
  value: string;
  attributes_json: string | null;
  order: number;
  created_at: number;
  updated_at: number;
}

interface BookStyleRow {
  id: string;
  book_id: string;
  name: string;
  css: string;
  source_href: string | null;
  is_default: number | boolean | null;
  created_at: number;
  updated_at: number;
}

interface EpubStructureRow {
  id: string;
  book_id: string;
  epub_version: string | null;
  package_path: string;
  manifest_json: string;
  spine_json: string;
  nav_json: string | null;
  compatibility_json: string;
  created_at: number;
  updated_at: number;
}

interface ChapterEpubMetaRow {
  chapter_id: string;
  book_id: string;
  href: string;
  media_type: string;
  nav_title: string | null;
  spine_index: number;
  linear: number | boolean | null;
  capabilities_json: string | null;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function generateId(): string {
  return crypto.randomUUID();
}

export async function insertBookMetadata(
  bookId: string,
  metadata: BookMetadataInput[]
): Promise<void> {
  if (metadata.length === 0) return;

  const db = await getDatabase();
  const now = nowSeconds();
  for (const entry of metadata) {
    await db.execute(
      `INSERT INTO book_metadata
        (id, book_id, namespace, key, value, attributes_json, "order", created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id ?? generateId(),
        bookId,
        entry.namespace ?? null,
        entry.key,
        entry.value,
        JSON.stringify(entry.attributes ?? {}),
        entry.order,
        now,
        now,
      ]
    );
  }
}

export async function listBookMetadata(bookId: string): Promise<BookMetadata[]> {
  const db = await getDatabase();
  const rows = await db.select<BookMetadataRow[]>(
    `SELECT id, book_id, namespace, key, value, attributes_json, "order", created_at, updated_at
     FROM book_metadata
     WHERE book_id = ?
     ORDER BY "order" ASC, id ASC`,
    [bookId]
  );
  return rows.map((row) => ({
    id: row.id,
    bookId: row.book_id,
    namespace: row.namespace,
    key: row.key,
    value: row.value,
    attributes: JSON.parse(row.attributes_json ?? "{}"),
    order: row.order,
    createdAt: new Date(row.created_at * 1000),
    updatedAt: new Date(row.updated_at * 1000),
  }));
}

export async function insertBookStyles(bookId: string, styles: BookStyleInput[]): Promise<void> {
  if (styles.length === 0) return;

  const db = await getDatabase();
  const now = nowSeconds();
  for (const style of styles) {
    await db.execute(
      `INSERT INTO book_styles
        (id, book_id, name, css, source_href, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        style.id ?? generateId(),
        bookId,
        style.name,
        style.css,
        style.sourceHref ?? null,
        style.isDefault ? 1 : 0,
        now,
        now,
      ]
    );
  }
}

export async function listBookStyles(bookId: string): Promise<BookStyle[]> {
  const db = await getDatabase();
  const rows = await db.select<BookStyleRow[]>(
    `SELECT id, book_id, name, css, source_href, is_default, created_at, updated_at
     FROM book_styles
     WHERE book_id = ?
     ORDER BY is_default DESC, name ASC, id ASC`,
    [bookId]
  );
  return rows.map((row) => ({
    id: row.id,
    bookId: row.book_id,
    name: row.name,
    css: row.css,
    sourceHref: row.source_href,
    isDefault: Boolean(row.is_default),
    createdAt: new Date(row.created_at * 1000),
    updatedAt: new Date(row.updated_at * 1000),
  }));
}

export async function insertEpubStructure(
  bookId: string,
  structure: EpubStructureInput
): Promise<void> {
  const db = await getDatabase();
  const now = nowSeconds();
  await db.execute(
    `INSERT INTO epub_structures
      (id, book_id, epub_version, package_path, manifest_json, spine_json, nav_json, compatibility_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      structure.id ?? generateId(),
      bookId,
      structure.epubVersion ?? null,
      structure.packagePath,
      JSON.stringify(structure.manifest),
      JSON.stringify(structure.spine),
      structure.nav ? JSON.stringify(structure.nav) : null,
      JSON.stringify(structure.compatibility),
      now,
      now,
    ]
  );
}

export async function getEpubStructure(bookId: string): Promise<EpubStructure | null> {
  const db = await getDatabase();
  const rows = await db.select<EpubStructureRow[]>(
    `SELECT id, book_id, epub_version, package_path, manifest_json, spine_json, nav_json, compatibility_json, created_at, updated_at
     FROM epub_structures
     WHERE book_id = ?
     ORDER BY updated_at DESC, id ASC
     LIMIT 1`,
    [bookId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    bookId: row.book_id,
    epubVersion: row.epub_version,
    packagePath: row.package_path,
    manifest: JSON.parse(row.manifest_json),
    spine: JSON.parse(row.spine_json),
    nav: row.nav_json ? JSON.parse(row.nav_json) : null,
    compatibility: JSON.parse(row.compatibility_json),
    createdAt: new Date(row.created_at * 1000),
    updatedAt: new Date(row.updated_at * 1000),
  };
}

export async function insertChapterEpubMeta(rows: ChapterEpubMetaInput[]): Promise<void> {
  if (rows.length === 0) return;

  const db = await getDatabase();
  for (const row of rows) {
    await db.execute(
      `INSERT INTO chapter_epub_meta
        (chapter_id, book_id, href, media_type, nav_title, spine_index, linear, capabilities_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.chapterId,
        row.bookId,
        row.href,
        row.mediaType,
        row.navTitle ?? null,
        row.spineIndex,
        row.linear ? 1 : 0,
        row.capabilities ? JSON.stringify(row.capabilities) : null,
      ]
    );
  }
}

export async function listChapterEpubMeta(bookId: string): Promise<ChapterEpubMeta[]> {
  const db = await getDatabase();
  const rows = await db.select<ChapterEpubMetaRow[]>(
    `SELECT chapter_id, book_id, href, media_type, nav_title, spine_index, linear, capabilities_json
     FROM chapter_epub_meta
     WHERE book_id = ?
     ORDER BY spine_index ASC, chapter_id ASC`,
    [bookId]
  );
  return rows.map((row) => ({
    chapterId: row.chapter_id,
    bookId: row.book_id,
    href: row.href,
    mediaType: row.media_type,
    navTitle: row.nav_title,
    spineIndex: row.spine_index,
    linear: Boolean(row.linear),
    capabilities: row.capabilities_json ? JSON.parse(row.capabilities_json) : null,
  }));
}
