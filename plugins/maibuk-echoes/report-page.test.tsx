/**
 * The Echoes report page (#450, unit 3) through the supported Plugin test kit:
 * the header selects, the three kind tabs, expandable rows with occurrences,
 * the row Item Menu, and the out-of-date notice — every path driven by
 * `user-event` key presses over the real Remote UI renderer.
 */

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "@/i18n";
import { createTestHost } from "@/features/plugins/test-kit";
import type { TestChapter } from "@/features/plugins/types";
import { createPluginClient } from "@/plugin-sdk";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import { DEFAULT_ECHO_SETTINGS, findEchoes } from "./find-echoes";
import { format } from "./i18n";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import { buildReport, occurrenceContext } from "./report";
import { FIND_ECHOES, REPORT_PAGE_ID, startEchoes } from "./runtime";
import { ECHOES_SETTINGS_KEY } from "./settings";
import { echoesManifest, settingsStorage, shiftTabTo, tabTo, type User } from "./test-support";

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

function chapter(
  id: string,
  bookId: string,
  title: string,
  order: number,
  text: string
): TestChapter {
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

/**
 * Consonant-only four-letter words, one per index: detection skips words under
 * four letters, and with no vowels no stemmer folds two of them into one.
 */
const CODE_LETTERS = "bcdfghjklmnpqrtvwxz";
function codeWord(index: number): string {
  let rest = index;
  let word = "";
  for (let place = 0; place < 4; place++) {
    word += CODE_LETTERS[rest % CODE_LETTERS.length];
    rest = Math.floor(rest / CODE_LETTERS.length);
  }
  return word;
}

/** 250 words, each echoed within a few words: well past one page of nearby rows. */
const SPREAD = Array.from({ length: 250 }, (_, index) => {
  const word = codeWord(index);
  return `${word} zq ${word} vk`;
}).join(" ");
/** One word echoed 450 times, so one expanded row has more occurrences than a page. */
const HARBOR_RUN = Array.from({ length: 450 }, () => "harbor door").join(" ");

/** A Book whose Nearby tab is past one page, and whose harbor row is past one page of occurrences. */
function widePage(): { books: ReturnType<typeof book>[]; chapters: TestChapter[] } {
  return {
    books: [book("b5", "Atlas"), book("b2", "Emma")],
    chapters: [
      chapter("w1", "b5", "Chapter One", 0, SPREAD),
      chapter("w2", "b5", "Chapter Two", 1, HARBOR_RUN),
      CHAPTERS[2],
    ],
  };
}

function wideHost() {
  const { books, chapters } = widePage();
  const host = createTestHost({
    manifest: echoesManifest(),
    library: { books, chapters },
    storage: settingsStorage(),
  });
  startEchoes(createPluginClient(host.port), servePluginUi);
  return host;
}

const WIDE_REPORT = buildReport(findEchoes([SPREAD, HARBOR_RUN], "en", DEFAULT_ECHO_SETTINGS), [
  SPREAD,
  HARBOR_RUN,
]);

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

      const expected = buildReport(findEchoes([HARBOR, SHORE], "en", DEFAULT_ECHO_SETTINGS), [
        HARBOR,
        SHORE,
      ]).nearby[0].occurrences[0];
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
      const occurrences = buildReport(findEchoes([HARBOR, SHORE], "en", DEFAULT_ECHO_SETTINGS), [
        HARBOR,
        SHORE,
      ]).nearby[0].occurrences;
      // The expanded rows arrive over the Remote UI connection, a tick later.
      await waitFor(() =>
        expect(screen.getAllByRole("option").length).toBeGreaterThan(occurrences.length)
      );
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

  it("keeps a row that echoes across many long-titled Chapters inside the host's limits", async () => {
    // A word in 60 Chapters once listed every title in the row description,
    // past the host's 1024-character cap: the host refused the declaration and
    // stopped Echoes with "declared an interface Maibuk could not accept".
    const many = Array.from({ length: 60 }, (_, index) =>
      chapter(
        `m${index}`,
        "b3",
        `A rather long working title for planning chapter number ${index + 1}`,
        index,
        "The lantern swung. The lantern dimmed. The lantern went out."
      )
    );
    const host = createTestHost({
      manifest: echoesManifest(),
      library: { books: [book("b3", "Notebook")], chapters: many },
      storage: settingsStorage(),
    });
    startEchoes(createPluginClient(host.port), servePluginUi);
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);

      const row = await screen.findByRole("option", { name: /lantern/ });
      expect(page.violations).toEqual([]);
      expect(row).toHaveTextContent(
        "180 times · A rather long working title for planning chapter number 1,"
      );
      expect(row).toHaveTextContent(/, \+\d+ more$/);

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("lists every Chapter of a 250-Chapter Book in the scope picker", async () => {
    // The host once capped option lists at 200, so the scope picker of a long
    // Book was refused and Echoes stopped before drawing a row.
    const long = Array.from({ length: 250 }, (_, index) =>
      chapter(`d${index}`, "b4", `Day ${index + 1}`, index, "The kettle sang. The kettle cooled.")
    );
    const host = createTestHost({
      manifest: echoesManifest(),
      library: { books: [book("b4", "Journal")], chapters: long },
      storage: settingsStorage(),
    });
    startEchoes(createPluginClient(host.port), servePluginUi);
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);
      const user = userEvent.setup();

      // Loading yields between Chapters, so 250 of them take a few frames; a
      // slow poll keeps the role query from starving that loop.
      expect(
        await screen.findByRole("option", { name: /kettle/ }, { timeout: 20_000, interval: 500 })
      ).toBeInTheDocument();
      expect(page.violations).toEqual([]);

      const trigger = screen.getByLabelText(en["report.scope"]);
      await tabTo(user, trigger);
      await user.keyboard("{Enter}");
      const listbox = await screen.findByRole("listbox");
      // Whole Book plus one entry per Chapter.
      expect(within(listbox).getAllByRole("option")).toHaveLength(251);
      expect(within(listbox).getByRole("option", { name: "Day 250" })).toBeInTheDocument();

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

  it("shows the first 200 rows and adds 200 more with the keyboard", async () => {
    // The fixture must actually pass one page, or the cap is never exercised.
    const total = WIDE_REPORT.nearby.length;
    expect(total).toBeGreaterThan(200);
    const host = wideHost();
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);
      const user = userEvent.setup();

      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(200));
      const left = total - 200;
      const more = await screen.findByRole("button", {
        name: format(en["report.showMore"], { count: Math.min(200, left), left }),
      });
      expect(more).toHaveTextContent(`(${left} left)`);

      // Each row's Item Menu button is a Tab stop, so a forward walk to Show more
      // passes the whole page; Shift+Tab from the body reaches it, the last stop.
      await shiftTabTo(user, more, 2);
      expect(more).toHaveFocus();
      await user.keyboard("{Enter}");

      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(Math.min(400, total)));
      expect(screen.queryByRole("button", { name: /left\)$/ })).not.toBeInTheDocument();

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("caps an expanded row's occurrences and shows more with the keyboard", async () => {
    const harbor = WIDE_REPORT.nearby.find((row) => row.label === "harbor");
    expect(harbor).toBeDefined();
    const occurrences = harbor?.occurrences.length ?? 0;
    // Past two pages, so the first press leaves a row behind for the second.
    expect(occurrences).toBeGreaterThan(400);
    const host = wideHost();
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);
      const user = userEvent.setup();

      // Tab reaches the list's first row; Arrow keys move along the list to harbor.
      const options = await screen.findAllByRole("option");
      const row = options.find((option) => /^harbor/.test(option.textContent ?? ""));
      expect(row).toBeDefined();
      await tabTo(user, options[0]);
      for (let step = 0; step < 50 && document.activeElement !== row; step++) {
        await user.keyboard("{ArrowDown}");
      }
      expect(row).toHaveFocus();
      await user.keyboard("{Enter}");

      // The top 200 rows, the first 200 occurrences, and the Show more option.
      const firstMore = format(en["report.showMoreOccurrences"], {
        count: 200,
        left: occurrences - 200,
      });
      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(401));
      const more = screen.getByRole("option", { name: firstMore });

      // Arrow keys walk the 200 occurrences to the Show more option.
      for (let step = 0; step < 500 && document.activeElement !== more; step++) {
        await user.keyboard("{ArrowDown}");
      }
      expect(more).toHaveFocus();
      await user.keyboard("{Enter}");

      // The second press shows 200 more: 400 occurrences, with the rest still left.
      const secondMore = format(en["report.showMoreOccurrences"], {
        count: Math.min(200, occurrences - 400),
        left: occurrences - 400,
      });
      const expectedAfter = 200 + Math.min(400, occurrences) + (occurrences > 400 ? 1 : 0);
      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(expectedAfter));
      expect(screen.getByRole("option", { name: secondMore })).toBeInTheDocument();

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("resets the shown rows when the Book changes", async () => {
    const host = wideHost();
    try {
      const page = await host.renderPage(REPORT_PAGE_ID);
      const user = userEvent.setup();

      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(200));
      const more = await screen.findByRole("button", { name: /left\)$/ });
      // Each row's Item Menu button is a Tab stop, so a forward walk to Show more
      // passes the whole page; Shift+Tab from the body reaches it, the last stop.
      await shiftTabTo(user, more, 2);
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(screen.getAllByRole("option")).toHaveLength(WIDE_REPORT.nearby.length)
      );

      // Switch to the other Book and back: the first tab starts at one page again.
      await pickOption(user, en["report.book"], "Emma");
      expect(await screen.findByRole("option", { name: /garden/ })).toBeInTheDocument();
      // The list opens on Emma, which sits below Atlas, so Arrow Up walks back
      // (pickOption only walks down).
      await tabTo(user, screen.getByLabelText(en["report.book"]));
      await user.keyboard("{Enter}");
      const atlas = await screen.findByRole("option", { name: "Atlas" });
      for (let step = 0; step < 5 && document.activeElement !== atlas; step++) {
        await user.keyboard("{ArrowUp}");
      }
      expect(atlas).toHaveFocus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(200));
      expect(screen.getByRole("button", { name: /left\)$/ })).toBeInTheDocument();

      page.unmount();
    } finally {
      host.stop();
    }
  });
});
