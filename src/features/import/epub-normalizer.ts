import { strFromU8 } from "fflate";
import type { CreateBookInput } from "../books/types";
import type { BookMetadataInput, BookStyleInput, ChapterEpubMetaInput, EpubStructureInput } from "./epub-project-repo";
import type { ProjectAssetInput } from "./project-assets-repo";
import type { ParsedEpub, ParsedEpubNavItem, ParsedEpubResource, ParsedEpubSpineItem } from "./types";
import { normalizeXhtmlToEditorHtml } from "./xhtml-to-editor";

export interface NormalizedBookInput extends CreateBookInput {
  language?: string;
}

export interface NormalizedChapterInput extends Omit<ChapterEpubMetaInput, "chapterId" | "bookId"> {
  title: string;
  content: string;
}

export interface NormalizedEpubProject {
  bookInput: NormalizedBookInput;
  chapters: NormalizedChapterInput[];
  assets: ProjectAssetInput[];
  metadata: BookMetadataInput[];
  styles: BookStyleInput[];
  structure: Omit<EpubStructureInput, "id" | "compatibility">;
}

const CONTENT_MEDIA_TYPES = new Set(["application/xhtml+xml", "text/html"]);
const STYLE_MEDIA_TYPES = new Set(["text/css"]);
const ASSET_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "font/otf",
  "font/ttf",
  "font/woff",
  "font/woff2",
  "application/font-woff",
  "application/font-woff2",
  "application/vnd.ms-opentype",
]);

export function normalizeEpubProject(parsed: ParsedEpub): NormalizedEpubProject {
  const title = metadataValue(parsed, "title") ?? "Imported EPUB";
  const authorName = metadataValue(parsed, "creator") ?? "Unknown Author";
  const description = metadataValue(parsed, "description");
  const language = metadataValue(parsed, "language");
  const assets = buildAssets(parsed);
  const assetHrefMap = new Map(assets.map((asset) => [asset.href, asset.id ?? asset.href]));

  return {
    bookInput: {
      title,
      authorName,
      ...(description ? { description } : {}),
      ...(language ? { language } : {}),
    },
    chapters: buildChapters(parsed, assetHrefMap),
    assets,
    metadata: parsed.metadata.map((metadata) => ({
      namespace: metadata.namespace ?? null,
      key: metadata.key,
      value: metadata.value,
      attributes: metadata.attributes,
      order: metadata.order,
    })),
    styles: buildStyles(parsed),
    structure: {
      epubVersion: parsed.epubVersion ?? null,
      packagePath: parsed.packagePath,
      manifest: parsed.resources.map((resource) => ({
        id: resource.id,
        href: resource.href,
        absoluteHref: resource.absoluteHref,
        mediaType: resource.mediaType,
        properties: resource.properties,
      })),
      spine: parsed.spine,
      nav: parsed.nav,
    },
  };
}

function buildAssets(parsed: ParsedEpub): ProjectAssetInput[] {
  return parsed.resources.filter(isAssetResource).map((resource) => ({
    id: assetId(resource),
    filename: basename(resource.absoluteHref),
    href: resource.absoluteHref,
    mediaType: resource.mediaType,
    role: resource.properties.includes("cover-image") ? "cover" : null,
    dataBase64: toBase64(resource.data),
    sizeBytes: resource.data.byteLength,
  }));
}

function buildStyles(parsed: ParsedEpub): BookStyleInput[] {
  return parsed.resources.filter(isStyleResource).map((resource, index) => ({
    id: `style-${resource.id || index + 1}`,
    name: basename(resource.absoluteHref),
    css: resource.text ?? strFromU8(resource.data),
    sourceHref: resource.absoluteHref,
    isDefault: index === 0,
  }));
}

function buildChapters(
  parsed: ParsedEpub,
  assetHrefMap: Map<string, string>
): NormalizedChapterInput[] {
  const resourcesByHref = new Map(parsed.resources.map((resource) => [resource.href, resource]));
  const resourcesByAbsoluteHref = new Map(
    parsed.resources.map((resource) => [resource.absoluteHref, resource])
  );

  return parsed.spine.flatMap((spineItem, chapterIndex) => {
    if (!CONTENT_MEDIA_TYPES.has(spineItem.mediaType)) return [];

    const resource =
      resourcesByHref.get(spineItem.href) ??
      resourcesByAbsoluteHref.get(spineItem.href) ??
      parsed.resources.find((candidate) => candidate.href === spineItem.href);
    if (!resource) return [];

    const html = resource.text ?? strFromU8(resource.data);
    const normalized = normalizeXhtmlToEditorHtml({
      html,
      baseHref: resource.absoluteHref,
      assetHrefMap,
    });

    const navTitle = findNavTitle(parsed, spineItem);
    return [
      {
        title: navTitle ?? documentTitle(html) ?? `Chapter ${chapterIndex + 1}`,
        content: normalized.html,
        href: resource.absoluteHref,
        mediaType: resource.mediaType,
        navTitle: navTitle ?? null,
        spineIndex: spineItem.index,
        linear: spineItem.linear,
        capabilities: {
          images: normalized.referencedAssetIds.length > 0,
          issues: normalized.issues,
          references: normalized.references,
        },
      },
    ];
  });
}

function metadataValue(parsed: ParsedEpub, key: string): string | undefined {
  return parsed.metadata.find((metadata) => metadata.key === key)?.value;
}

function isStyleResource(resource: ParsedEpubResource): boolean {
  return STYLE_MEDIA_TYPES.has(resource.mediaType);
}

function isAssetResource(resource: ParsedEpubResource): boolean {
  return ASSET_MEDIA_TYPES.has(resource.mediaType);
}

function findNavTitle(parsed: ParsedEpub, spineItem: ParsedEpubSpineItem): string | null {
  const navItems = flattenNav(parsed.nav);
  const match = navItems.find(
    (item) =>
      item.href === spineItem.href ||
      item.href === basename(spineItem.href) ||
      spineItem.href.endsWith(item.href) ||
      item.href.endsWith(spineItem.href)
  );
  return match?.label ?? null;
}

function flattenNav(items: ParsedEpubNavItem[]): {
  href: string;
  label: string;
}[] {
  return items.flatMap((item) => [
    { href: item.href, label: item.label },
    ...flattenNav(item.children),
  ]);
}

function documentTitle(html: string): string | null {
  const document = new DOMParser().parseFromString(html, "text/html");
  const title = document.querySelector("title")?.textContent?.trim();
  return title || null;
}

function basename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

function assetId(resource: ParsedEpubResource): string {
  return `asset-${resource.id || basename(resource.absoluteHref).replace(/[^a-z0-9]+/gi, "-")}`;
}

function toBase64(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
