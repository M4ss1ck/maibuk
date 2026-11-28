// @vitest-environment jsdom
/**
 * The Import rules (#948) through the Plugin test kit: the real broker, the
 * File Grant fakes, and Plugin storage. Every file a pick returns is
 * Fingerprinted and sorted into added, already on the Shelf, relinked, or
 * unreadable; a Fingerprint seen twice in one import is added once; Cancel
 * keeps what was added and stops the rest.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPluginClient } from "@/plugin-sdk";
import { createTestHost } from "@/features/plugins/test-kit";
import { describe, expect, it } from "vitest";
import {
  applyCollisionChoices,
  collisionKey,
  createImporter,
  runImport,
  type ImportReport,
} from "./import";
import { createShelfService } from "./library";
import {
  COLLECTIONS_KEY,
  SHELF_KEY,
  SUPPORTED_EXTENSIONS,
  bookmarksKey,
  highlightsKey,
  positionKey,
  type Collection,
  type ShelfEntry,
} from "./shelf";
import { epubBytes, metaEpub, pdfBytes, readerManifest } from "./test-support";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));

function setup() {
  const storage = new Map<string, unknown>();
  const host = createTestHost({ manifest: readerManifest(), storage });
  const client = createPluginClient(host.port);
  const library = createShelfService(client);
  /** Picks a folder of `files` through the real `files.pick`, as the Import does. */
  async function pickFolder(files: { name: string; bytes: Uint8Array }[], name = "Library") {
    host.files.queueFolderPick({ name, files });
    const picked = await client.files.pick({ extensions: [...SUPPORTED_EXTENSIONS], folder: true });
    if (picked === null) throw new Error("no folder");
    return picked.grants;
  }
  /** Picks several files through the real `files.pick`, as Import files does. */
  async function pickFiles(files: { name: string; bytes: Uint8Array }[]) {
    host.files.queueFilesPick(files);
    const picked = await client.files.pick({
      extensions: [...SUPPORTED_EXTENSIONS],
      multiple: true,
    });
    if (picked === null) throw new Error("no files");
    return picked.grants;
  }
  const shelf = () => (storage.get(SHELF_KEY) ?? []) as ShelfEntry[];
  return { host, storage, client, library, pickFolder, pickFiles, shelf };
}

const names = (report: ImportReport) => ({
  added: [...report.added].sort(),
  alreadyOnShelf: [...report.alreadyOnShelf].sort(),
  relinked: [...report.relinked].sort(),
  unreadable: report.unreadable.map((item) => `${item.name}:${item.reason}`).sort(),
  duplicates: report.duplicates,
});

describe("runImport()", () => {
  it("adds every readable file, titled from its own metadata or else its name, with its cover pending", async () => {
    const { host, client, library, pickFolder, shelf } = setup();
    try {
      const grants = await pickFolder([
        { name: "Dune.pdf", bytes: pdfBytes("dune") },
        { name: "Emma.epub", bytes: fixture("flowing.epub") },
      ]);
      const report = await runImport({ client, library }, grants, {
        kind: "folder",
        name: "Library",
      });
      expect(names(report).added).toEqual(["Dune.pdf", "Emma.epub"]);
      expect(report.found).toBe(2);
      expect(report.cancelled).toBe(false);
      expect(
        shelf()
          .map((entry) => [entry.title, entry.author, entry.format, entry.coverPending])
          .sort()
      ).toEqual([
        // Dune.pdf names no title, so its file name does; flowing.epub's OPF names its own.
        ["Dune", "", "pdf", true],
        ["Dune", "Frank Herbert", "epub", true],
      ]);
    } finally {
      await host.stop();
    }
  });

  it("skips a file whose Fingerprint is already on the Shelf and counts it", async () => {
    const { host, client, library, pickFolder, shelf } = setup();
    try {
      const first = await pickFolder([{ name: "Dune.pdf", bytes: pdfBytes("dune") }]);
      await runImport({ client, library }, first, { kind: "folder", name: "Library" });
      const before = shelf();
      // The same bytes under another name: same Fingerprint, so the same Document.
      const second = await pickFolder([{ name: "Dune copy.pdf", bytes: pdfBytes("dune") }]);
      const report = await runImport({ client, library }, second, {
        kind: "folder",
        name: "Library",
      });
      expect(names(report)).toMatchObject({ added: [], alreadyOnShelf: ["Dune copy.pdf"] });
      expect(shelf()).toEqual(before);
      // The new grant is released; the Shelf keeps the grant it had.
      expect((await client.files.list()).map((grant) => grant.grant)).toEqual([before[0].grant]);
    } finally {
      await host.stop();
    }
  });

  it("re-importing the same folder adds nothing and reports every file as already on the Shelf", async () => {
    const { host, client, library, pickFolder, shelf } = setup();
    try {
      const files = [
        { name: "Dune.pdf", bytes: pdfBytes("dune") },
        { name: "Emma.epub", bytes: fixture("flowing.epub") },
        { name: "Nemo.cbz", bytes: fixture("pages.cbz") },
      ];
      await runImport({ client, library }, await pickFolder(files), {
        kind: "folder",
        name: "Library",
      });
      const before = shelf();
      const report = await runImport({ client, library }, await pickFolder(files), {
        kind: "folder",
        name: "Library",
      });
      expect(names(report)).toEqual({
        added: [],
        alreadyOnShelf: ["Dune.pdf", "Emma.epub", "Nemo.cbz"],
        relinked: [],
        unreadable: [],
        duplicates: 0,
      });
      expect(shelf()).toEqual(before);
      // Every grant the Shelf holds is still live: none was released by mistake.
      const live = (await client.files.list()).map((grant) => grant.grant).sort();
      expect(live).toEqual(before.map((entry) => entry.grant).sort());
    } finally {
      await host.stop();
    }
  });

  it("relinks a Missing Document with the same Fingerprint and keeps its Reading Position", async () => {
    const { host, storage, client, library, pickFolder, shelf } = setup();
    try {
      const first = await pickFolder([{ name: "Dune.pdf", bytes: pdfBytes("dune") }]);
      await runImport({ client, library }, first, { kind: "folder", name: "Library" });
      const original = shelf()[0];
      const position = { page: 7 };
      storage.set(positionKey(original.id), position);
      host.files.setMissing(original.grant);
      await library.refreshStates();
      expect(shelf()[0].state).toBe("missing");

      const moved = await pickFolder([{ name: "Moved Dune.pdf", bytes: pdfBytes("dune") }]);
      const report = await runImport({ client, library }, moved, {
        kind: "folder",
        name: "Library",
      });
      expect(names(report)).toMatchObject({ added: [], relinked: ["Moved Dune.pdf"] });
      const [relinked] = shelf();
      expect(shelf()).toHaveLength(1);
      expect(relinked.id).toBe(original.id);
      expect(relinked.state).toBe("ok");
      expect(relinked.grant).toBe(moved[0].grant);
      expect(storage.get(positionKey(original.id))).toEqual(position);
    } finally {
      await host.stop();
    }
  });

  it("adds the same Fingerprint twice in one import once", async () => {
    const { host, client, library, pickFolder, shelf } = setup();
    try {
      const grants = await pickFolder([
        { name: "Dune.pdf", bytes: pdfBytes("dune") },
        { name: "Dune (1).pdf", bytes: pdfBytes("dune") },
      ]);
      const report = await runImport({ client, library }, grants, {
        kind: "folder",
        name: "Library",
      });
      expect(names(report)).toMatchObject({ added: ["Dune.pdf"], duplicates: 1 });
      expect(shelf()).toHaveLength(1);
      expect((await client.files.list()).map((grant) => grant.grant)).toEqual([shelf()[0].grant]);
    } finally {
      await host.stop();
    }
  });

  // A second copy repeats the first copy's outcome: only a copy of a file this
  // Import added is a duplicate "added once".
  it("reports a second copy as the first was sorted: already on the Shelf, or unreadable", async () => {
    const { host, client, library, pickFolder, shelf } = setup();
    try {
      await runImport(
        { client, library },
        await pickFolder([{ name: "Dune.pdf", bytes: pdfBytes("dune") }]),
        {
          kind: "folder",
          name: "Library",
        }
      );
      const before = shelf();
      const report = await runImport(
        { client, library },
        await pickFolder([
          { name: "Dune.pdf", bytes: pdfBytes("dune") },
          { name: "Sub/Dune.pdf", bytes: pdfBytes("dune") },
          { name: "broken.epub", bytes: fixture("corrupt.epub") },
          { name: "broken (1).epub", bytes: fixture("corrupt.epub") },
        ]),
        { kind: "folder", name: "Library" }
      );
      expect(names(report)).toEqual({
        added: [],
        alreadyOnShelf: ["Dune.pdf", "Sub/Dune.pdf"],
        relinked: [],
        unreadable: ["broken (1).epub:corrupt", "broken.epub:corrupt"],
        duplicates: 0,
      });
      expect(shelf()).toEqual(before);
      const live = (await client.files.list()).map((grant) => grant.grant).sort();
      expect(live).toEqual(before.map((entry) => entry.grant).sort());
    } finally {
      await host.stop();
    }
  });

  it("names every file Reader cannot open with its reason, and adds none of them", async () => {
    const { host, client, library, pickFolder, shelf } = setup();
    try {
      const grants = await pickFolder([
        { name: "Locked.epub", bytes: fixture("encrypted.epub") },
        { name: "Broken.epub", bytes: fixture("corrupt.epub") },
        { name: "Store.mobi", bytes: fixture("drm.mobi") },
        { name: "Fine.mobi", bytes: fixture("story.mobi") },
      ]);
      const report = await runImport({ client, library }, grants, {
        kind: "folder",
        name: "Library",
      });
      expect(names(report)).toMatchObject({
        added: ["Fine.mobi"],
        unreadable: ["Broken.epub:corrupt", "Locked.epub:drm", "Store.mobi:drm"],
      });
      expect(shelf().map((entry) => entry.title)).toEqual(["Notes"]);
      // The unreadable files' grants are released.
      expect(await client.files.list()).toHaveLength(1);
    } finally {
      await host.stop();
    }
  });

  it("names a file whose bytes cannot be read as unreadable", async () => {
    const { host, client, library, pickFolder } = setup();
    try {
      const grants = await pickFolder([{ name: "Gone.pdf", bytes: pdfBytes("gone") }]);
      host.files.setMissing(grants[0].grant);
      const report = await runImport({ client, library }, grants, {
        kind: "folder",
        name: "Library",
      });
      expect(names(report).unreadable).toEqual(["Gone.pdf:unreadable"]);
    } finally {
      await host.stop();
    }
  });

  it("sorts picked files exactly as it sorts a picked folder", async () => {
    const { host, client, library, pickFolder, pickFiles } = setup();
    try {
      const seed = await pickFolder([{ name: "Seen.pdf", bytes: pdfBytes("seen") }]);
      await runImport({ client, library }, seed, { kind: "folder", name: "Library" });
      const files = [
        { name: "Seen again.pdf", bytes: pdfBytes("seen") },
        { name: "New.epub", bytes: epubBytes("not really a zip") },
        { name: "Twin.pdf", bytes: pdfBytes("twin") },
        { name: "Twin copy.pdf", bytes: pdfBytes("twin") },
        { name: "Store.mobi", bytes: fixture("drm.mobi") },
      ];
      const viaFiles = names(
        await runImport({ client, library }, await pickFiles(files), { kind: "files" })
      );

      const other = setup();
      try {
        const otherSeed = await other.pickFolder([{ name: "Seen.pdf", bytes: pdfBytes("seen") }]);
        await runImport({ client: other.client, library: other.library }, otherSeed, {
          kind: "folder",
          name: "Library",
        });
        const viaFolder = names(
          await runImport(
            { client: other.client, library: other.library },
            await other.pickFolder(files),
            { kind: "folder", name: "Library" }
          )
        );
        expect(viaFiles).toEqual(viaFolder);
        expect(viaFiles).toEqual({
          added: ["Twin.pdf"],
          alreadyOnShelf: ["Seen again.pdf"],
          relinked: [],
          unreadable: ["New.epub:corrupt", "Store.mobi:drm"],
          duplicates: 1,
        });
      } finally {
        await other.host.stop();
      }
    } finally {
      await host.stop();
    }
  });

  it("reports progress after every file, with running counts", async () => {
    const { host, client, library, pickFolder } = setup();
    try {
      const grants = await pickFolder([
        { name: "A.pdf", bytes: pdfBytes("a") },
        { name: "B.pdf", bytes: pdfBytes("b") },
      ]);
      const seen: [number, number][] = [];
      await runImport(
        { client, library },
        grants,
        { kind: "folder", name: "Library" },
        {
          onProgress: (report) => seen.push([report.processed, report.added.length]),
        }
      );
      expect(seen).toEqual([
        [1, 1],
        [2, 2],
      ]);
    } finally {
      await host.stop();
    }
  });

  it("Cancel keeps every Document already added and stops the rest", async () => {
    const { host, client, library, pickFolder, shelf } = setup();
    try {
      const grants = await pickFolder([
        { name: "A.pdf", bytes: pdfBytes("a") },
        { name: "B.pdf", bytes: pdfBytes("b") },
        { name: "C.pdf", bytes: pdfBytes("c") },
        { name: "D.pdf", bytes: pdfBytes("d") },
      ]);
      const controller = new AbortController();
      const report = await runImport(
        { client, library },
        grants,
        { kind: "folder", name: "Library" },
        {
          signal: controller.signal,
          onProgress: (progress) => {
            if (progress.processed === 2) controller.abort();
          },
        }
      );
      expect(report.cancelled).toBe(true);
      expect(report.processed).toBe(2);
      expect(names(report).added).toEqual(["A.pdf", "B.pdf"]);
      expect(
        shelf()
          .map((entry) => entry.title)
          .sort()
      ).toEqual(["A", "B"]);
      // The files never sorted are let go: only the two added Documents hold grants.
      expect((await client.files.list()).map((grant) => grant.grant).sort()).toEqual(
        shelf()
          .map((entry) => entry.grant)
          .sort()
      );
    } finally {
      await host.stop();
    }
  });

  it("never loses a Reading Position saved while the Import is writing the Shelf", async () => {
    const { host, client, library, pickFolder, shelf } = setup();
    try {
      const seed = await pickFolder([{ name: "Open.pdf", bytes: pdfBytes("open") }]);
      await runImport({ client, library }, seed, { kind: "folder", name: "Library" });
      const openId = shelf()[0].id;
      const grants = await pickFolder(
        Array.from({ length: 6 }, (_, index) => ({
          name: `Book ${index}.pdf`,
          bytes: pdfBytes(`book ${index}`),
        }))
      );
      const running = runImport({ client, library }, grants, { kind: "folder", name: "Library" });
      // The reading view saves progress while the Import runs.
      await library.updateShelf((current) =>
        current.map((entry) =>
          entry.id === openId ? { ...entry, progress: { fraction: 0.5 } } : entry
        )
      );
      await running;
      expect(shelf()).toHaveLength(7);
      expect(shelf().find((entry) => entry.id === openId)?.progress).toMatchObject({
        fraction: 0.5,
      });
    } finally {
      await host.stop();
    }
  });
});

describe("collisions (#949)", () => {
  const folder = { kind: "folder", name: "Library" } as const;

  /** A Shelf with Middlemarch read to 34%, 2 Bookmarks, 1 Highlight, and in the Collection "Eliot". */
  async function shelfWithMiddlemarch(ctx: ReturnType<typeof setup>) {
    const { client, library, pickFiles, storage, shelf } = ctx;
    await runImport(
      { client, library },
      await pickFiles([
        { name: "middlemarch.epub", bytes: metaEpub("Middlemarch", "George Eliot", "first") },
      ]),
      { kind: "files" }
    );
    const old = shelf()[0];
    storage.set(positionKey(old.id), { kind: "fixed", page: 3 });
    storage.set(bookmarksKey(old.id), [{ id: "b1" }, { id: "b2" }]);
    storage.set(highlightsKey(old.id), [{ id: "h1" }]);
    await library.updateShelf((rows) =>
      rows.map((row) => ({ ...row, progress: { page: 34, pageCount: 100 }, openedAt: 5 }))
    );
    await library.createCollection("Eliot", old.id);
    return shelf()[0];
  }

  it("compares titles and authors ignoring case, outer spaces, and runs of whitespace", () => {
    expect(collisionKey("  Don  Quijote ", "MIGUEL de\tCervantes")).toBe(
      collisionKey("don quijote", "Miguel de Cervantes")
    );
    expect(collisionKey("Emma", "Austen")).not.toBe(collisionKey("Emma", "Brontë"));
  });

  it("holds a file whose title and author match a Shelf Document but whose Fingerprint differs", async () => {
    const ctx = setup();
    const { host, client, library, pickFolder, shelf } = ctx;
    try {
      const old = await shelfWithMiddlemarch(ctx);
      const before = shelf();
      const report = await runImport(
        { client, library },
        await pickFolder([
          {
            name: "middlemarch-illustrated.epub",
            bytes: metaEpub(" middlemarch ", "GEORGE  ELIOT", "second"),
          },
          { name: "Emma.epub", bytes: metaEpub("Emma", "Jane Austen") },
        ]),
        folder
      );
      expect(report.added).toEqual(["Emma.epub"]);
      expect(report.collisions).toHaveLength(1);
      expect(report.collisions[0]).toMatchObject({
        title: "middlemarch",
        file: { name: "middlemarch-illustrated.epub" },
        existing: {
          id: old.id,
          title: "Middlemarch",
          author: "George Eliot",
          progress: { page: 34, pageCount: 100 },
          removal: { bookmarks: 2, highlights: 1 },
        },
      });
      // The colliding file is not on the Shelf yet, and its grant is held for the choice.
      expect(shelf().filter((row) => row.title.toLowerCase() === "middlemarch")).toEqual(before);
      expect((await client.files.list()).map((grant) => grant.grant)).toContain(
        report.collisions[0].file.grant
      );
      // Imported Documents carry their own title and author.
      expect(shelf().find((row) => row.title === "Emma")?.author).toBe("Jane Austen");
    } finally {
      await host.stop();
    }
  });

  it("Keep both adds the file as its own Document; Skip leaves the Shelf unchanged and lets the file go", async () => {
    const ctx = setup();
    const { host, client, library, pickFolder, shelf } = ctx;
    try {
      await shelfWithMiddlemarch(ctx);
      const files = [
        { name: "middlemarch-2.epub", bytes: metaEpub("Middlemarch", "George Eliot", "second") },
      ];
      const skipped = await runImport({ client, library }, await pickFolder(files), folder);
      const before = shelf();
      const afterSkip = await applyCollisionChoices({ client, library }, skipped, {
        [skipped.collisions[0].id]: "skip",
      });
      expect(afterSkip.collisions).toEqual([]);
      expect(shelf()).toEqual(before);
      expect((await client.files.list()).map((grant) => grant.grant)).not.toContain(
        skipped.collisions[0].file.grant
      );

      const kept = await runImport({ client, library }, await pickFolder(files), folder);
      const afterKeep = await applyCollisionChoices({ client, library }, kept, {
        [kept.collisions[0].id]: "keep",
      });
      expect(afterKeep.added).toEqual(["middlemarch-2.epub"]);
      expect(shelf()).toHaveLength(2);
      expect(shelf().every((row) => row.title === "Middlemarch")).toBe(true);
      // The old Document keeps everything it had.
      expect(before.every((row) => shelf().some((now) => now.id === row.id))).toBe(true);
    } finally {
      await host.stop();
    }
  });

  it("Replace keeps the old Document's Collections and drops its Reading Position, Bookmarks, and Highlights", async () => {
    const ctx = setup();
    const { host, client, library, pickFolder, shelf, storage } = ctx;
    try {
      const old = await shelfWithMiddlemarch(ctx);
      const report = await runImport(
        { client, library },
        await pickFolder([
          { name: "middlemarch-2.epub", bytes: metaEpub("Middlemarch", "George Eliot", "second") },
        ]),
        folder
      );
      const next = await applyCollisionChoices({ client, library }, report, {
        [report.collisions[0].id]: "replace",
      });
      expect(next.collisions).toEqual([]);
      const rows = shelf();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).not.toBe(old.id);
      expect(rows[0]).toMatchObject({ title: "Middlemarch", progress: null, coverPending: true });
      expect(rows[0].fingerprint).toBe(report.collisions[0].fingerprint);
      const collections = storage.get(COLLECTIONS_KEY) as Collection[];
      expect(collections.find((item) => item.name === "Eliot")?.documentIds).toEqual([rows[0].id]);
      for (const key of [positionKey(old.id), bookmarksKey(old.id), highlightsKey(old.id)]) {
        expect(storage.has(key)).toBe(false);
      }
      // The old file's grant is released; the new one is held by the Shelf.
      const live = (await client.files.list()).map((grant) => grant.grant);
      expect(live).toEqual([rows[0].grant]);
    } finally {
      await host.stop();
    }
  });

  it("files a folder's added Documents in a Collection named after it, reusing one with that name", async () => {
    const ctx = setup();
    const { host, client, library, pickFolder, shelf, storage } = ctx;
    try {
      await library.createCollection("Library");
      const report = await runImport(
        { client, library },
        await pickFolder([
          { name: "Emma.epub", bytes: metaEpub("Emma", "Jane Austen") },
          { name: "Dune.pdf", bytes: pdfBytes("dune") },
        ]),
        { kind: "folder", name: "Library", collect: true }
      );
      expect(report.collection).toBe("Library");
      const collections = storage.get(COLLECTIONS_KEY) as Collection[];
      expect(collections).toHaveLength(1);
      expect([...collections[0].documentIds].sort()).toEqual(
        shelf()
          .map((row) => row.id)
          .sort()
      );

      // A Keep both from a later collision joins the same Collection.
      const second = await runImport(
        { client, library },
        await pickFolder(
          [{ name: "Emma 2.epub", bytes: metaEpub("Emma", "Jane Austen", "two") }],
          "Classics"
        ),
        { kind: "folder", name: "Classics", collect: true }
      );
      await applyCollisionChoices({ client, library }, second, {
        [second.collisions[0].id]: "keep",
      });
      const after = storage.get(COLLECTIONS_KEY) as Collection[];
      expect(after.map((item) => item.name)).toEqual(["Library", "Classics"]);
      expect(after[1].documentIds).toHaveLength(1);
    } finally {
      await host.stop();
    }
  });

  it("names the folder's Collection only when it filed something, and files a Replace in it", async () => {
    const ctx = setup();
    const { host, client, library, pickFolder, shelf, storage } = ctx;
    try {
      const old = await shelfWithMiddlemarch(ctx);
      const report = await runImport(
        { client, library },
        await pickFolder([
          { name: "middlemarch-2.epub", bytes: metaEpub("Middlemarch", "George Eliot", "second") },
        ]),
        { kind: "folder", name: "Library", collect: true }
      );
      // Only a collision: nothing was filed, so the report names no Collection.
      expect(report.collection).toBeUndefined();
      const next = await applyCollisionChoices({ client, library }, report, {
        [report.collisions[0].id]: "replace",
      });
      expect(next.collection).toBe("Library");
      const replaced = shelf()[0];
      expect(replaced.id).not.toBe(old.id);
      const collections = storage.get(COLLECTIONS_KEY) as Collection[];
      expect(collections.map((item) => [item.name, item.documentIds])).toEqual([
        ["Eliot", [replaced.id]],
        ["Library", [replaced.id]],
      ]);
    } finally {
      await host.stop();
    }
  });

  it("Replace adds the file as its own Document when the old one left the Shelf meanwhile", async () => {
    const ctx = setup();
    const { host, client, library, pickFolder, shelf } = ctx;
    try {
      const old = await shelfWithMiddlemarch(ctx);
      const report = await runImport(
        { client, library },
        await pickFolder([
          { name: "middlemarch-2.epub", bytes: metaEpub("Middlemarch", "George Eliot", "second") },
        ]),
        folder
      );
      await library.removeFromShelf(old.id);
      expect(await library.replaceDocument(old.id, { ...old, id: "other" })).toBe(false);
      const next = await applyCollisionChoices({ client, library }, report, {
        [report.collisions[0].id]: "replace",
      });
      expect(next.added).toEqual(["middlemarch-2.epub"]);
      expect(shelf().map((row) => row.fingerprint)).toEqual([report.collisions[0].fingerprint]);
    } finally {
      await host.stop();
    }
  });

  it("names a file whose choice could not be applied as unreadable and lets its grant go", async () => {
    const ctx = setup();
    const { host, client, library, pickFolder, storage } = ctx;
    try {
      await shelfWithMiddlemarch(ctx);
      const report = await runImport(
        { client, library },
        await pickFolder([
          { name: "middlemarch-2.epub", bytes: metaEpub("Middlemarch", "George Eliot", "second") },
        ]),
        folder
      );
      const grant = report.collisions[0].file.grant;
      // A Shelf that no longer parses as a list fails the write the choice needs.
      const failing = { ...library, updateShelf: () => Promise.reject(new Error("refused")) };
      const next = await applyCollisionChoices({ client, library: failing }, report, {
        [report.collisions[0].id]: "keep",
      });
      expect(next.unreadable).toEqual([{ name: "middlemarch-2.epub", reason: "unreadable" }]);
      expect(next.collisions).toEqual([]);
      expect((await client.files.list()).map((item) => item.grant)).not.toContain(grant);
      expect(storage.get(SHELF_KEY)).toHaveLength(1);
    } finally {
      await host.stop();
    }
  });

  it("fileInCollection writes nothing for a blank name or ids not on the Shelf", async () => {
    const { host, library, storage } = setup();
    try {
      await library.fileInCollection("   ", ["doc-1"]);
      await library.fileInCollection("Library", ["not-on-shelf"]);
      expect(storage.has(COLLECTIONS_KEY)).toBe(false);
    } finally {
      await host.stop();
    }
  });

  it("does not file anything when the author left the option off", async () => {
    const { host, client, library, pickFolder, storage } = setup();
    try {
      await runImport(
        { client, library },
        await pickFolder([{ name: "Emma.epub", bytes: metaEpub("Emma", "Jane Austen") }]),
        folder
      );
      expect(storage.has(COLLECTIONS_KEY)).toBe(false);
    } finally {
      await host.stop();
    }
  });
});

describe("createImporter() collisions (#949)", () => {
  it("applies only when every collision has a choice, and apply to all sets every row", async () => {
    const ctx = setup();
    const { host, client, library, pickFiles, pickFolder, shelf } = ctx;
    try {
      await runImport(
        { client, library },
        await pickFiles([
          { name: "a.epub", bytes: metaEpub("Middlemarch", "George Eliot", "a") },
          { name: "b.epub", bytes: metaEpub("Dracula", "Bram Stoker", "a") },
        ]),
        { kind: "files" }
      );
      const importer = createImporter({ client, library });
      importer.start(
        await pickFolder([
          { name: "a2.epub", bytes: metaEpub("Middlemarch", "George Eliot", "b") },
          { name: "b2.epub", bytes: metaEpub("Dracula", "Bram Stoker", "b") },
        ]),
        { kind: "folder", name: "Library" }
      );
      await importer.idle();
      const [first, second] = importer.state?.report.collisions ?? [];
      expect(second).toBeDefined();

      // One choice missing: nothing applies, dismiss and a new Import are refused.
      expect(await importer.resolve({ [first.id]: "skip" })).toBe(false);
      importer.dismiss();
      expect(importer.state?.report.collisions).toHaveLength(2);
      expect(importer.start([], { kind: "files" })).toBe(false);

      // Apply to all is every row with the same choice.
      expect(await importer.resolve({ [first.id]: "keep", [second.id]: "keep" })).toBe(true);
      expect(importer.state?.report.collisions).toEqual([]);
      expect(shelf()).toHaveLength(4);
      importer.dismiss();
      expect(importer.state).toBeNull();
    } finally {
      await host.stop();
    }
  });
});
