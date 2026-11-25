/**
 * The Reader Frame's Comic engine (#941): a CBZ as a Document of one image per
 * page, the `blob:` URL for each page, the neighbours prefetched before the
 * author turns to them, and the page cache that keeps a handful alive.
 *
 * The engine owns the page list and the cache the Frame used to keep at module
 * level, so `load()` fills them, `clearCache()` revokes every URL and empties
 * the cache where closing a Document did, and `reset()` drops the page list at
 * the same point in that close. `entry.ts` supplies the archive, the media-type
 * lookup, the containers the page draws into, the view guards (`destroyed`,
 * the view generation, the current page, the zoom), and the callbacks the draw
 * ends with, so the engine knows nothing about the other views.
 *
 * Like the rest of `frame/`, this is inlined into one classic script; it may
 * import only Frame-local modules.
 */

import { DocumentError, IMAGE_EXTENSIONS } from "./archive";
import type { FrameZoom, FrameZipEntry } from "./types";

/** A CBZ as a minimal Document: one section per image, in reading order. */
export interface ComicDocument {
  metadata: { title: string };
  sections: Array<{ id: string }>;
  toc: Array<{ label: string; href: string }>;
  resolveHref(href: string): { index: number };
  rendition: { layout: "pre-paginated" };
  destroy(): void;
}

/** The DOM a comic page draws into, as far as the engine touches it. */
interface ComicContainer {
  textContent: string | null;
  hidden: boolean;
  readonly clientWidth: number;
  readonly clientHeight: number;
  style: { width: string; height: string };
  append(node: Node): void;
}

/** The archive, view state, and callbacks `entry.ts` gives the engine. */
export interface FrameComicDeps {
  /** The open archive: its entry table and one entry's inflated bytes. */
  archive: {
    entries(): FrameZipEntry[];
    bytes(name: string): Promise<Uint8Array>;
  };
  /** The media type for one archive entry's name. */
  mediaTypeFor(name: string): string;
  /** The Document's title, as the Worker sent it. */
  title(): string;
  /** Whether a Document is open, which the draw needs before it starts. */
  documentOpen(): boolean;
  /** Whether the Frame is being torn down. */
  destroyed(): boolean;
  /** The view generation, read to see whether a newer draw has started. */
  generation(): number;
  /** Starts a new view generation, invalidating draws already in flight. */
  beginGeneration(): number;
  /** The page on screen, zero-based. */
  pageIndex(): number;
  /** The current zoom setting. */
  zoom(): FrameZoom;
  /** The container the page is drawn into. */
  stage(): ComicContainer;
  /** The scroll container the page is sized against. */
  viewer(): ComicContainer;
  /** Records the scale the page was drawn at. */
  setScale(scale: number): void;
  /** Brings the toolbar's page indicator up to date. */
  updateIndicator(): void;
  /** Schedules a debounced Reading Position report. */
  schedulePosition(): void;
  /** Shows the current zoom as a percentage in the toolbar. */
  showZoom(scale: number): void;
  /** Reports a page that will not render, as opening a Document reports one. */
  fail(error: unknown): void;
  /** How many page URLs the cache keeps before trimming. */
  maxCachedPages: number;
}

/** The Comic engine: the page list, its cache, and the draw. */
export interface FrameComic {
  /** A CBZ as a minimal Document, its pages sorted naturally; throws when empty. */
  load(): ComicDocument;
  /** The CBZ's page names, in reading order. */
  files(): string[];
  /** Draws the current page, prefetching its neighbours and trimming the cache. */
  render(): Promise<void>;
  /** Revokes every cached page URL and empties the cache. */
  clearCache(): void;
  /** Drops the page list, as closing the Document does. */
  reset(): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The Comic view over the archive `deps` supplies: the page list, one `blob:`
 * URL per page, and the prefetch and trim that keep the cache small.
 */
export function createComic(deps: FrameComicDeps): FrameComic {
  const comicCache: Map<number, string> = new Map();
  let comicFiles: string[] = [];

  function load(): ComicDocument {
    const collator = new Intl.Collator(undefined, { numeric: true });
    comicFiles = deps.archive
      .entries()
      .map((item) => item.name)
      .filter((name) =>
        IMAGE_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension))
      )
      .sort(collator.compare);
    if (comicFiles.length === 0) throw new DocumentError("corrupt", "This archive has no images");
    return {
      metadata: { title: deps.title() },
      sections: comicFiles.map((name) => ({ id: name })),
      toc: comicFiles.map((name) => ({ label: name, href: name })),

      resolveHref: (href: string) => ({ index: comicFiles.indexOf(href) }),
      rendition: { layout: "pre-paginated" },
      destroy() {},
    };
  }

  function files(): string[] {
    return comicFiles;
  }

  async function comicUrl(index: number): Promise<string | null> {
    const cached = comicCache.get(index);
    if (cached) return cached;
    const name = comicFiles[index];
    if (!name) return null;
    const bytes = await deps.archive.bytes(name);
    const url = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: deps.mediaTypeFor(name) })
    );
    comicCache.set(index, url);
    return url;
  }

  async function render(): Promise<void> {
    if (!deps.documentOpen()) return;
    const generation = deps.beginGeneration();
    const index = deps.pageIndex();
    let url = null;
    try {
      url = await comicUrl(index);
    } catch (error) {
      if (!deps.destroyed() && generation === deps.generation()) deps.fail(error);
      return;
    }
    if (
      deps.destroyed() ||
      generation !== deps.generation() ||
      index !== deps.pageIndex() ||
      url === null
    )
      return;

    const viewer = deps.viewer();
    const stage = deps.stage();
    const zoomSetting = deps.zoom();
    const image = document.createElement("img");
    image.className = "reader-comic-page";
    image.src = url;
    image.alt = comicFiles[index] || "";
    const width = viewer.clientWidth > 32 ? viewer.clientWidth - 32 : 800;
    let scale = 1;
    if (typeof zoomSetting === "number") {
      image.style.width = `${Math.round(width * clamp(zoomSetting, 0.5, 4))}px`;
      image.style.height = "auto";
      scale = clamp(zoomSetting, 0.5, 4);
    } else if (zoomSetting === "page") {
      image.style.maxWidth = "100%";
      image.style.maxHeight = `${viewer.clientHeight > 32 ? viewer.clientHeight - 32 : 600}px`;
      image.style.width = "auto";
    } else {
      image.style.width = `${width}px`;
      image.style.height = "auto";
    }
    deps.setScale(scale);

    stage.textContent = "";
    stage.style.width = typeof zoomSetting === "number" ? image.style.width : "auto";
    stage.style.height = "auto";
    stage.hidden = false;
    stage.append(image);
    deps.updateIndicator();
    deps.schedulePosition();
    deps.showZoom(scale);
    prefetch();
    trim();
  }

  function prefetch() {
    const pageIndex = deps.pageIndex();
    for (const offset of [1, -1]) {
      const index = pageIndex + offset;
      if (index < 0 || index >= comicFiles.length || comicCache.has(index)) continue;
      void comicUrl(index).catch(() => {
        /* Prefetching is best effort. */
      });
    }
  }

  function trim() {
    const pageIndex = deps.pageIndex();
    for (const [index, url] of comicCache) {
      if (comicCache.size <= deps.maxCachedPages) break;
      if (Math.abs(index - pageIndex) <= 1) continue;
      comicCache.delete(index);
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* Already gone. */
      }
    }
  }

  function clearCache() {
    for (const url of comicCache.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* Already gone. */
      }
    }
    comicCache.clear();
  }

  function reset() {
    comicFiles = [];
  }

  return { load, files, render, clearCache, reset };
}
