/**
 * The test kit drives the same tracer fixture the E2E lane seeds into OPFS
 * (issue #434). The fixture is loaded as a real ES module from its file, with
 * `fetch` injected, so the bytes under test are exactly the bytes the browser
 * lanes run; a drift in its protocol strings fails here first.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, createElement, Fragment } from "react";
import { describe, expect, it, vi } from "vitest";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";
import { createTestHost } from "@/features/plugins/test-kit";
import { PLUGIN_READY_MESSAGE } from "@/plugin-sdk/protocol";
import { createPluginClient } from "@/plugin-sdk";
import { ui } from "@/plugin-sdk/ui";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import "@/i18n";
import { readFolderFiles } from "@/test/support/plugin-fixtures";

const FIXTURE_DIR = resolve(process.cwd(), "e2e/fixtures/plugins/tracer");
const LEAK_URL = "https://tracer.invalid/leak";

interface TracerFixture {
  setup(port: MessagePort, options?: { fetch?: (url: string) => Promise<unknown> }): void;
}

async function loadFixture(): Promise<TracerFixture> {
  return (await import(
    /* @vite-ignore */ pathToFileURL(join(FIXTURE_DIR, "index.js")).href
  )) as TracerFixture;
}

function fixtureManifest() {
  const result = parsePluginManifest(readFileSync(join(FIXTURE_DIR, "manifest.json"), "utf8"));
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.manifest;
}

const BOOK = {
  id: "b1",
  title: "Dune",
  subtitle: null,
  authorName: "Frank",
  language: "en",
  wordCount: 10,
  updatedAt: 0,
};

describe("createTestHost()", () => {
  it("drives the tracer fixture over the real broker and records its call", async () => {
    const fixture = await loadFixture();
    const host = createTestHost({ manifest: fixtureManifest(), library: {} });
    try {
      const fetchImpl = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      });
      fixture.setup(host.port, { fetch: fetchImpl });

      await expect(host.broker.request("health.check", {})).resolves.toBe("pong");
      await vi.waitFor(() => {
        expect(host.notifications).toEqual([
          {
            variant: "info",
            message: "tracer ready; direct fetch: refused (TypeError: Failed to fetch)",
          },
        ]);
      });
      expect(fetchImpl).toHaveBeenCalledWith(LEAK_URL);
    } finally {
      host.stop();
    }
  });

  it("serves the in-memory Library to a client with the real method table", async () => {
    const host = createTestHost({
      manifest: {
        ...fixtureManifest(),
        permissions: { required: ["library:read"], optional: [] },
      },
      permissions: ["library:read"],
      library: { books: [BOOK] },
    });
    try {
      const client = createPluginClient(host.port);
      await expect(client.library.books.list()).resolves.toEqual([BOOK]);
      await expect(client.library.books.get({ bookId: "b1" })).resolves.toEqual(BOOK);
      await expect(client.library.books.get({ bookId: "absent" })).resolves.toBeNull();
    } finally {
      host.stop();
    }
  });

  it("refuses a Library call while its Plugin Permission is not granted", async () => {
    const host = createTestHost({
      manifest: {
        ...fixtureManifest(),
        permissions: { required: ["library:read"], optional: [] },
      },
      permissions: [],
      library: { books: [BOOK] },
    });
    try {
      const client = createPluginClient(host.port);
      await expect(client.library.books.list()).rejects.toMatchObject({
        code: "permission-denied",
      });
    } finally {
      host.stop();
    }
  });

  it("carries the locale overrides the host renderer will apply", () => {
    const host = createTestHost({
      manifest: fixtureManifest(),
      locale: { "commands.hello.label": "Hola" },
    });
    try {
      expect(host.locale).toEqual({ "commands.hello.label": "Hola" });
    } finally {
      host.stop();
    }
  });

  it("serves Chapters, Notes, and Canvases, with content on the get", async () => {
    const host = createTestHost({
      manifest: {
        ...fixtureManifest(),
        permissions: { required: ["library:read"], optional: [] },
      },
      permissions: ["library:read"],
      library: {
        books: [BOOK],
        chapters: [
          {
            id: "c1",
            bookId: "b1",
            title: "One",
            order: 0,
            parentId: null,
            wordCount: 2,
            updatedAt: 1_000,
            content: { text: "Hello", html: "<p>Hello</p>" },
          },
        ],
        notes: [
          {
            id: "n1",
            bookId: "b1",
            title: "Note",
            language: "en",
            tags: ["a"],
            wordCount: 1,
            updatedAt: 2_000,
          },
        ],
        canvases: [{ id: "cv1", bookId: null, title: "Board", updatedAt: 3_000 }],
      },
    });
    try {
      const client = createPluginClient(host.port);
      await expect(client.library.chapters.list({ bookId: "b1" })).resolves.toEqual([
        { id: "c1", bookId: "b1", title: "One", order: 0, parentId: null, wordCount: 2, updatedAt: 1_000 },
      ]);
      await expect(client.library.chapters.get({ chapterId: "c1" })).resolves.toMatchObject({
        id: "c1",
        content: { text: "Hello", html: "<p>Hello</p>" },
      });
      await expect(client.library.notes.list({})).resolves.toEqual([
        {
          id: "n1",
          bookId: "b1",
          title: "Note",
          language: "en",
          tags: ["a"],
          wordCount: 1,
          updatedAt: 2_000,
        },
      ]);
      await expect(client.library.notes.get({ noteId: "n1" })).resolves.toMatchObject({ id: "n1" });
      await expect(client.library.canvases.list({})).resolves.toEqual([
        { id: "cv1", bookId: null, title: "Board", updatedAt: 3_000 },
      ]);
      await expect(client.library.canvases.get({ canvasId: "cv1" })).resolves.toMatchObject({
        id: "cv1",
      });
      await expect(client.library.canvases.get({ canvasId: "absent" })).resolves.toBeNull();
    } finally {
      host.stop();
    }
  });

  it("reads and writes this Plugin's storage namespace", async () => {
    const host = createTestHost({ manifest: fixtureManifest() });
    try {
      const client = createPluginClient(host.port);
      await expect(client.storage.get({ key: "missing" })).resolves.toBeNull();
      await expect(client.storage.set({ key: "b", value: [1, 2] })).resolves.toBeNull();
      await expect(client.storage.set({ key: "a", value: { ok: true } })).resolves.toBeNull();
      await expect(client.storage.get({ key: "b" })).resolves.toEqual([1, 2]);
      await expect(client.storage.keys({})).resolves.toEqual(["a", "b"]);
      await client.storage.delete({ key: "b" });
      await expect(client.storage.keys({})).resolves.toEqual(["a"]);
    } finally {
      host.stop();
    }
  });

  it("serves this Plugin's secrets write-only and the shared clipboard", async () => {
    const secrets = new Map<string, string>();
    const host = createTestHost({
      manifest: {
        ...fixtureManifest(),
        permissions: { required: ["secrets", "clipboard"], optional: [] },
      },
      permissions: ["secrets", "clipboard"],
      secrets,
      clipboard: "seeded",
    });
    try {
      const client = createPluginClient(host.port);

      await expect(client.clipboard.readText()).resolves.toBe("seeded");
      await expect(client.clipboard.writeText({ text: "written" })).resolves.toBeNull();
      expect(host.clipboard).toBe("written");
      host.setClipboard("seeded again");
      await expect(client.clipboard.readText()).resolves.toBe("seeded again");

      await expect(client.secrets.listNames()).resolves.toEqual([]);
      await expect(client.secrets.set({ name: "token", value: "s3cret" })).resolves.toBeNull();
      await expect(client.secrets.listNames()).resolves.toEqual(["token"]);
      // The kit keeps the value host-side: the Plugin's one read is names only.
      expect(secrets.get("token")).toBe("s3cret");
      await expect(client.secrets.delete({ name: "token" })).resolves.toBeNull();
      await expect(client.secrets.listNames()).resolves.toEqual([]);
    } finally {
      host.stop();
    }
  });

  it("records navigation.openEntity with its reveal range", async () => {
    const host = createTestHost({ manifest: fixtureManifest() });
    try {
      const client = createPluginClient(host.port);
      await client.navigation.openEntity({ entity: { kind: "chapter", id: "c1" } });
      await client.navigation.openEntity({
        entity: { kind: "book", id: "b1" },
        reveal: { from: 3, to: 9 },
      });
      expect(host.navigations).toEqual([
        { entity: { kind: "chapter", id: "c1" } },
        { entity: { kind: "book", id: "b1" }, reveal: { from: 3, to: 9 } },
      ]);
    } finally {
      host.stop();
    }
  });

  it("opens a Plugin page with no Plugin Permissions, its own or another installed Plugin's", async () => {
    const host = createTestHost({
      manifest: {
        ...fixtureManifest(),
        permissions: { required: ["library:read"], optional: [] },
      },
      permissions: [],
    });
    try {
      const client = createPluginClient(host.port);
      // No pluginId: the calling Plugin's own page.
      await expect(client.navigation.openPage({ pageId: "report" })).resolves.toEqual({
        status: "opened",
      });
      // Another installed Plugin's page is reachable by naming it.
      await expect(
        client.navigation.openPage({ pageId: "panel", pluginId: "other" })
      ).resolves.toEqual({ status: "opened" });
      expect(host.pageNavigations).toEqual([
        { pluginId: "tracer", pageId: "report" },
        { pluginId: "other", pageId: "panel" },
      ]);
    } finally {
      host.stop();
    }
  });

  it("refuses navigation.openEntity with library-unavailable while the Tutorial runs", async () => {
    // Decision #398: the Tutorial refuses Library access, and navigation reads
    // the Library to resolve a route and drives the router out of the run.
    const host = createTestHost({ manifest: fixtureManifest() });
    try {
      const client = createPluginClient(host.port);
      host.setLibraryAvailable(false);
      await expect(
        client.navigation.openEntity({ entity: { kind: "book", id: "b1" } })
      ).rejects.toMatchObject({ code: "library-unavailable" });
      expect(host.navigations).toEqual([]);
      host.setLibraryAvailable(true);
      await client.navigation.openEntity({ entity: { kind: "book", id: "b1" } });
      expect(host.navigations).toEqual([{ entity: { kind: "book", id: "b1" } }]);
    } finally {
      host.stop();
    }
  });

  it("refuses a Library call with library-unavailable while the Tutorial runs", async () => {
    const host = createTestHost({
      manifest: {
        ...fixtureManifest(),
        permissions: { required: ["library:read"], optional: [] },
      },
      permissions: ["library:read"],
      library: { books: [BOOK] },
    });
    try {
      const client = createPluginClient(host.port);
      host.setLibraryAvailable(false);
      await expect(client.library.books.list()).rejects.toMatchObject({
        code: "library-unavailable",
      });
      await expect(client.storage.keys({})).rejects.toMatchObject({ code: "library-unavailable" });
      host.setLibraryAvailable(true);
      await expect(client.library.books.list()).resolves.toEqual([BOOK]);
    } finally {
      host.stop();
    }
  });

  it("refuses a call whose params break the row's schema", async () => {
    const host = createTestHost({ manifest: fixtureManifest() });
    try {
      const client = createPluginClient(host.port);
      await expect(
        (client.library.books.get as (params: unknown) => Promise<unknown>)({})
      ).rejects.toMatchObject({ code: "invalid-params" });
      await expect(
        (client.navigation.openEntity as (params: unknown) => Promise<unknown>)({
          entity: { kind: "planet", id: "x" },
        })
      ).rejects.toMatchObject({ code: "invalid-params" });
    } finally {
      host.stop();
    }
  });

  it("rate-limits notifications to one per 5 s", async () => {
    const host = createTestHost({ manifest: fixtureManifest() });
    try {
      const client = createPluginClient(host.port);
      await client.notifications.show({ variant: "info", message: "one" });
      await expect(
        client.notifications.show({ variant: "info", message: "two" })
      ).rejects.toMatchObject({ code: "rate-limited" });
      expect(host.notifications).toEqual([{ variant: "info", message: "one" }]);
    } finally {
      host.stop();
    }
  });
});

describe("createTestHost() events and language", () => {
  it("delivers the current language on subscription, and every later change", async () => {
    const host = createTestHost({ manifest: fixtureManifest(), language: "en" });
    try {
      const client = createPluginClient(host.port);
      const seen: string[] = [];
      const off = await client.on("language.changed", (payload) => seen.push(payload.language));

      // The current value arrives on subscription, so a Plugin activated after
      // a change still learns it and no change is missed.
      await vi.waitFor(() => expect(seen).toEqual(["en"]));
      host.setLanguage("es");
      host.setLanguage("en");
      host.setLanguage("es");
      await vi.waitFor(() => expect(seen).toEqual(["en", "es", "en", "es"]));
      await off();
    } finally {
      host.stop();
    }
  });

  it("hands a Plugin activated after a change the new value, not a startup snapshot", async () => {
    const host = createTestHost({ manifest: fixtureManifest(), language: "en" });
    try {
      host.setLanguage("es");
      const client = createPluginClient(host.port);
      const seen: string[] = [];
      await client.on("language.changed", (payload) => seen.push(payload.language));

      await vi.waitFor(() => expect(seen).toEqual(["es"]));
      await expect(client.language.get({})).resolves.toEqual({ language: "es" });
    } finally {
      host.stop();
    }
  });

  it("does not reject a Plugin that never subscribes to language", async () => {
    const host = createTestHost({ manifest: fixtureManifest() });
    try {
      const client = createPluginClient(host.port);
      host.setLanguage("es");
      await expect(client.language.get({})).resolves.toEqual({ language: "es" });
      expect(host.broker.stopped).toBe(false);
    } finally {
      host.stop();
    }
  });

  it("delivers library.changed per entity and in bulk, and availability ungated", async () => {
    const host = createTestHost({
      manifest: {
        ...fixtureManifest(),
        permissions: { required: ["library:read"], optional: [] },
      },
      permissions: ["library:read"],
    });
    try {
      const client = createPluginClient(host.port);
      const changes: unknown[] = [];
      const availability: boolean[] = [];
      await client.on("library.changed", (payload) => changes.push(payload));
      await client.on("library.availabilityChanged", (payload) => availability.push(payload.available));

      expect(
        host.broker.emit("library.changed", {
          entity: "book",
          id: "b1",
          origin: "local",
          kind: "content",
        })
      ).toBe(true);
      expect(host.broker.emit("library.changed", { scope: "all", reason: "restore" })).toBe(true);
      expect(host.broker.emit("library.availabilityChanged", { available: false })).toBe(true);

      await vi.waitFor(() => {
        expect(changes).toEqual([
          { entity: "book", id: "b1", origin: "local", kind: "content" },
          { scope: "all", reason: "restore" },
        ]);
        expect(availability).toEqual([false]);
      });

      host.stopWorker();
      expect(host.broker.emit("library.availabilityChanged", { available: true })).toBe(false);
    } finally {
      host.stop();
    }
  });
});

describe("renderPage", () => {
  it("renders a Plugin page through the real host renderer, by keyboard alone", async () => {
    const host = createTestHost({ manifest: fixtureManifest() });
    try {
      const client = createPluginClient(host.port);

      /** A Plugin page that searches, echoes what was typed, and reports on Go. */
      function SearchPage() {
        const [value, setValue] = useState("");
        return createElement(
          Fragment,
          null,
          createElement(ui.Heading, null, "Find"),
          createElement(ui.TextField, {
            label: "Search",
            value,
            onInput: (event: { detail: string }) => setValue(event.detail),
          }),
          createElement(ui.Text, null, `You typed: ${value}`),
          createElement(
            ui.Button,
            {
              onPress: () => {
                void client.notifications.show({ variant: "info", message: value });
              },
            },
            "Go"
          )
        );
      }

      servePluginUi(client, { pages: { main: SearchPage } });

      const page = await host.renderPage("main");
      const user = userEvent.setup();

      expect(await screen.findByRole("heading", { name: "Find" })).toBeInTheDocument();

      const field = screen.getByRole("textbox", { name: "Search" });
      for (let i = 0; i < 10 && document.activeElement !== field; i++) await user.tab();
      expect(field).toHaveFocus();
      await user.keyboard("dune");
      expect(await screen.findByText("You typed: dune")).toBeInTheDocument();

      const go = screen.getByRole("button", { name: "Go" });
      for (let i = 0; i < 10 && document.activeElement !== go; i++) await user.tab();
      expect(go).toHaveFocus();
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(host.notifications).toContainEqual({ variant: "info", message: "dune" });
      });
      expect(page.violations).toEqual([]);

      page.unmount();
      await waitFor(() => {
        expect(screen.queryByRole("heading", { name: "Find" })).not.toBeInTheDocument();
      });
    } finally {
      host.stop();
    }
  });

  it("dismisses an open Modal on Escape after the Worker stops", async () => {
    const host = createTestHost({ manifest: fixtureManifest() });
    try {
      const client = createPluginClient(host.port);

      /** A Plugin page whose Modal ignores `onOpenChange`. */
      function ModalPage() {
        const [open, setOpen] = useState(false);
        return createElement(
          Fragment,
          null,
          createElement(ui.Button, { onPress: () => setOpen(true) }, "Open dialog"),
          createElement(
            ui.Modal,
            { title: "Details", isOpen: open, onOpenChange: () => {} },
            createElement(ui.Text, null, "Modal body")
          )
        );
      }

      servePluginUi(client, { pages: { main: ModalPage } });
      await host.renderPage("main");
      const user = userEvent.setup();

      const trigger = await screen.findByRole("button", { name: "Open dialog" });
      for (let i = 0; i < 10 && document.activeElement !== trigger; i++) await user.tab();
      expect(trigger).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(await screen.findByRole("dialog", { name: "Details" })).toBeInTheDocument();

      // The Worker stops with the dialog open: the host must still dismiss and
      // return focus, without waiting for an echo over the closed port.
      host.stopWorker();

      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.activeElement).toBe(trigger);
    } finally {
      host.stop();
    }
  });

  it("rejects rendering a page the Plugin never declared", async () => {
    const host = createTestHost({ manifest: fixtureManifest() });
    try {
      const client = createPluginClient(host.port);
      servePluginUi(client, { pages: {} });

      await expect(host.renderPage("missing")).rejects.toThrow("Unknown page missing");
    } finally {
      host.stop();
    }
  });

  it("renders a Settings row body through the real host renderer, by keyboard alone", async () => {
    const host = createTestHost({ manifest: fixtureManifest() });
    try {
      const client = createPluginClient(host.port);

      /** A Settings row body the Plugin serves under the row's Plugin-local id. */
      function RowBody() {
        const [on, setOn] = useState(false);
        return createElement(ui.Switch, {
          label: "Threshold",
          isSelected: on,
          onChange: (event: { detail: boolean }) => setOn(event.detail),
        });
      }

      servePluginUi(client, { pages: {}, settingsRows: { threshold: RowBody } });
      const row = await host.renderSettingsRow("threshold");
      const user = userEvent.setup();

      const control = await screen.findByRole("switch", { name: "Threshold" });
      for (let i = 0; i < 10 && document.activeElement !== control; i++) await user.tab();
      expect(control).toHaveFocus();
      await user.keyboard(" ");
      expect(control).toBeChecked();

      row.unmount();
    } finally {
      host.stop();
    }
  });

  it("rejects a Settings row the Plugin never declared", async () => {
    const host = createTestHost({ manifest: fixtureManifest() });
    try {
      const client = createPluginClient(host.port);
      servePluginUi(client, { pages: {}, settingsRows: {} });

      await expect(host.renderSettingsRow("missing")).rejects.toThrow(
        "Unknown Settings row missing"
      );
    } finally {
      host.stop();
    }
  });

  it("applies the locale override to the manifest it carries", () => {
    const host = createTestHost({
      manifest: fixtureManifest(),
      locale: { "commands.openReport.label": "Abrir informe" },
    });
    try {
      expect(host.manifest.contributes?.commands?.[0]?.label).toBe("Abrir informe");
    } finally {
      host.stop();
    }
  });
});

describe("createTestHost() activation", () => {
  it("hands a Plugin the activation startReason the host started it with", async () => {
    const host = createTestHost({ manifest: fixtureManifest(), startReason: "restore" });
    try {
      const client = createPluginClient(host.port);
      await vi.waitFor(() => {
        expect(client.activation).toEqual({ startReason: "restore" });
      });
    } finally {
      host.stop();
    }
  });

  it("defaults a Plugin's activation startReason to enable", async () => {
    const host = createTestHost({ manifest: fixtureManifest() });
    try {
      const client = createPluginClient(host.port);
      await vi.waitFor(() => {
        expect(client.activation).toEqual({ startReason: "enable" });
      });
    } finally {
      host.stop();
    }
  });
});

describe("the tracer fixture and the protocol", () => {
  it("signals readiness with the protocol's ready kind", () => {
    const source = readFileSync(join(FIXTURE_DIR, "index.js"), "utf8");
    expect(source).toContain(PLUGIN_READY_MESSAGE.kind);
  });

  it("matches the committed pin the E2E seed writes into the approval record", async () => {
    const expected = JSON.parse(
      readFileSync(resolve(FIXTURE_DIR, "../tracer.expected.json"), "utf8")
    ) as { hash: string };
    await expect(hashPluginDirectory(readFolderFiles(FIXTURE_DIR))).resolves.toBe(expected.hash);
  });
});

describe("createTestHost() toolbar.setPressed", () => {
  const toggleManifest = () => {
    const manifest = fixtureManifest();
    return {
      ...manifest,
      contributes: {
        toolbarButtons: [
          { id: "toggleHighlights", command: "run", icon: "highlighter", toggle: true },
          { id: "plain", command: "run", icon: "book-open" },
        ],
      },
    };
  };

  it("records a declared Toggle Button's pressed state, as the app's handler does", async () => {
    const host = createTestHost({ manifest: toggleManifest() });
    try {
      const client = createPluginClient(host.port);
      expect(host.toolbarPressed("toggleHighlights")).toBe(false);

      await expect(
        client.toolbar.setPressed({ button: "toggleHighlights", pressed: true })
      ).resolves.toBeNull();
      expect(host.toolbarPressed("toggleHighlights")).toBe(true);

      await client.toolbar.setPressed({ button: "toggleHighlights", pressed: false });
      expect(host.toolbarPressed("toggleHighlights")).toBe(false);
    } finally {
      host.stop();
    }
  });

  it("refuses an undeclared button and a plain button with invalid-params, recording nothing", async () => {
    const host = createTestHost({ manifest: toggleManifest() });
    try {
      const client = createPluginClient(host.port);
      await expect(
        client.toolbar.setPressed({ button: "missing", pressed: true })
      ).rejects.toMatchObject({ code: "invalid-params", message: "No toolbar button missing" });
      await expect(client.toolbar.setPressed({ button: "plain", pressed: true })).rejects.toMatchObject(
        { code: "invalid-params", message: "Toolbar button plain is not a Toggle Button" }
      );
      expect(host.toolbarPressed("missing")).toBe(false);
      expect(host.toolbarPressed("plain")).toBe(false);
    } finally {
      host.stop();
    }
  });
});
