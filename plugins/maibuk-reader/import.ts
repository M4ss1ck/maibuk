/**
 * The Import rules (#948): every file a pick returned is Fingerprinted and
 * sorted, one at a time, into the Import report.
 *
 * - Same Fingerprint as a Shelf Document: skipped, counted as already on the Shelf.
 * - Same Fingerprint as a Missing Document: relinked, keeping its id and so its
 *   Reading Position, Bookmarks, and Highlights.
 * - The same Fingerprint twice in one Import: added once.
 * - Same title and author as a Shelf Document, another Fingerprint: a
 *   collision (#949). It waits in the report, its grant held, until the author
 *   chooses Keep both, Replace, or Skip for every collision and applies them.
 * - A file Reader cannot open (DRM, damaged, not a format it reads, bytes it
 *   cannot read): named with its reason, never added.
 * - Anything else: added with its cover pending, so the Frame fills it in later.
 *
 * Picked files and a picked folder run the same rules; only the report's
 * source differs. A grant the Import does not keep is released, unless a Shelf
 * Document still holds it (the host hands back a held file's grant id). Cancel
 * stops before the next file; whatever was added stays, and the grants of the
 * files never sorted are released.
 *
 * It writes the Shelf only through `updateShelf`, so a Reading Position saved
 * while it runs is never lost. Imports only `@/plugin-sdk` and this Plugin's files.
 */

import { FILE_READ_MAX_BYTES } from "@/plugin-sdk";
import { readFileMeta } from "./import-meta";
import {
  fingerprintBytes,
  newDocumentId,
  type ReaderClient,
  type RemovalCounts,
  type ShelfService,
  type ShelvedFile,
} from "./library";
import {
  formatFromName,
  reattach,
  type ShelfProgress,
  sniffFormat,
  titleFromName,
  type DocumentFormat,
  type ShelfEntry,
} from "./shelf";
import { openZip, ZipError } from "./zip";

/**
 * Where the Import's files came from: a pick of files, or a picked folder by
 * its own name. `collect` files the folder's added Documents in a Collection
 * named after it (#949).
 */
export type ImportSource = { kind: "files" } | { kind: "folder"; name: string; collect?: boolean };

/** What the author chose for one collision (#949). */
export type CollisionChoice = "keep" | "replace" | "skip";

/** The Shelf Document a found file collides with, as the report describes it. */
export interface CollidingDocument {
  id: string;
  title: string;
  author: string;
  format: DocumentFormat;
  /** Bytes, from its Fingerprint. */
  size: number;
  progress: ShelfProgress | null;
  openedAt?: number;
  /** What Replace would drop with it. */
  removal: RemovalCounts;
}

/**
 * A found file whose title and author match a Shelf Document but whose
 * Fingerprint differs (#949). Its grant stays held until the author applies a choice.
 */
export interface ImportCollision {
  /** Unique within this Import. */
  id: string;
  file: ShelvedFile;
  fingerprint: string;
  format: DocumentFormat;
  title: string;
  author: string;
  existing: CollidingDocument;
}

/** Why Reader could not open an imported file. */
export type UnreadableReason = "drm" | "corrupt" | "unsupported" | "unreadable";

/** A file the Import named as unreadable. */
export interface UnreadableFile {
  name: string;
  reason: UnreadableReason;
}

/** What one Import did, file by file; a running Import reports the same shape so far. */
export interface ImportReport {
  source: ImportSource;
  /** How many files the pick returned. */
  found: number;
  /** How many of them were sorted so far. */
  processed: number;
  /** The added files' names, in the order they were sorted. */
  added: string[];
  alreadyOnShelf: string[];
  relinked: string[];
  unreadable: UnreadableFile[];
  /** Collisions still waiting for the author's choice (#949). */
  collisions: ImportCollision[];
  /** The Collection the folder's added Documents were filed in, when the author asked for one (#949). */
  collection?: string;
  /** Files whose Fingerprint an earlier file in the same Import already had. */
  duplicates: number;
  /** True when the author cancelled before every file was sorted. */
  cancelled: boolean;
  /** Milliseconds since the Unix epoch when it finished; absent while running. */
  finishedAt?: number;
}

export interface ImportDeps {
  client: ReaderClient;
  library: ShelfService;
  /** The clock, for tests; defaults to `Date.now`. */
  now?: () => number;
}

export interface ImportOptions {
  /** Aborting it cancels the Import before the next file. */
  signal?: AbortSignal;
  /** Called after every sorted file with a copy of the report so far. */
  onProgress?(report: ImportReport): void;
}

/** A copy the caller can keep: later files never change it. */
export function copyReport(report: ImportReport): ImportReport {
  return {
    ...report,
    source: { ...report.source },
    added: [...report.added],
    alreadyOnShelf: [...report.alreadyOnShelf],
    relinked: [...report.relinked],
    unreadable: report.unreadable.map((item) => ({ ...item })),
    collisions: report.collisions.map((item) => ({
      ...item,
      file: { ...item.file },
      existing: { ...item.existing, removal: { ...item.existing.removal } },
    })),
  };
}

/** An empty report for `found` files from `source`. */
export function emptyReport(source: ImportSource, found: number): ImportReport {
  return {
    source,
    found,
    processed: 0,
    added: [],
    alreadyOnShelf: [],
    relinked: [],
    unreadable: [],
    collisions: [],
    duplicates: 0,
    cancelled: false,
  };
}

/**
 * A title or author as a collision compares it (#949): trimmed, whitespace
 * runs collapsed to one space, and case ignored.
 */
export function collisionKey(title: string, author: string): string {
  const clean = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return `${clean(title)}\u0000${clean(author)}`;
}

/** A file's size in bytes, from the `${size}:` its Fingerprint starts with. */
function sizeFromFingerprint(print: string): number {
  const size = Number.parseInt(print.slice(0, print.indexOf(":")), 10);
  return Number.isFinite(size) && size >= 0 ? size : 0;
}

/** A Missing Document an Import may relink: its file moved, or the browser must ask again. */
function relinkable(entry: ShelfEntry): boolean {
  return entry.state === "missing" || entry.state === "needs-permission";
}

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

/** Reads `length` bytes at `offset`, in the chunks the File Grant API allows. */
function rangedReader(client: ReaderClient, grant: string) {
  return async (offset: number, length: number): Promise<Uint8Array> => {
    const out = new Uint8Array(Math.max(0, length));
    let total = 0;
    while (total < length) {
      const take = Math.min(length - total, FILE_READ_MAX_BYTES);
      const bytes = new Uint8Array(
        await client.files.read({ grant, offset: offset + total, length: take })
      );
      out.set(bytes, total);
      total += bytes.byteLength;
      if (bytes.byteLength < take) break;
    }
    return out.subarray(0, total);
  };
}

/**
 * Why Reader could not open the file, or null when it can: a zip-based format
 * must have a readable directory and no content DRM, and a MOBI or AZW3 must
 * carry no PalmDOC encryption flag. Deeper damage shows when it is opened.
 */
async function unreadableReason(
  client: ReaderClient,
  file: ShelvedFile,
  format: DocumentFormat,
  head: Uint8Array
): Promise<UnreadableReason | null> {
  const read = rangedReader(client, file.grant);
  if (format === "epub" || format === "cbz") {
    try {
      await openZip(read, file.size);
      return null;
    } catch (error) {
      if (error instanceof ZipError && error.code === "drm") return "drm";
      if (error instanceof ZipError) return "corrupt";
      return "unreadable";
    }
  }
  if (format === "mobi" || format === "azw3") {
    if (head.length < 82) return "corrupt";
    const flagOffset = u32be(head, 78) + 12;
    let bytes = head;
    if (flagOffset + 2 > bytes.length) {
      if (flagOffset + 2 > file.size) return "corrupt";
      bytes = await read(flagOffset, 2);
      return bytes.length < 2 ? "corrupt" : u16be(bytes, 0) !== 0 ? "drm" : null;
    }
    return u16be(bytes, flagOffset) !== 0 ? "drm" : null;
  }
  return null;
}

/** Runs one Import over `picked` and resolves with its report. It never throws for one file. */
export async function runImport(
  deps: ImportDeps,
  picked: readonly ShelvedFile[],
  source: ImportSource,
  options: ImportOptions = {}
): Promise<ImportReport> {
  const { client, library } = deps;
  const now = deps.now ?? Date.now;
  const report = emptyReport(source, picked.length);
  /**
   * How this Import sorted each Fingerprint, so a second copy repeats the
   * first copy's outcome: only a copy of a file it added is a duplicate.
   */
  const seen = new Map<
    string,
    | { kind: "added" }
    | { kind: "onShelf" }
    | { kind: "collision" }
    | { kind: "unreadable"; reason: UnreadableReason }
  >();
  /** The ids of the Documents this Import added, for the folder's Collection. */
  const addedIds: string[] = [];

  /** Releases `grant` unless a Shelf Document holds it. */
  const letGo = (grant: string) => releaseUnlessHeld(client, library, grant);

  async function sortOne(file: ShelvedFile): Promise<void> {
    let head: Uint8Array;
    let print: string;
    try {
      ({ head, print } = await fingerprintBytes(client, file.grant, file.size));
    } catch {
      report.unreadable.push({ name: file.name, reason: "unreadable" });
      await letGo(file.grant);
      return;
    }
    const first = seen.get(print);
    if (first !== undefined) {
      if (first.kind === "added" || first.kind === "collision") report.duplicates += 1;
      else if (first.kind === "onShelf") report.alreadyOnShelf.push(file.name);
      else report.unreadable.push({ name: file.name, reason: first.reason });
      await letGo(file.grant);
      return;
    }

    const match = (await library.loadShelf()).find((entry) => entry.fingerprint === print);
    if (match !== undefined && relinkable(match)) {
      let relinked = false;
      await library.updateShelf((shelf) => {
        const current = shelf.find((entry) => entry.fingerprint === print);
        if (current === undefined || !relinkable(current)) return null;
        const result = reattach(shelf, current.id, print, file.grant);
        if (!result.ok) return null;
        relinked = true;
        return result.shelf;
      });
      if (relinked) {
        seen.set(print, { kind: "onShelf" });
        report.relinked.push(file.name);
        if (match.grant !== file.grant) await letGo(match.grant);
        return;
      }
    }
    if (match !== undefined) {
      seen.set(print, { kind: "onShelf" });
      report.alreadyOnShelf.push(file.name);
      if (match.grant !== file.grant) await letGo(file.grant);
      return;
    }

    const format = sniffFormat(head, file.name) ?? formatFromName(file.name);
    const reason =
      format === null ? "unsupported" : await unreadableReason(client, file, format, head);
    if (format === null || reason !== null) {
      seen.set(print, { kind: "unreadable", reason: reason ?? "unsupported" });
      report.unreadable.push({ name: file.name, reason: reason ?? "unsupported" });
      await letGo(file.grant);
      return;
    }

    const meta = await readFileMeta(rangedReader(client, file.grant), file.size, format, head);
    const title = meta.title === "" ? titleFromName(file.name) : meta.title;
    const key = collisionKey(title, meta.author);
    const twin = (await library.loadShelf()).find(
      (entry) => entry.fingerprint !== print && collisionKey(entry.title, entry.author) === key
    );
    if (twin !== undefined) {
      seen.set(print, { kind: "collision" });
      report.collisions.push({
        id: `collision-${report.collisions.length + 1}`,
        file: { ...file },
        fingerprint: print,
        format,
        title,
        author: meta.author,
        existing: {
          id: twin.id,
          title: twin.title,
          author: twin.author,
          format: twin.format,
          size: sizeFromFingerprint(twin.fingerprint),
          progress: twin.progress,
          ...(twin.openedAt === undefined ? {} : { openedAt: twin.openedAt }),
          removal: await library
            .removalCounts(twin.id)
            .catch(() => ({ bookmarks: 0, highlights: 0, notes: 0 })),
        },
      });
      return;
    }

    const entry = importedEntry(file, print, format, title, meta.author, now());
    let added = false;
    await library.updateShelf((shelf) => {
      // Another path may have shelved the same file while this one was probed.
      if (shelf.some((candidate) => candidate.fingerprint === print)) return null;
      added = true;
      return [...shelf, entry];
    });
    seen.set(print, added ? { kind: "added" } : { kind: "onShelf" });
    if (added) {
      report.added.push(file.name);
      addedIds.push(entry.id);
    } else report.alreadyOnShelf.push(file.name);
  }

  let index = 0;
  for (; index < picked.length; index += 1) {
    if (options.signal?.aborted) break;
    try {
      await sortOne(picked[index]);
    } catch {
      // A Shelf that could not be read or written: the file is named, its
      // grant let go like every other file not added, and the rest go on.
      report.unreadable.push({ name: picked[index].name, reason: "unreadable" });
      await letGo(picked[index].grant);
    }
    report.processed += 1;
    options.onProgress?.(copyReport(report));
  }
  if (index < picked.length) {
    report.cancelled = true;
    for (const file of picked.slice(index)) await letGo(file.grant);
  }
  if (source.kind === "folder" && source.collect === true) {
    if (await fileInFolderCollection(library, source.name, addedIds)) {
      report.collection = source.name;
    }
  }
  report.finishedAt = now();
  return report;
}

/** A new Shelf row for an imported file, its cover pending. */
function importedEntry(
  file: ShelvedFile,
  print: string,
  format: DocumentFormat,
  title: string,
  author: string,
  time: number
): ShelfEntry {
  return {
    id: newDocumentId(),
    grant: file.grant,
    fingerprint: print,
    title,
    author,
    format,
    coverPending: true,
    lastReadAt: time,
    addedAt: time,
    progress: null,
    state: "ok",
  };
}

/**
 * Files `ids` in the folder's Collection, and says whether any were filed; a
 * refused write leaves them on the Shelf, unfiled.
 */
async function fileInFolderCollection(
  library: ShelfService,
  name: string,
  ids: readonly string[]
): Promise<boolean> {
  if (ids.length === 0) return false;
  try {
    await library.fileInCollection(name, ids);
    return true;
  } catch {
    // The Documents are on the Shelf; only the filing was lost.
    return false;
  }
}

/**
 * Applies the author's choice for every collision (#949). Keep both adds the
 * file as its own Document; Replace puts it in the old Document's place and
 * Collections, dropping the old Reading Position, Bookmarks, and Highlights;
 * Skip lets the file go. A Replace whose old Document has left the Shelf
 * meanwhile adds the file instead. Resolves with the report after the choices.
 */
export async function applyCollisionChoices(
  deps: ImportDeps,
  report: ImportReport,
  choices: Readonly<Record<string, CollisionChoice>>
): Promise<ImportReport> {
  const { client, library } = deps;
  const now = deps.now ?? Date.now;
  const next = copyReport(report);
  const filed: string[] = [];
  for (const collision of report.collisions) {
    const choice = choices[collision.id];
    const { file } = collision;
    try {
      if (choice === "skip") {
        await releaseUnlessHeld(client, library, file.grant);
        continue;
      }
      const entry = importedEntry(
        file,
        collision.fingerprint,
        collision.format,
        collision.title,
        collision.author,
        now()
      );
      if (choice === "replace" && (await library.replaceDocument(collision.existing.id, entry))) {
        next.added.push(file.name);
        filed.push(entry.id);
        continue;
      }
      let added = false;
      await library.updateShelf((shelf) => {
        if (shelf.some((candidate) => candidate.fingerprint === collision.fingerprint)) return null;
        added = true;
        return [...shelf, entry];
      });
      if (added) {
        next.added.push(file.name);
        filed.push(entry.id);
      } else {
        next.alreadyOnShelf.push(file.name);
        await releaseUnlessHeld(client, library, file.grant);
      }
    } catch {
      next.unreadable.push({ name: file.name, reason: "unreadable" });
      await releaseUnlessHeld(client, library, file.grant);
    }
  }
  next.collisions = [];
  if (report.source.kind === "folder" && report.source.collect === true) {
    if (await fileInFolderCollection(library, report.source.name, filed)) {
      next.collection = report.source.name;
    }
  }
  return next;
}

/**
 * Releases `grant` unless a Shelf Document holds it. An unread Shelf may hold
 * it, so a failed read keeps it rather than break a Document.
 */
async function releaseUnlessHeld(
  client: ReaderClient,
  library: ShelfService,
  grant: string
): Promise<void> {
  try {
    const shelf = await library.loadShelf();
    if (shelf.some((entry) => entry.grant === grant)) return;
  } catch {
    return;
  }
  try {
    await client.files.release({ grant });
  } catch {
    // The grant may already be gone.
  }
}

/** The background Import the Shelf draws: running with its counts so far, or done with its report. */
export interface ImportState {
  status: "running" | "done";
  report: ImportReport;
}

/**
 * The one background Import this Worker runs (#948). It outlives the Frame
 * that started it, so the author can open a Document, go back, and still see
 * the card, and it keeps the finished report until the author dismisses it.
 */
export interface Importer {
  /** The running or finished Import, or null when there is none to show. */
  readonly state: ImportState | null;
  /**
   * Starts an Import; false, starting nothing, while another one runs or the
   * last one still has collisions to resolve.
   */
  start(picked: readonly ShelvedFile[], source: ImportSource): boolean;
  /**
   * Applies a choice for every collision of the finished Import (#949).
   * Resolves false, applying nothing, when one has no choice or none waits.
   */
  resolve(choices: Readonly<Record<string, CollisionChoice>>): Promise<boolean>;
  /** Cancels the running Import before its next file; the Documents added stay. */
  cancel(): void;
  /** Forgets a finished Import, so the card and report go away; never while collisions wait. */
  dismiss(): void;
  /** Resolves when the running Import finishes; at once when none runs. */
  idle(): Promise<void>;
  /** Called with every change: each sorted file, the finish, a dismiss. Returns the unsubscribe. */
  subscribe(listener: (state: ImportState | null) => void): () => void;
}

/** Whether a finished Import still has collisions waiting for the author. */
function hasCollisions(state: ImportState | null): boolean {
  return state?.status === "done" && state.report.collisions.length > 0;
}

export function createImporter(deps: ImportDeps): Importer {
  let state: ImportState | null = null;
  let controller: AbortController | null = null;
  let running: Promise<void> = Promise.resolve();
  let resolving = false;
  const listeners = new Set<(state: ImportState | null) => void>();

  function emit(next: ImportState | null): void {
    state = next;
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch {
        // One broken listener must not stop the Import or the others.
      }
    }
  }

  return {
    get state() {
      return state;
    },
    start(picked, source): boolean {
      if (state?.status === "running" || hasCollisions(state)) return false;
      const abort = new AbortController();
      controller = abort;
      emit({ status: "running", report: emptyReport(source, picked.length) });
      running = runImport(deps, picked, source, {
        signal: abort.signal,
        onProgress: (report) => {
          if (controller === abort) emit({ status: "running", report });
        },
      }).then((report) => {
        if (controller !== abort) return;
        controller = null;
        emit({ status: "done", report });
      });
      return true;
    },
    async resolve(choices): Promise<boolean> {
      const current = state;
      if (current?.status !== "done" || !hasCollisions(current) || resolving) return false;
      const valid = new Set<CollisionChoice>(["keep", "replace", "skip"]);
      if (!current.report.collisions.every((item) => valid.has(choices[item.id]))) return false;
      resolving = true;
      try {
        const report = await applyCollisionChoices(deps, current.report, choices);
        if (state === current) emit({ status: "done", report });
        return true;
      } finally {
        resolving = false;
      }
    },
    cancel(): void {
      controller?.abort();
    },
    dismiss(): void {
      if (state?.status !== "done" || hasCollisions(state)) return;
      emit(null);
    },
    idle(): Promise<void> {
      return running;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** What the author picked to import: several files, or one folder and its subfolders. */
export type ImportPickKind = "files" | "folder";

/**
 * Asks the author for files or a folder and starts the Import. Resolves with
 * false when the author cancelled the dialog, or an Import is already running.
 * A failed pick throws, so the caller tells the author.
 */
export async function pickAndImport(
  client: ReaderClient,
  importer: Importer,
  kind: ImportPickKind,
  extensions: readonly string[],
  options: { collect?: boolean } = {}
): Promise<boolean> {
  const state = importer.state;
  if (state?.status === "running" || hasCollisions(state)) return false;
  if (kind === "folder") {
    const picked = await client.files.pick({ extensions: [...extensions], folder: true });
    if (picked === null) return false;
    return importer.start(picked.grants, {
      kind: "folder",
      name: picked.folder,
      collect: options.collect === true,
    });
  }
  const picked = await client.files.pick({ extensions: [...extensions], multiple: true });
  if (picked === null || picked.grants.length === 0) return false;
  return importer.start(picked.grants, { kind: "files" });
}
