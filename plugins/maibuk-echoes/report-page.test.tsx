/**
 * The Echoes report page (#450, unit 3) through the supported Plugin test kit:
 * the header selects, the three kind tabs, expandable rows with occurrences,
 * the row Item Menu, and the out-of-date notice — every path driven by
 * `user-event` key presses over the real Remote UI renderer.
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "@/i18n";
import { createTestHost } from "@/features/plugins/test-kit";
import type { TestChapter } from "@/features/plugins/types";
import { createPluginClient } from "@/plugin-sdk";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import { DEFAULT_ECHO_SETTINGS, findEchoes } from "./find-echoes";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import { buildReport, occurrenceContext } from "./report";
import { FIND_ECHOES, REPORT_PAGE_ID, startEchoes } from "./runtime";
import { ECHOES_SETTINGS_KEY } from "./settings";
import { echoesManifest, settingsStorage, tabTo, type User } from "./test-support";

const HARBOR =
  "The harbor was calm. The harbor was empty. The harbor was quiet. We left the harbor at dawn.";
const SHORE = "The shore was far. The shore was cold. The shore was ours.";
const GARDEN = "The garden was still. The garden was green. The garden was ours.";

function book(id: string, title: string) {
  return {
    id,
    title,
    subtitle: null,
    authorName: "Maibuk",
    language: "en",
    wordCount: 0,
    updatedAt: 0,
  };
}

function chapter(id: string, bookId: string, title: string, order: number, text: string): TestChapter {
  return {
    id,
    bookId,
    title,
    order,
    parentId: null,
    wordCount: text.split(/\s+/).length,
    updatedAt: 0,
    content: { text, html: `<p>${text}</p>` },
  };
}

const BOOKS = [book("b1", "Dune"), book("b2", "Emma")];
const CHAPTERS = [
  chapter("c1", "b1", "Chapter One", 0, HARBOR),
  chapter("c2", "b1", "Chapter Two", 1, SHORE),
  chapter("c3", "b2", "Chapter One", 0, GARDEN),
];

/** A host whose Library serves the two Books, over one Plugin instance. */
function reportHost(storage = settingsStorage()) {
  const host = createTestHost({
    manifest: echoesManifest(),
    library: { books: BOOKS, chapters: CHAPTERS },
    storage,
  });
  startEchoes(createPluginClient(host.port), servePluginUi);
  return host;
}

/** Focuses a select's trigger and picks a value by arrow keys, never a pointer. */
async function pickOption(user: User, label: string, option: string): Promise<void> {
  const trigger = screen.getByLabelText(label);
  await tabTo(user, trigger);
  await user.keyboard("{Enter}");
  await screen.findByRole("listbox");
  const target = screen.getByRole("option", { name: option });
  while (document.activeElement !== target) await user.keyboard("{ArrowDown}");
  await user.keyboard("{Enter}");
}

describe("Echoes report page", () => {
  it("opens on the first Book, Whole Book scope, with the detected rows", async () => {
    const host = reportHost();
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);

      expect(await screen.findByRole("tab", { name: en["tab.nearby"] })).toBeInTheDocument();
      expect(screen.getByLabelText(en["report.book"])).toHaveTextContent("Dune");
      expect(screen.getByLabelText(en["report.scope"])).toHaveTextContent(en.wholeBook);

      // Rows are ordered by count descending: harbor (4) before shore (3).
      const rows = await screen.findAllByRole("option");
      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringContaining("harbor"),
        expect.stringContaining("shore"),
      ]);

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("shows one row per word, so no two options share a name in a tab", async () => {
    // "harbor" echoes in both Chapters; the report shows it as one Whole Book
    // row listing both, never two rows that a listbox would confuse.
    const host = createTestHost({
      manifest: echoesManifest(),
      library: {
        books: [book("b1", "Dune")],
        chapters: [
          chapter("c1", "b1", "Chapter One", 0, "The harbor was calm. The harbor was empty."),
          chapter("c2", "b1", "Chapter Two", 1, "The harbor was far. The harbor was cold."),
        ],
      },
    });
    startEchoes(createPluginClient(host.port), servePluginUi);
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);
      const user = userEvent.setup();

      const harborRows = (await screen.findAllByRole("option")).filter((option) =>
        /^harbor/.test(option.textContent ?? "")
      );
      expect(harborRows).toHaveLength(1);
      expect(harborRows[0]).toHaveTextContent("4 times");
      // The row names its Chapters by title, in Chapter order.
      expect(harborRows[0]).toHaveTextContent("Chapter One, Chapter Two");

      // No two rows in a tab share a name, on the nearby tab and the phrase tab.
      const names = () => screen.getAllByRole("option").map((option) => option.textContent);
      expect(new Set(names()).size).toBe(names().length);

      const nearby = screen.getByRole("tab", { name: en["tab.nearby"] });
      await tabTo(user, nearby);
      expect(nearby).toHaveFocus();
      // Await each tab between the arrows, so the panel settles before the next key.
      await user.keyboard("{ArrowRight}");
      await screen.findByText(en["empty.overused"]);
      await user.keyboard("{ArrowRight}");
      await screen.findByRole("option", { name: /The harbor was/ });
      expect(new Set(names()).size).toBe(names().length);

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("switches tabs with the arrow keys", async () => {
    const host = reportHost();
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);
      const user = userEvent.setup();

      const nearby = await screen.findByRole("tab", { name: en["tab.nearby"] });
      await tabTo(user, nearby);
      expect(nearby).toHaveFocus();

      // The arrow changes what the visible panel shows, not just an attribute:
      // the overused tab's empty line replaces the nearby tab's rows.
      await user.keyboard("{ArrowRight}");
      expect(await screen.findByText(en["empty.overused"])).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /harbor/ })).not.toBeInTheDocument();

      await user.keyboard("{ArrowRight}");
      expect(await screen.findByRole("option", { name: /The harbor was/ })).toBeInTheDocument();
      expect(screen.queryByText(en["empty.overused"])).not.toBeInTheDocument();

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("changes rows when the Book or the scope changes", async () => {
    const host = reportHost();
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);
      const user = userEvent.setup();
      await screen.findByRole("option", { name: /harbor/ });

      // Narrow the scope to one Chapter: the other Chapter's row is gone.
      await pickOption(user, en["report.scope"], "Chapter One");
      await waitFor(() =>
        expect(screen.queryByRole("option", { name: /shore/ })).not.toBeInTheDocument()
      );
      expect(screen.getByRole("option", { name: /harbor/ })).toBeInTheDocument();

      // Switch to the other Book: its own Echo appears.
      await pickOption(user, en["report.book"], "Emma");
      expect(await screen.findByRole("option", { name: /garden/ })).toBeInTheDocument();

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("expands a row with the keyboard and opens an occurrence's Chapter", async () => {
    const host = reportHost();
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);
      const user = userEvent.setup();

      const row = await screen.findByRole("option", { name: /harbor/ });
      await tabTo(user, row);
      expect(row).toHaveFocus();
      await user.keyboard("{Enter}");

      // The occurrences are listed after the row; Arrow moves onto the first.
      await user.keyboard("{ArrowDown}");
      await user.keyboard("{Enter}");

      const expected = buildReport(
        findEchoes([HARBOR, SHORE], "en", DEFAULT_ECHO_SETTINGS),
        [HARBOR, SHORE]
      ).nearby[0].occurrences[0];
      await waitFor(() =>
        expect(host.navigations).toEqual([
          {
            entity: { kind: "chapter", id: "c1" },
            reveal: { from: expected.from, to: expected.to },
          },
        ])
      );

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("labels an occurrence with its context and describes it with the Chapter title", async () => {
    const host = reportHost();
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);
      const user = userEvent.setup();

      const row = await screen.findByRole("option", { name: /harbor/ });
      await tabTo(user, row);
      await user.keyboard("{Enter}");

      // The echoed word alone would repeat row after row, so the label is the
      // context around that occurrence and the description is its Chapter.
      const occurrences = buildReport(
        findEchoes([HARBOR, SHORE], "en", DEFAULT_ECHO_SETTINGS),
        [HARBOR, SHORE]
      ).nearby[0].occurrences;
      const options = screen.getAllByRole("option").slice(1, 1 + occurrences.length); // the harbor row's occurrences
      expect(options).toHaveLength(occurrences.length);
      occurrences.forEach((occurrence, index) => {
        expect(options[index]).toHaveTextContent(occurrenceContext(HARBOR, occurrence));
        expect(options[index]).toHaveTextContent("Chapter One");
      });

      // Every occurrence's accessible name still tells it apart from the rest.
      const names = screen.getAllByRole("option").map((option) => option.textContent);
      expect(new Set(names).size).toBe(names.length);

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("ignores a word from the row Item Menu with the keyboard and removes the row", async () => {
    const storage = settingsStorage();
    const host = reportHost(storage);
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);
      const user = userEvent.setup();

      const row = await screen.findByRole("option", { name: /harbor/ });
      await tabTo(user, row);
      // The row is one Tab stop; Tab reaches its ⋯ Item Menu button.
      await user.tab();
      const more = screen.getByRole("button", { name: "More actions for harbor" });
      expect(more).toHaveFocus();
      await user.keyboard("{Enter}");

      const item = await screen.findByRole("menuitem", { name: en.ignore });
      expect(item).toHaveFocus();
      await user.keyboard("{Enter}");

      await waitFor(() =>
        expect(storage.get(ECHOES_SETTINGS_KEY)).toMatchObject({ ignore: ["harbor"] })
      );
      expect(screen.queryByRole("option", { name: /harbor/ })).not.toBeInTheDocument();

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("marks the report out of date on a touching change, keeps its rows, and recomputes on Refresh", async () => {
    const host = reportHost();
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);
      const user = userEvent.setup();
      await screen.findByRole("option", { name: /harbor/ });
      const before = screen.getAllByRole("option").map((row) => row.textContent);

      await waitFor(() =>
        expect(
          host.broker.emit("library.changed", {
            entity: "book",
            id: "b1",
            origin: "local",
            kind: "content",
          })
        ).toBe(true)
      );

      expect(await screen.findByText(en.stale)).toBeInTheDocument();
      expect(screen.getAllByRole("option").map((row) => row.textContent)).toEqual(before);

      const refresh = screen.getByRole("button", { name: en.refresh });
      await tabTo(user, refresh);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(screen.queryByText(en.stale)).not.toBeInTheDocument());

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("does not mark the report out of date for another Book", async () => {
    const host = reportHost();
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);
      await screen.findByRole("option", { name: /harbor/ });

      await waitFor(() =>
        expect(
          host.broker.emit("library.changed", {
            entity: "book",
            id: "b2",
            origin: "local",
            kind: "content",
          })
        ).toBe(true)
      );
      expect(screen.queryByText(en.stale)).not.toBeInTheDocument();

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("lands on a Chapter's scope when Find echoes was run on it", async () => {
    const host = reportHost();
    try {
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, {
        id: FIND_ECHOES,
        target: { kind: "chapter", id: "c1" },
      });
      const page = await host.renderPage(REPORT_PAGE_ID);

      await waitFor(() =>
        expect(screen.getByLabelText(en["report.scope"])).toHaveTextContent("Chapter One")
      );
      expect(await screen.findByRole("option", { name: /harbor/ })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /shore/ })).not.toBeInTheDocument();

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("keeps every kind tab and says a disabled kind is off in Settings", async () => {
    const storage = settingsStorage();
    storage.set(ECHOES_SETTINGS_KEY, { phrases: false });
    const host = reportHost(storage);
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);
      const user = userEvent.setup();

      // The three tabs are always drawn; the disabled kind keeps its tab.
      const nearby = await screen.findByRole("tab", { name: en["tab.nearby"] });
      const phrase = screen.getByRole("tab", { name: en["tab.phrase"] });
      expect(screen.getByRole("tab", { name: en["tab.overused"] })).toBeInTheDocument();

      await tabTo(user, nearby);
      await user.keyboard("{ArrowRight}");
      await user.keyboard("{ArrowRight}");
      expect(phrase).toHaveFocus();

      // Its panel says the check is off rather than showing an empty list.
      expect(await screen.findByText(en["kind.off"])).toBeInTheDocument();

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("claims limited support only for a Book language without stop words or a stemmer", async () => {
    for (const language of ["en", "es"]) {
      const host = createTestHost({
        manifest: echoesManifest(),
        library: {
          books: [{ ...book("b1", "Dune"), language }],
          chapters: [chapter("c1", "b1", "Chapter One", 0, HARBOR)],
        },
      });
      startEchoes(createPluginClient(host.port), servePluginUi);
      try {
        const page = await host.renderPage(REPORT_PAGE_ID);
        await screen.findByRole("option", { name: /harbor/ });
        expect(screen.queryByText(/Limited support/)).not.toBeInTheDocument();
        page.unmount();
      } finally {
        host.stop();
      }
    }

    const host = createTestHost({
      manifest: echoesManifest(),
      library: {
        books: [{ ...book("b1", "Dune"), language: "fr" }],
        chapters: [chapter("c1", "b1", "Chapter One", 0, HARBOR)],
      },
    });
    startEchoes(createPluginClient(host.port), servePluginUi);
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);
      expect(await screen.findByText("Limited support for fr")).toBeInTheDocument();
      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("honours the stored ignore list", async () => {
    const storage = settingsStorage();
    storage.set(ECHOES_SETTINGS_KEY, { ignore: ["harbor"] });
    const host = reportHost(storage);
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);

      expect(await screen.findByRole("option", { name: /shore/ })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /harbor/ })).not.toBeInTheDocument();

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("renders the tab names in the app language after a switch", async () => {
    const host = createTestHost({
      manifest: echoesManifest(),
      library: { books: BOOKS, chapters: CHAPTERS },
      language: "en",
    });
    startEchoes(createPluginClient(host.port), servePluginUi);
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);
      expect(await screen.findByRole("tab", { name: en["tab.nearby"] })).toBeInTheDocument();

      await waitFor(() => host.setLanguage("es"));
      expect(await screen.findByRole("tab", { name: es["tab.nearby"] })).toBeInTheDocument();

      page.unmount();
    } finally {
      host.stop();
    }
  });
});
