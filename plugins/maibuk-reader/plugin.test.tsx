/**
 * Reader's Shelf (#653) through the supported Plugin test kit: the real broker,
 * File Grant fakes, and Remote UI renderer. Every action is reached with
 * `user-event` key presses and asserted by what the host drew and stored, never
 * by checking attributes. `index.tsx` (the Worker bootstrap) is never imported.
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import { format } from "./i18n";
import en from "./locales/runtime/en.json";
import { DOCUMENT_PAGE_ID, OPEN_READER, SHELF_PAGE_ID, startReader } from "./runtime";
import {
  CURRENT_DOCUMENT_KEY,
  SHELF_KEY,
  fingerprint,
  positionKey,
  type ShelfEntry,
} from "./shelf";
import {
  epubBytes,
  pdfBytes,
  readerManifest,
  readerStorage,
  shelfEntry,
  tabTo,
} from "./test-support";

function hostFor(
  options: { files?: { name: string; bytes: Uint8Array }[]; storage?: Map<string, unknown> } = {}
) {
  const storage = options.storage ?? readerStorage();
  const host = createTestHost({
    manifest: readerManifest(),
    storage,
    files: options.files,
  });
  startReader(createPluginClient(host.port), servePluginUi);
  return { host, storage };
}

/** A Shelf row whose Fingerprint matches the seeded file exactly. */
async function seededEntry(bytes: Uint8Array, id = "doc-1"): Promise<ShelfEntry> {
  const print = await fingerprint(bytes.length, bytes, bytes);
  return shelfEntry({
    id,
    grant: "grant-1",
    fingerprint: print,
    title: "Dune",
    progress: { page: 42, pageCount: 210 },
  });
}

describe("Reader Shelf", () => {
  it("opens a picked file from the keyboard and lands on the Frame page", async () => {
    const { host } = hostFor();
    try {
      host.files.queuePick({ name: "Dune.pdf", bytes: pdfBytes("a PDF") });
      const page = await host.renderPage(SHELF_PAGE_ID);
      expect(await screen.findByText(en["shelf.emptyTitle"])).toBeInTheDocument();

      const user = userEvent.setup();
      const open = screen.getByRole("button", { name: en["shelf.openFile"] });
      await tabTo(user, open);
      expect(open).toHaveFocus();
      await user.keyboard("{Enter}");

      expect(await screen.findByText("Dune")).toBeInTheDocument();
      await waitFor(() =>
        expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-reader", pageId: "document" }])
      );
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("removes a Document from the keyboard, releasing its File Grant", async () => {
    const bytes = pdfBytes("a PDF to forget");
    const storage = readerStorage();
    storage.set(SHELF_KEY, [await seededEntry(bytes)]);
    storage.set(positionKey("doc-1"), { page: 42, pageCount: 210 });
    const { host } = hostFor({ files: [{ name: "Dune.pdf", bytes }], storage });
    try {
      const page = await host.renderPage(SHELF_PAGE_ID);
      expect(await screen.findByText("Dune")).toBeInTheDocument();

      const user = userEvent.setup();
      const remove = screen.getByRole("button", { name: en["shelf.remove"] });
      await tabTo(user, remove);
      expect(remove).toHaveFocus();
      await user.keyboard("{Enter}");

      expect(await screen.findByText(en["shelf.emptyTitle"])).toBeInTheDocument();
      expect(screen.queryByText("Dune")).not.toBeInTheDocument();
      await waitFor(async () => expect(await host.files.grants()).toEqual([]));
      expect(storage.get(SHELF_KEY)).toEqual([]);
      expect(storage.has(positionKey("doc-1"))).toBe(false);
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("lays the Shelf out as a grid of covers with icon-only actions", async () => {
    const bytes = pdfBytes("a grid of one");
    const storage = readerStorage();
    storage.set(SHELF_KEY, [await seededEntry(bytes)]);
    const { host } = hostFor({ files: [{ name: "Dune.pdf", bytes }], storage });
    try {
      const page = await host.renderPage(SHELF_PAGE_ID);
      const open = await screen.findByRole("button", { name: en["shelf.open"] });
      const remove = screen.getByRole("button", { name: en["shelf.remove"] });
      for (const button of [open, remove]) expect(button.textContent?.trim()).toBe("");
      const surface = open.closest("[data-plugin-ui]");
      expect(surface?.querySelector("style")?.textContent).toMatch(/display:\s*grid/);
      expect(surface?.querySelector("ul li")).toContainElement(open);
      // The cover is a button too, named by the title, and opens the Document.
      const cover = surface?.querySelector("li > button:first-child") as HTMLElement;
      expect(cover).not.toBeNull();
      await userEvent.setup().click(cover);
      await waitFor(() =>
        expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-reader", pageId: "document" }])
      );
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("locates a Missing Document again from the keyboard, keeping its Reading Position", async () => {
    const bytes = pdfBytes("the file that moved");
    const storage = readerStorage();
    const entry = await seededEntry(bytes);
    storage.set(SHELF_KEY, [entry]);
    storage.set(positionKey("doc-1"), { page: 42, pageCount: 210 });
    const { host } = hostFor({ files: [{ name: "Dune.pdf", bytes }], storage });
    try {
      host.files.setMissing("grant-1");
      host.files.queuePick({ name: "Dune.pdf", bytes });

      const page = await host.renderPage(SHELF_PAGE_ID);
      expect(await screen.findByText(en["shelf.status.missing"])).toBeInTheDocument();

      const user = userEvent.setup();
      const locate = screen.getByRole("button", { name: en["shelf.locate"] });
      await tabTo(user, locate);
      expect(locate).toHaveFocus();
      await user.keyboard("{Enter}");

      await waitFor(() =>
        expect(screen.queryByText(en["shelf.status.missing"])).not.toBeInTheDocument()
      );
      expect(screen.getByRole("button", { name: en["shelf.open"] })).toBeInTheDocument();

      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf).toHaveLength(1);
      expect(shelf[0]).toMatchObject({ id: "doc-1", state: "ok", grant: "grant-1" });
      expect(storage.get(positionKey("doc-1"))).toEqual({ page: 42, pageCount: 210 });
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("opens the Shelf from its navigating Command", async () => {
    const { host } = hostFor();
    try {
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: OPEN_READER });
      expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-reader", pageId: SHELF_PAGE_ID }]);
    } finally {
      await host.stop();
    }
  });
});

// The author drops files from their device onto the Shelf or an open Document
// (#828): each supported file lands on the Shelf like a pick, the first opens,
// and the files Reader cannot open are reported once with the count.
describe("Reader file drop", () => {
  type Host = ReturnType<typeof hostFor>["host"];

  /** Opens the Shelf page and waits for it to finish loading, so Reader has subscribed. */
  async function shelfPage(host: Host, text: string) {
    const page = await host.renderPage(SHELF_PAGE_ID);
    expect(await screen.findByText(text)).toBeInTheDocument();
    return page;
  }

  it("adds a dropped file to the Shelf and opens its Document", async () => {
    const { host, storage } = hostFor();
    try {
      const page = await shelfPage(host, en["shelf.emptyTitle"]);

      await expect(
        host.files.drop(SHELF_PAGE_ID, [{ name: "Dune.pdf", bytes: pdfBytes("a dropped PDF") }])
      ).resolves.toBe(true);

      await waitFor(() =>
        expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-reader", pageId: "document" }])
      );
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf).toHaveLength(1);
      expect(shelf[0]).toMatchObject({ title: "Dune", format: "pdf", state: "ok" });
      expect(await host.files.grants()).toHaveLength(1);
      expect(host.notifications).toEqual([]);
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("opens the existing Document for a file already on the Shelf, with no duplicate", async () => {
    const bytes = pdfBytes("already on the shelf");
    const storage = readerStorage();
    storage.set(SHELF_KEY, [await seededEntry(bytes)]);
    const { host } = hostFor({ files: [{ name: "Dune.pdf", bytes }], storage });
    try {
      const page = await shelfPage(host, "Dune");

      await host.files.drop(SHELF_PAGE_ID, [{ name: "Dune.pdf", bytes }]);

      await waitFor(() =>
        expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-reader", pageId: "document" }])
      );
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf).toHaveLength(1);
      expect(shelf[0]).toMatchObject({ id: "doc-1", grant: "grant-1", state: "ok" });
      expect(host.notifications).toEqual([]);
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("adds every file in a multi-file drop and opens the first", async () => {
    const { host, storage } = hostFor();
    try {
      const page = await shelfPage(host, en["shelf.emptyTitle"]);

      await host.files.drop(SHELF_PAGE_ID, [
        { name: "Dune.pdf", bytes: pdfBytes("the first file") },
        { name: "Emma.epub", bytes: epubBytes("the second file") },
      ]);

      await waitFor(() => expect(host.pageNavigations).toHaveLength(1));
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf.map((entry) => entry.title).sort()).toEqual(["Dune", "Emma"]);
      const first = shelf.find((entry) => entry.title === "Dune");
      expect(storage.get(CURRENT_DOCUMENT_KEY)).toBe(first?.id);
      expect(host.notifications).toEqual([]);
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("releases an unsupported file, reports it once, and opens nothing", async () => {
    const { host, storage } = hostFor();
    try {
      const page = await shelfPage(host, en["shelf.emptyTitle"]);

      await host.files.drop(SHELF_PAGE_ID, [
        { name: "notes.docx", bytes: new TextEncoder().encode("notes, not a book") },
      ]);

      await waitFor(() => expect(host.notifications).toHaveLength(1));
      expect(host.notifications).toEqual([
        { variant: "error", message: en["shelf.dropSkipped.one"] },
      ]);
      expect(host.pageNavigations).toEqual([]);
      expect(await host.files.grants()).toEqual([]);
      expect(storage.get(SHELF_KEY)).toEqual([]);
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("counts every unsupported file in one notification and opens nothing", async () => {
    const { host } = hostFor();
    try {
      const page = await shelfPage(host, en["shelf.emptyTitle"]);

      await host.files.drop(SHELF_PAGE_ID, [
        { name: "notes.docx", bytes: new TextEncoder().encode("notes") },
        { name: "photo.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]) },
      ]);

      await waitFor(() => expect(host.notifications).toHaveLength(1));
      expect(host.notifications).toEqual([
        {
          variant: "error",
          message: format(en["shelf.dropSkipped.other"], { count: 2 }),
        },
      ]);
      expect(host.pageNavigations).toEqual([]);
      expect(await host.files.grants()).toEqual([]);
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("reattaches a Missing Document and keeps its Reading Position", async () => {
    const bytes = pdfBytes("the file that moved");
    const storage = readerStorage();
    storage.set(SHELF_KEY, [await seededEntry(bytes)]);
    storage.set(positionKey("doc-1"), { page: 42, pageCount: 210 });
    const { host } = hostFor({ files: [{ name: "Dune.pdf", bytes }], storage });
    try {
      host.files.setMissing("grant-1");
      const page = await shelfPage(host, en["shelf.status.missing"]);

      await host.files.drop(SHELF_PAGE_ID, [{ name: "Dune.pdf", bytes }]);

      await waitFor(() =>
        expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-reader", pageId: "document" }])
      );
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf).toHaveLength(1);
      expect(shelf[0]).toMatchObject({ id: "doc-1", state: "ok", grant: "grant-1" });
      expect(storage.get(positionKey("doc-1"))).toEqual({ page: 42, pageCount: 210 });
      expect(host.notifications).toEqual([]);
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("opens a Document dropped on the Document page", async () => {
    const { host, storage } = hostFor();
    try {
      const page = await shelfPage(host, en["shelf.emptyTitle"]);

      await host.files.drop(DOCUMENT_PAGE_ID, [{ name: "Emma.epub", bytes: epubBytes() }]);

      await waitFor(() =>
        expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-reader", pageId: "document" }])
      );
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf.map((entry) => entry.title)).toEqual(["Emma"]);
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("handles two quick drops in order, leaving the second Document open", async () => {
    const { host, storage } = hostFor();
    try {
      const page = await shelfPage(host, en["shelf.emptyTitle"]);

      const first = host.files.drop(SHELF_PAGE_ID, [
        { name: "Dune.pdf", bytes: pdfBytes("the first drop") },
      ]);
      const second = host.files.drop(SHELF_PAGE_ID, [
        { name: "Emma.epub", bytes: epubBytes("the second drop") },
      ]);
      await Promise.all([first, second]);

      await waitFor(() => expect(host.pageNavigations).toHaveLength(2));
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf.map((entry) => entry.title).sort()).toEqual(["Dune", "Emma"]);
      const last = shelf.find((entry) => entry.title === "Emma");
      expect(storage.get(CURRENT_DOCUMENT_KEY)).toBe(last?.id);
      expect(host.notifications).toEqual([]);
      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});
