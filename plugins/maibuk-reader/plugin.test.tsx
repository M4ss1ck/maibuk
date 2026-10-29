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
import en from "./locales/runtime/en.json";
import { OPEN_READER, SHELF_PAGE_ID, startReader } from "./runtime";
import { SHELF_KEY, fingerprint, positionKey, type ShelfEntry } from "./shelf";
import { pdfBytes, readerManifest, readerStorage, shelfEntry, tabTo } from "./test-support";

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
      page.unmount();
    } finally {
      host.stop();
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
      page.unmount();
    } finally {
      host.stop();
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
      page.unmount();
    } finally {
      host.stop();
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
      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("opens the Shelf from its navigating Command", async () => {
    const { host } = hostFor();
    try {
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: OPEN_READER });
      expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-reader", pageId: SHELF_PAGE_ID }]);
    } finally {
      host.stop();
    }
  });
});
