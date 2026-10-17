/**
 * Echoes' Plugin-level behavior (#450, unit 1) through the supported Plugin
 * test kit: the real broker, method table, and Remote UI renderer. The runtime
 * is driven over the polyfill-free `@/plugin-sdk/ui-serve` entry, the same one
 * the kit's jsdom uses; `index.tsx` (the Worker bootstrap) is never imported.
 */

import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "@/i18n";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient, type PluginClient } from "@/plugin-sdk";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import {
  FIND_ECHOES,
  REPORT_PAGE_ID,
  SETTINGS_ROW_ID,
  TOGGLE_HIGHLIGHTS,
  startEchoes,
} from "./runtime";
import { ECHOES_COLOR_KEY, ECHOES_EDITOR_KEY, ECHOES_SETTINGS_KEY } from "./settings";
import { echoesManifest, settingsStorage, shiftTabTo, tabTo } from "./test-support";

const BOOK = {
  id: "b1",
  title: "Dune",
  subtitle: null,
  authorName: "Frank",
  language: "en",
  wordCount: 10,
  updatedAt: 0,
};

const CHAPTER = {
  id: "c1",
  bookId: "b1",
  title: "Chapter One",
  order: 0,
  parentId: null,
  wordCount: 2,
  updatedAt: 1_000,
  content: { text: "Hello", html: "<p>Hello</p>" },
};

describe("Echoes runtime", () => {
  it("activates and answers its Commands, declaring both in the manifest", async () => {
    const host = createTestHost({
      manifest: echoesManifest(),
      library: { books: [BOOK], chapters: [CHAPTER] },
    });
    try {
      startEchoes(createPluginClient(host.port), servePluginUi);
      await expect(host.broker.request("health.check", {})).resolves.toBe("pong");
      expect(host.manifest.contributes?.commands?.map((command) => command.id)).toEqual([
        "openEchoes",
        "findEchoes",
        "toggleHighlights",
        "nextEcho",
        "previousEcho",
      ]);
    } finally {
      host.stop();
    }
  });

  it("Find echoes opens the report scoped to the Chapter the Item Menu targeted", async () => {
    const host = createTestHost({
      manifest: echoesManifest(),
      library: { books: [BOOK], chapters: [CHAPTER] },
    });
    try {
      startEchoes(createPluginClient(host.port), servePluginUi);

      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, {
        id: FIND_ECHOES,
        target: { kind: "chapter", id: "c1" },
      });
      expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-echoes", pageId: REPORT_PAGE_ID }]);

      const page = await host.renderPage(REPORT_PAGE_ID);
      expect(await screen.findByRole("button", { name: /Chapter One/ })).toBeInTheDocument();
      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("opens on the first Book when no scope was stored", async () => {
    const host = createTestHost({
      manifest: echoesManifest(),
      library: { books: [BOOK], chapters: [CHAPTER] },
    });
    try {
      startEchoes(createPluginClient(host.port), servePluginUi);
      const page = await host.renderPage(REPORT_PAGE_ID);
      expect(await screen.findByLabelText(en["report.book"])).toHaveTextContent(BOOK.title);
      expect(await screen.findByRole("tab", { name: en["tab.nearby"] })).toBeInTheDocument();
      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("follows a language switch to es while the report is open", async () => {
    const host = createTestHost({
      manifest: echoesManifest(),
      library: { books: [BOOK], chapters: [CHAPTER] },
      language: "en",
    });
    try {
      startEchoes(createPluginClient(host.port), servePluginUi);

      const page = await host.renderPage(REPORT_PAGE_ID);
      expect(await screen.findByRole("tab", { name: en["tab.nearby"] })).toBeInTheDocument();

      await act(async () => {
        host.setLanguage("es");
      });
      expect(await screen.findByRole("tab", { name: es["tab.nearby"] })).toBeInTheDocument();
      page.unmount();
    } finally {
      host.stop();
    }
  });
});

/**
 * The detection Settings row (#450, unit 2): the Plugin draws it through the
 * host UI kit, so the tests drive it with the keyboard through `createTestHost`
 * and assert the Plugin's storage under its one key.
 */
describe("Echoes detection settings", () => {
  /** A host whose `storage.*` handlers serve `storage`, over one Plugin client. */
  function settingsHost(storage: Map<string, unknown>) {
    const host = createTestHost({ manifest: echoesManifest(), storage });
    startEchoes(createPluginClient(host.port), servePluginUi);
    return host;
  }

  it("toggles each switch with Space and persists it", async () => {
    const storage = settingsStorage();
    const host = settingsHost(storage);
    try {
      const page = await host.renderSettingsRow(SETTINGS_ROW_ID);
      const user = userEvent.setup();
      // Hydration writes the loaded value back under the key; wait for it so the
      // toggles below act on the loaded settings, not the initial defaults.
      await waitFor(() => expect(storage.has(ECHOES_SETTINGS_KEY)).toBe(true));

      for (const [name, key] of [
        ["Nearby echo", "nearby"],
        ["Overused word", "overused"],
        ["Repeated phrase", "phrases"],
      ] as const) {
        const control = screen.getByRole("switch", { name });
        await tabTo(user, control);
        expect(control).toHaveFocus();
        await user.keyboard(" ");
        await waitFor(() =>
          expect(storage.get(ECHOES_SETTINGS_KEY)).toMatchObject({ [key]: false })
        );
      }

      const stemming = screen.getByRole("switch", { name: "Match word forms" });
      await tabTo(user, stemming);
      expect(stemming).toHaveFocus();
      await user.keyboard(" ");
      await waitFor(() =>
        expect(storage.get(ECHOES_SETTINGS_KEY)).toMatchObject({ stemming: false })
      );

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("toggles the editor highlight kinds, nearby only by default", async () => {
    const storage = settingsStorage();
    const host = settingsHost(storage);
    try {
      const page = await host.renderSettingsRow(SETTINGS_ROW_ID);
      const user = userEvent.setup();
      await waitFor(() => expect(storage.has(ECHOES_EDITOR_KEY)).toBe(true));
      expect(storage.get(ECHOES_EDITOR_KEY)).toEqual(["nearby"]);

      const overused = screen.getByRole("switch", { name: "Highlight overused words" });
      expect(overused).not.toBeChecked();
      await tabTo(user, overused);
      expect(overused).toHaveFocus();
      await user.keyboard(" ");
      await waitFor(() => expect(storage.get(ECHOES_EDITOR_KEY)).toEqual(["nearby", "overused"]));

      await user.keyboard(" ");
      await waitFor(() => expect(storage.get(ECHOES_EDITOR_KEY)).toEqual(["nearby"]));
      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("toggles Color highlights by echo with the keyboard, off by default, and persists it", async () => {
    const storage = settingsStorage();
    const host = settingsHost(storage);
    try {
      const page = await host.renderSettingsRow(SETTINGS_ROW_ID);
      const user = userEvent.setup();
      await waitFor(() => expect(storage.has(ECHOES_EDITOR_KEY)).toBe(true));

      const color = screen.getByRole("switch", { name: "Color highlights by echo" });
      expect(color).not.toBeChecked();
      expect(storage.get(ECHOES_COLOR_KEY) ?? false).toBe(false);
      await tabTo(user, color);
      expect(color).toHaveFocus();
      await user.keyboard(" ");
      await waitFor(() => expect(storage.get(ECHOES_COLOR_KEY)).toBe(true));
      expect(color).toBeChecked();

      await user.keyboard(" ");
      await waitFor(() => expect(storage.get(ECHOES_COLOR_KEY)).toBe(false));
      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("clamps an out-of-range nearby window when it is committed", async () => {
    const storage = settingsStorage();
    const host = settingsHost(storage);
    try {
      const page = await host.renderSettingsRow(SETTINGS_ROW_ID);
      const user = userEvent.setup();
      await waitFor(() => expect(storage.has(ECHOES_SETTINGS_KEY)).toBe(true));

      const field = screen.getByRole("textbox", { name: "Nearby window" });
      await tabTo(user, field);
      await user.keyboard("{Control>}a{/Control}500{Enter}");
      await waitFor(() =>
        expect(storage.get(ECHOES_SETTINGS_KEY)).toMatchObject({ nearbyWindow: 200 })
      );
      expect(screen.getByRole("textbox", { name: "Nearby window" })).toHaveValue("200");

      await user.keyboard("{Control>}a{/Control}2{Enter}");
      await waitFor(() =>
        expect(storage.get(ECHOES_SETTINGS_KEY)).toMatchObject({ nearbyWindow: 10 })
      );
      expect(screen.getByRole("textbox", { name: "Nearby window" })).toHaveValue("10");

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("adds a custom ignore word with the keyboard and removes it", async () => {
    const storage = settingsStorage();
    const host = settingsHost(storage);
    try {
      const page = await host.renderSettingsRow(SETTINGS_ROW_ID);
      const user = userEvent.setup();
      await waitFor(() => expect(storage.has(ECHOES_SETTINGS_KEY)).toBe(true));

      const combo = screen.getByRole("combobox", { name: "Ignore list" });
      await tabTo(user, combo, 20);
      await user.keyboard("harbor{Enter}");
      await waitFor(() =>
        expect(storage.get(ECHOES_SETTINGS_KEY)).toMatchObject({ ignore: ["harbor"] })
      );

      const remove = await screen.findByRole("button", { name: "Remove harbor" });
      await shiftTabTo(user, remove);
      expect(remove).toHaveFocus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(storage.get(ECHOES_SETTINGS_KEY)).toMatchObject({ ignore: [] }));

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("restores saved values in a new host over the same storage", async () => {
    const storage = settingsStorage();
    const first = settingsHost(storage);
    const page1 = await first.renderSettingsRow(SETTINGS_ROW_ID);
    try {
      const user = userEvent.setup();
      await waitFor(() => expect(storage.has(ECHOES_SETTINGS_KEY)).toBe(true));

      const stemming = screen.getByRole("switch", { name: "Match word forms" });
      await tabTo(user, stemming);
      await user.keyboard(" ");

      const field = screen.getByRole("textbox", { name: "Nearby window" });
      await tabTo(user, field);
      await user.keyboard("{Control>}a{/Control}120{Enter}");

      const combo = screen.getByRole("combobox", { name: "Ignore list" });
      await tabTo(user, combo, 20);
      await user.keyboard("harbor{Enter}");

      await waitFor(() =>
        expect(storage.get(ECHOES_SETTINGS_KEY)).toMatchObject({
          stemming: false,
          nearbyWindow: 120,
          ignore: ["harbor"],
        })
      );
    } finally {
      page1.unmount();
      first.stop();
    }

    const second = settingsHost(storage);
    try {
      const page2 = await second.renderSettingsRow(SETTINGS_ROW_ID);
      await waitFor(() =>
        expect(screen.getByRole("switch", { name: "Match word forms" })).not.toBeChecked()
      );
      expect(screen.getByRole("textbox", { name: "Nearby window" })).toHaveValue("120");
      expect(screen.getByRole("button", { name: "Remove harbor" })).toBeInTheDocument();
      page2.unmount();
    } finally {
      second.stop();
    }
  });

  it("falls back to defaults when the stored value is malformed", async () => {
    const storage = settingsStorage();
    storage.set(ECHOES_SETTINGS_KEY, "not settings");
    const host = settingsHost(storage);
    try {
      const page = await host.renderSettingsRow(SETTINGS_ROW_ID);
      await waitFor(() =>
        expect(storage.get(ECHOES_SETTINGS_KEY)).toMatchObject({
          nearby: true,
          overused: true,
          phrases: true,
          stemming: true,
          nearbyWindow: 50,
          ignore: [],
        })
      );
      expect(screen.getByRole("switch", { name: "Nearby echo" })).toBeChecked();
      expect(screen.getByRole("switch", { name: "Match word forms" })).toBeChecked();
      expect(screen.getByRole("textbox", { name: "Nearby window" })).toHaveValue("50");
      page.unmount();
    } finally {
      host.stop();
    }
  });
});

/**
 * The Settings row and the editor controller share one runtime (#451): turning
 * an editor highlight kind on or off must repaint an open editor at once, not
 * wait for its next edit. The editor API is not part of `createTestHost`, so the
 * Plugin client's `editor` namespace is replaced with a local fake; the
 * controller's Command still runs through the real broker, and the row renders
 * through the real Remote UI renderer.
 */
describe("Echoes editor highlight kinds from Settings", () => {
  /** A Chapter whose text repeats a word enough times to be overused. */
  const ECHO_CHAPTER = {
    ...CHAPTER,
    wordCount: 5,
    content: {
      text: "harbor harbor harbor harbor harbor",
      html: "<p>harbor harbor harbor harbor harbor</p>",
    },
  };

  /** A local stand-in for the host editor API, recording each paint. */
  function fakeEditor(text: string) {
    const entity = { kind: "chapter" as const, id: CHAPTER.id };
    const highlights: Array<{ kind: string; ranges: Array<{ from: number; to: number }> }> = [];
    return {
      highlights,
      editor: {
        async getContent() {
          return { status: "ok" as const, entity, content: { text, html: `<p>${text}</p>` } };
        },
        async getSelection() {
          return { status: "ok" as const, entity, range: { from: 0, to: 0 }, text: "" };
        },
        async reveal() {
          return { status: "applied" as const };
        },
        async setHighlights(params: { kind: string; ranges: Array<{ from: number; to: number }> }) {
          highlights.push({
            kind: params.kind,
            ranges: params.ranges.map((range) => ({ ...range })),
          });
          return { status: "applied" as const };
        },
      },
    };
  }

  it("repaints an open editor the moment a kind is turned on", async () => {
    const storage = settingsStorage();
    const host = createTestHost({
      manifest: echoesManifest(),
      library: { books: [BOOK], chapters: [ECHO_CHAPTER] },
      storage,
    });
    const fake = fakeEditor(ECHO_CHAPTER.content.text);
    const client = {
      ...createPluginClient(host.port),
      editor: fake.editor,
    } as unknown as PluginClient;
    startEchoes(client, servePluginUi);
    try {
      // Turn highlights on with the nearby-only default: no overused ranges yet.
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_HIGHLIGHTS });
      expect(
        fake.highlights.some((call) => call.kind === "repetition" && call.ranges.length > 0)
      ).toBe(true);
      expect(fake.highlights.some((call) => call.kind === "info" && call.ranges.length > 0)).toBe(
        false
      );

      const page = await host.renderSettingsRow(SETTINGS_ROW_ID);
      const user = userEvent.setup();
      await waitFor(() => expect(storage.has(ECHOES_EDITOR_KEY)).toBe(true));

      const overused = screen.getByRole("switch", { name: "Highlight overused words" });
      await tabTo(user, overused);
      await user.keyboard(" ");
      await waitFor(() => expect(storage.get(ECHOES_EDITOR_KEY)).toEqual(["nearby", "overused"]));

      // The controller recomputed without an edit: the five overused ranges are
      // now painted.
      await waitFor(() =>
        expect(
          fake.highlights.some((call) => call.kind === "info" && call.ranges.length === 5)
        ).toBe(true)
      );
      page.unmount();
    } finally {
      host.stop();
    }
  });
});
