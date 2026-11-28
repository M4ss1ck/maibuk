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
import { runImport, type ImportReport } from "./import";
import { createShelfService } from "./library";
import { SHELF_KEY, SUPPORTED_EXTENSIONS, positionKey, type ShelfEntry } from "./shelf";
import { epubBytes, pdfBytes, readerManifest } from "./test-support";

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
  it("adds every readable file, titled after its name, with its cover pending", async () => {
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
          .map((entry) => [entry.title, entry.format, entry.coverPending])
          .sort()
      ).toEqual([
        ["Dune", "pdf", true],
        ["Emma", "epub", true],
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
      expect(shelf().map((entry) => entry.title)).toEqual(["Fine"]);
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
