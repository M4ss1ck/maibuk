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
import type { PluginManifest } from "@/features/plugins/types";
import { PLUGIN_READY_MESSAGE } from "@/plugin-sdk/protocol";
import { createPluginClient, type PluginEndpointRequest } from "@/plugin-sdk";
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
  genre: null,
  language: "en",
  wordCount: 10,
  targetWordCount: null,
  status: "draft" as const,
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
            chapterType: "chapter",
            status: "draft",
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
        {
          id: "c1",
          bookId: "b1",
          title: "One",
          order: 0,
          parentId: null,
          wordCount: 2,
          chapterType: "chapter",
          status: "draft",
          updatedAt: 1_000,
        },
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
      await client.on("library.availabilityChanged", (payload) =>
        availability.push(payload.available)
      );

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

describe("createTestHost() permissions", () => {
  function permissionsManifest(): PluginManifest {
    return {
      ...fixtureManifest(),
      permissions: { required: ["library:read"], optional: ["editor:read"] },
    };
  }

  it("lists the Plugin's granted permissions, and the new list after setGranted (#591)", async () => {
    const host = createTestHost({ manifest: permissionsManifest(), permissions: ["library:read"] });
    try {
      const client = createPluginClient(host.port);
      await expect(client.permissions.granted()).resolves.toEqual({
        permissions: ["library:read"],
      });
      host.setGranted(["library:read", "editor:read"]);
      await expect(client.permissions.granted()).resolves.toEqual({
        permissions: ["library:read", "editor:read"],
      });
    } finally {
      host.stop();
    }
  });

  it("delivers the current list on subscription, then the new list, and nothing when the set is unchanged (#591)", async () => {
    const host = createTestHost({ manifest: permissionsManifest(), permissions: ["library:read"] });
    try {
      const client = createPluginClient(host.port);
      const seen: string[][] = [];
      const off = await client.on("permissions.changed", (payload) =>
        seen.push(payload.permissions)
      );

      // The current list arrives on subscription, so a Plugin that starts after
      // a change never misses it.
      await vi.waitFor(() => expect(seen).toEqual([["library:read"]]));
      host.setGranted(["library:read", "editor:read"]);
      await vi.waitFor(() =>
        expect(seen).toEqual([["library:read"], ["library:read", "editor:read"]])
      );
      // The same set again, in another order, is not a change and fires nothing:
      // the round-tripped call below settles after any event would have been
      // delivered, since the port delivers in order.
      host.setGranted(["editor:read", "library:read"]);
      await expect(client.permissions.granted()).resolves.toEqual({
        permissions: ["editor:read", "library:read"],
      });
      expect(seen).toEqual([["library:read"], ["library:read", "editor:read"]]);
      await off();
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
      await expect(
        client.toolbar.setPressed({ button: "plain", pressed: true })
      ).rejects.toMatchObject({
        code: "invalid-params",
        message: "Toolbar button plain is not a Toggle Button",
      });
      expect(host.toolbarPressed("missing")).toBe(false);
      expect(host.toolbarPressed("plain")).toBe(false);
    } finally {
      host.stop();
    }
  });
});

describe("createTestHost() endpoint", () => {
  /** A manifest that may serve: `serve` is the Plugin Endpoint's own Plugin Permission. */
  function serveManifest(): PluginManifest {
    return { ...fixtureManifest(), permissions: { required: ["serve"], optional: [] } };
  }

  it("hands the Plugin a request on its Plugin Endpoint and returns its answer", async () => {
    const host = createTestHost({ manifest: serveManifest() });
    try {
      const client = createPluginClient(host.port);
      client.onEndpointRequest(() => ({
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "pong",
      }));

      const answer = await host.endpoint({ path: "/mcp" });

      expect(answer.status).toBe(200);
      expect(answer.headers).toEqual([["content-type", "text/plain"]]);
      expect(answer.streamed).toBe(false);
      expect(answer.chunks).toEqual([]);
      expect(Array.from(answer.body)).toEqual([112, 111, 110, 103]);
      expect(answer.text()).toBe("pong");
    } finally {
      host.stop();
    }
  });

  it("collects a streamed answer's chunks in order and joins them in text()", async () => {
    const host = createTestHost({ manifest: serveManifest() });
    try {
      const client = createPluginClient(host.port);
      client.onEndpointRequest(() => ({
        status: 200,
        body: (async function* () {
          yield "one ";
          yield new TextEncoder().encode("two");
          yield " three";
        })(),
      }));

      const answer = await host.endpoint({ path: "/stream" });

      expect(answer.status).toBe(200);
      expect(answer.streamed).toBe(true);
      expect(answer.chunks.map((chunk) => new TextDecoder().decode(chunk))).toEqual([
        "one ",
        "two",
        " three",
      ]);
      expect(new TextDecoder().decode(answer.body)).toBe("one two three");
      expect(answer.text()).toBe("one two three");
    } finally {
      host.stop();
    }
  });

  it("joins a multi-byte character split across streamed chunks", async () => {
    const host = createTestHost({ manifest: serveManifest() });
    try {
      const client = createPluginClient(host.port);
      // "é" is two bytes; one chunk ends inside it.
      const bytes = new TextEncoder().encode("é");
      client.onEndpointRequest(() => ({
        status: 200,
        body: (async function* () {
          yield bytes.slice(0, 1);
          yield bytes.slice(1);
        })(),
      }));

      const answer = await host.endpoint({ path: "/split" });

      expect(answer.chunks.map((chunk) => Array.from(chunk))).toEqual([[195], [169]]);
      expect(Array.from(answer.body)).toEqual(Array.from(bytes));
      expect(answer.text()).toBe("é");
    } finally {
      host.stop();
    }
  });

  it("reaches the Plugin as sent: method, prefixed path, headers, and body", async () => {
    const host = createTestHost({ manifest: serveManifest() });
    try {
      const client = createPluginClient(host.port);
      const handler = vi.fn((_request: PluginEndpointRequest) => ({ status: 204 }));
      client.onEndpointRequest(handler);

      await host.endpoint({
        method: "POST",
        path: "mcp?x=1",
        headers: [
          ["x-tag", "a"],
          ["x-tag", "b"],
        ],
        body: new TextEncoder().encode("hello"),
      });
      await host.endpoint({ path: "/mcp" });

      const [first, second] = handler.mock.calls.map(([request]) => request);
      expect(first.method).toBe("POST");
      expect(first.path).toBe(`/plugin/${host.manifest.id}/mcp?x=1`);
      expect(first.headers).toEqual([
        ["x-tag", "a"],
        ["x-tag", "b"],
      ]);
      expect(first.text()).toBe("hello");
      expect(Array.from(first.body)).toEqual([104, 101, 108, 108, 111]);
      expect(second.method).toBe("GET");
      expect(second.path).toBe(`/plugin/${host.manifest.id}/mcp`);
      expect(second.headers).toEqual([]);
      expect(second.body.length).toBe(0);
    } finally {
      host.stop();
    }
  });

  it("answers 404 without asking the Plugin when serve is not granted", async () => {
    const host = createTestHost({ manifest: serveManifest() });
    try {
      const client = createPluginClient(host.port);
      const handler = vi.fn((_request: PluginEndpointRequest) => ({ status: 200 }));
      client.onEndpointRequest(handler);
      host.setGranted([]);

      const denied = await host.endpoint({ path: "/mcp" });

      expect(denied.status).toBe(404);
      expect(denied.text()).toBe("");
      // The grant is read live: granting it again lets the same handler answer,
      // which proves the refused request never reached it.
      host.setGranted(["serve"]);
      await expect(host.endpoint({ path: "/mcp" })).resolves.toMatchObject({ status: 200 });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      host.stop();
    }
  });

  it("answers 404 when the Plugin registered no Endpoint handler", async () => {
    const host = createTestHost({ manifest: serveManifest() });
    try {
      // The Plugin is live but never called `onEndpointRequest`.
      createPluginClient(host.port);
      const answer = await host.endpoint({ path: "/mcp" });

      expect(answer.status).toBe(404);
      expect(answer.streamed).toBe(false);
      expect(answer.text()).toBe("");
    } finally {
      host.stop();
    }
  });

  it("answers 500 when the Endpoint handler throws", async () => {
    const host = createTestHost({ manifest: serveManifest() });
    try {
      const client = createPluginClient(host.port);
      client.onEndpointRequest(() => {
        throw new Error("boom");
      });

      const answer = await host.endpoint({ path: "/mcp" });

      expect(answer.status).toBe(500);
      expect(answer.text()).toBe("");
    } finally {
      host.stop();
    }
  });

  it("reads a streamed answer chunk by chunk without waiting for its end", async () => {
    const host = createTestHost({ manifest: serveManifest() });
    try {
      const client = createPluginClient(host.port);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      client.onEndpointRequest(() => ({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: (async function* () {
          yield "one ";
          await gate;
          yield "two";
        })(),
      }));

      const stream = host.endpointStream({ path: "/stream" });

      const head = await stream.head;
      expect(head.status).toBe(200);
      expect(head.headers).toEqual([["content-type", "text/event-stream"]]);
      // The first chunk arrives while the stream stays open behind the gate.
      await expect(stream.waitForText("one ")).resolves.toBe("one ");
      release();
      await expect(stream.waitForText("one two")).resolves.toBe("one two");
      expect(stream.chunks().map((chunk) => new TextDecoder().decode(chunk))).toEqual([
        "one ",
        "two",
      ]);
      stream.close();
    } finally {
      host.stop();
    }
  });
});

describe("createTestHost() endpoint address", () => {
  function serveManifest(): PluginManifest {
    return { ...fixtureManifest(), permissions: { required: ["serve"], optional: [] } };
  }

  function addressOf(host: ReturnType<typeof createTestHost>, port: number): string {
    return `http://127.0.0.1:${port}/plugin/${host.manifest.id}/`;
  }

  it("reads the address the Plugin Endpoint is listening on", async () => {
    const host = createTestHost({ manifest: serveManifest() });
    try {
      const client = createPluginClient(host.port);
      await expect(client.endpoint.address()).resolves.toEqual({ url: null });

      host.setEndpointAddress(41000);
      await expect(client.endpoint.address()).resolves.toEqual({ url: addressOf(host, 41000) });

      host.setEndpointAddress(null);
      await expect(client.endpoint.address()).resolves.toEqual({ url: null });
    } finally {
      host.stop();
    }
  });

  it("refuses the address read to a Plugin without serve", async () => {
    const host = createTestHost({ manifest: serveManifest() });
    try {
      const client = createPluginClient(host.port);
      host.setGranted([]);

      await expect(client.endpoint.address()).rejects.toMatchObject({
        code: "permission-denied",
        permission: "serve",
      });
    } finally {
      host.stop();
    }
  });

  it("delivers the address to a subscribed serve Plugin, once per real change", async () => {
    const host = createTestHost({ manifest: serveManifest() });
    try {
      const client = createPluginClient(host.port);
      const seen: (string | null)[] = [];
      const off = await client.on("endpoint.addressChanged", (payload) => seen.push(payload.url));

      // The replay says the endpoint is not bound yet.
      await vi.waitFor(() => expect(seen).toEqual([null]));
      host.setEndpointAddress(41000);
      // The same address again is not a move and fires nothing.
      host.setEndpointAddress(41000);
      await vi.waitFor(() => expect(seen).toEqual([null, addressOf(host, 41000)]));
      await off();
    } finally {
      host.stop();
    }
  });

  it("hands a Plugin that subscribes after the move the current address", async () => {
    const host = createTestHost({ manifest: serveManifest() });
    try {
      host.setEndpointAddress(42000);

      const client = createPluginClient(host.port);
      const seen: (string | null)[] = [];
      await client.on("endpoint.addressChanged", (payload) => seen.push(payload.url));

      await vi.waitFor(() => expect(seen).toEqual([addressOf(host, 42000)]));
    } finally {
      host.stop();
    }
  });
});

// #591: the two writes an editing Plugin test needs. Both mutate the in-memory
// Library the reads serve, so a test asserts the state the write produced.
describe("createTestHost() Library writes", () => {
  function writeManifest(): PluginManifest {
    return {
      ...fixtureManifest(),
      permissions: { required: ["library:read", "library:write"], optional: [] },
    };
  }

  function chapterFixture() {
    return {
      id: "c1",
      bookId: "b1",
      title: "One",
      order: 0,
      parentId: null,
      wordCount: 2,
      chapterType: "chapter" as const,
      status: "draft" as const,
      updatedAt: 1_000,
      content: { text: "Hello", html: "<p>Hello</p>" },
    };
  }

  function writeHost(chapter: ReturnType<typeof chapterFixture>) {
    return createTestHost({
      manifest: writeManifest(),
      permissions: ["library:read", "library:write"],
      library: { books: [BOOK], chapters: [chapter] },
    });
  }

  it("stores a Chapter content write as the host reads it back, with a later Last Edited", async () => {
    const chapter = chapterFixture();
    const host = writeHost(chapter);
    try {
      const client = createPluginClient(host.port);

      await expect(
        client.library.chapters.updateContent({
          chapterId: "c1",
          content: { html: "<p>Hello <em>world</em></p>" },
        })
      ).resolves.toBeNull();

      const written = { html: "<p>Hello <em>world</em></p>", text: "Hello world" };
      expect(chapter.content).toEqual(written);
      expect(chapter.updatedAt).toBeGreaterThan(1_000);
      await expect(client.library.chapters.get({ chapterId: "c1" })).resolves.toMatchObject({
        content: written,
        updatedAt: chapter.updatedAt,
      });
    } finally {
      host.stop();
    }
  });

  it("sanitizes HTML the way the host does", async () => {
    const chapter = chapterFixture();
    const host = writeHost(chapter);
    try {
      const client = createPluginClient(host.port);

      await client.library.chapters.updateContent({
        chapterId: "c1",
        content: { html: '<p onclick="steal()">Hi<script>alert(1)</script></p>' },
      });

      expect(chapter.content?.html).toBe("<p>Hi</p>");
    } finally {
      host.stop();
    }
  });

  it("turns a text fragment into the host's paragraphs", async () => {
    const chapter = chapterFixture();
    const host = writeHost(chapter);
    try {
      const client = createPluginClient(host.port);

      await client.library.chapters.updateContent({
        chapterId: "c1",
        content: { text: "One & two\nthree\n\nFour <five>" },
      });

      expect(chapter.content?.html).toBe("<p>One &amp; two<br>three</p><p>Four &lt;five&gt;</p>");
    } finally {
      host.stop();
    }
  });

  it("refuses an unknown Chapter with the host's not-found refusal, writing nothing", async () => {
    const chapter = chapterFixture();
    const host = writeHost(chapter);
    try {
      const client = createPluginClient(host.port);
      const before = chapter.content;

      await expect(
        client.library.chapters.updateContent({
          chapterId: "absent",
          content: { html: "<p>x</p>" },
        })
      ).rejects.toMatchObject({
        code: "invalid-params",
        message: "Chapter absent does not exist",
      });
      expect(chapter.content).toEqual(before);
    } finally {
      host.stop();
    }
  });

  it("refuses a Chapter write without library:write and leaves the Library alone", async () => {
    const chapter = chapterFixture();
    const host = createTestHost({
      manifest: writeManifest(),
      permissions: ["library:read"],
      library: { books: [BOOK], chapters: [chapter] },
    });
    try {
      const client = createPluginClient(host.port);
      const before = chapter.content;

      await expect(
        client.library.chapters.updateContent({ chapterId: "c1", content: { html: "<p>Mine</p>" } })
      ).rejects.toMatchObject({ code: "permission-denied", permission: "library:write" });
      expect(chapter.content).toEqual(before);
    } finally {
      host.stop();
    }
  });

  it("takes a Checkpoint only while the Book changed since the last one", async () => {
    const chapter = chapterFixture();
    const host = writeHost(chapter);
    try {
      const client = createPluginClient(host.port);

      // A Book starts out changed: it has no Version yet.
      const first = await client.library.books.checkpoint({ bookId: "b1", label: "Before edits" });
      expect(first.versionId).toEqual(expect.any(String));

      const second = await client.library.books.checkpoint({ bookId: "b1", label: "Again" });
      expect(second.versionId).toBeNull();
      expect(host.checkpoints).toEqual([
        { bookId: "b1", label: "Before edits", versionId: first.versionId },
      ]);

      // A Chapter content write marks the Book changed again.
      await client.library.chapters.updateContent({
        chapterId: "c1",
        content: { html: "<p>Changed</p>" },
      });
      const third = await client.library.books.checkpoint({ bookId: "b1", label: "After edits" });
      expect(third.versionId).toEqual(expect.any(String));
      expect(third.versionId).not.toBe(first.versionId);

      // Only the taken Checkpoints are recorded, in order.
      expect(host.checkpoints).toEqual([
        { bookId: "b1", label: "Before edits", versionId: first.versionId },
        { bookId: "b1", label: "After edits", versionId: third.versionId },
      ]);
    } finally {
      host.stop();
    }
  });

  it("rejects a Checkpoint with checkpointError, recording nothing", async () => {
    const chapter = chapterFixture();
    const host = createTestHost({
      manifest: writeManifest(),
      permissions: ["library:read", "library:write"],
      library: { books: [BOOK], chapters: [chapter] },
      checkpointError: "The Versions shelf is stuck.",
    });
    try {
      const client = createPluginClient(host.port);
      await expect(
        client.library.books.checkpoint({ bookId: "b1", label: "Before edits" })
      ).rejects.toMatchObject({
        code: "internal-error",
        message: "The Versions shelf is stuck.",
      });
      expect(host.checkpoints).toEqual([]);
    } finally {
      host.stop();
    }
  });

  it("flushes a pending edit before a content write without expectedUpdatedAt", async () => {
    const chapter = chapterFixture();
    const host = writeHost(chapter);
    try {
      const client = createPluginClient(host.port);
      host.setPendingEdit("c1", "<p>Typed</p>");

      await client.library.chapters.updateContent({
        chapterId: "c1",
        content: { html: "<p>Written</p>" },
      });

      // The pending typing landed first, then the write replaced it.
      expect(chapter.content).toEqual({ html: "<p>Written</p>", text: "Written" });
    } finally {
      host.stop();
    }
  });

  it("refuses a content write whose expectedUpdatedAt is stale", async () => {
    const chapter = chapterFixture();
    const host = writeHost(chapter);
    try {
      const client = createPluginClient(host.port);
      const stale = chapter.updatedAt - 1;
      const before = chapter.content;

      await expect(
        client.library.chapters.updateContent({
          chapterId: "c1",
          content: { html: "<p>Wrong</p>" },
          expectedUpdatedAt: stale,
        })
      ).rejects.toMatchObject({ code: "conflict" });
      expect(chapter.content).toEqual(before);
    } finally {
      host.stop();
    }
  });

  it("refuses when a pending edit was flushed even though expectedUpdatedAt matched before", async () => {
    const chapter = chapterFixture();
    const host = writeHost(chapter);
    try {
      const client = createPluginClient(host.port);
      const expected = chapter.updatedAt;
      host.setPendingEdit("c1", "<p>Typed</p>");

      await expect(
        client.library.chapters.updateContent({
          chapterId: "c1",
          content: { html: "<p>Written</p>" },
          expectedUpdatedAt: expected,
        })
      ).rejects.toMatchObject({ code: "conflict" });

      // The flush landed the typing, and the refused write left it alone.
      expect(chapter.content).toEqual({ html: "<p>Typed</p>", text: "Typed" });
    } finally {
      host.stop();
    }
  });

  it("flushes a pending edit before a Checkpoint, so the stored Chapter holds the typing", async () => {
    const chapter = chapterFixture();
    const host = writeHost(chapter);
    try {
      const client = createPluginClient(host.port);
      host.setPendingEdit("c1", "<p>Typed</p>");

      await client.library.books.checkpoint({ bookId: "b1", label: "Before edits" });

      await expect(client.library.chapters.get({ chapterId: "c1" })).resolves.toMatchObject({
        content: { html: "<p>Typed</p>", text: "Typed" },
      });
    } finally {
      host.stop();
    }
  });

  // #592: the Chapter field, ordering, create, and delete writes, plus the Book
  // field write, so a Plugin test drives every write the MCP Server exposes.
  function orderedLibrary() {
    const books = [{ ...BOOK }];
    const chapters = ["c1", "c2", "c3"].map((id, index) => ({
      ...chapterFixture(),
      id,
      title: id,
      order: index,
      updatedAt: 1_000 + index,
    }));
    return { books, chapters };
  }

  function orderedHost() {
    const library = orderedLibrary();
    const host = createTestHost({
      manifest: writeManifest(),
      permissions: ["library:read", "library:write"],
      library,
    });
    return { host, ...library };
  }

  it("updates a Chapter's title, Chapter Type, and Chapter Status, moving Last Edited", async () => {
    const chapter = chapterFixture();
    const host = writeHost(chapter);
    try {
      const client = createPluginClient(host.port);
      await expect(
        client.library.chapters.update({
          chapterId: "c1",
          title: "Renamed",
          chapterType: "prologue",
          status: "final",
        })
      ).resolves.toBeNull();

      expect(chapter).toMatchObject({ title: "Renamed", chapterType: "prologue", status: "final" });
      expect(chapter.updatedAt).toBeGreaterThan(1_000);
    } finally {
      host.stop();
    }
  });

  it("refuses a Chapter update naming no field and an unknown Chapter, changing nothing", async () => {
    const chapter = chapterFixture();
    const host = writeHost(chapter);
    try {
      const client = createPluginClient(host.port);
      await expect(client.library.chapters.update({ chapterId: "c1" })).rejects.toMatchObject({
        code: "invalid-params",
        message: "Give at least one Chapter field to update",
      });
      await expect(
        client.library.chapters.update({ chapterId: "absent", title: "Renamed" })
      ).rejects.toMatchObject({
        code: "invalid-params",
        message: "Chapter absent does not exist",
      });
      expect(chapter.title).toBe("One");
      expect(chapter.updatedAt).toBe(1_000);
    } finally {
      host.stop();
    }
  });

  it("reorders a Book's Chapters to the given ids", async () => {
    const { host, chapters } = orderedHost();
    try {
      const client = createPluginClient(host.port);
      await expect(
        client.library.chapters.reorder({ bookId: "b1", chapterIds: ["c3", "c1", "c2"] })
      ).resolves.toBeNull();

      await expect(client.library.chapters.list({ bookId: "b1" })).resolves.toMatchObject([
        { id: "c3", order: 0 },
        { id: "c1", order: 1 },
        { id: "c2", order: 2 },
      ]);
      expect(chapters.map((chapter) => chapter.order)).toEqual([1, 2, 0]);
    } finally {
      host.stop();
    }
  });

  it("refuses a reorder with a missing, extra, or duplicate id, and an unknown Book", async () => {
    const { host, chapters } = orderedHost();
    try {
      const client = createPluginClient(host.port);
      const before = chapters.map((chapter) => chapter.order);
      for (const chapterIds of [
        ["c1", "c2"],
        ["c1", "c2", "c3", "absent"],
        ["c1", "c2", "c2"],
      ]) {
        await expect(client.library.chapters.reorder({ bookId: "b1", chapterIds })).rejects
          .toMatchObject({ code: "invalid-params" });
      }
      await expect(
        client.library.chapters.reorder({ bookId: "absent", chapterIds: ["c1", "c2", "c3"] })
      ).rejects.toMatchObject({
        code: "invalid-params",
        message: "Book absent does not exist",
      });
      expect(chapters.map((chapter) => chapter.order)).toEqual(before);
    } finally {
      host.stop();
    }
  });

  it("creates a Chapter at its 0-based position, shifting the later ones", async () => {
    const { host } = orderedHost();
    try {
      const client = createPluginClient(host.port);
      const { chapterId } = await client.library.chapters.create({
        bookId: "b1",
        title: "Inserted",
        position: 1,
        content: { text: "Two words" },
      });

      await expect(client.library.chapters.list({ bookId: "b1" })).resolves.toMatchObject([
        { id: "c1", order: 0 },
        { id: chapterId, title: "Inserted", order: 1, wordCount: 2 },
        { id: "c2", order: 2 },
        { id: "c3", order: 3 },
      ]);
      await expect(client.library.chapters.get({ chapterId })).resolves.toMatchObject({
        content: { text: "Two words", html: "<p>Two words</p>" },
      });
    } finally {
      host.stop();
    }
  });

  it("creates a Chapter at the end when position is omitted", async () => {
    const { host } = orderedHost();
    try {
      const client = createPluginClient(host.port);
      const { chapterId } = await client.library.chapters.create({
        bookId: "b1",
        title: "Last",
      });

      await expect(client.library.chapters.list({ bookId: "b1" })).resolves.toMatchObject([
        { id: "c1", order: 0 },
        { id: "c2", order: 1 },
        { id: "c3", order: 2 },
        { id: chapterId, order: 3 },
      ]);
    } finally {
      host.stop();
    }
  });

  it("refuses a create past the Book's Chapter count and an unknown Book, adding no row", async () => {
    const { host } = orderedHost();
    try {
      const client = createPluginClient(host.port);
      await expect(
        client.library.chapters.create({ bookId: "b1", title: "Too far", position: 4 })
      ).rejects.toMatchObject({
        code: "invalid-params",
        message: "position 4 is outside 0 to 3 for Book b1",
      });
      await expect(
        client.library.chapters.create({ bookId: "absent", title: "Nowhere" })
      ).rejects.toMatchObject({
        code: "invalid-params",
        message: "Book absent does not exist",
      });
      await expect(client.library.chapters.list({ bookId: "b1" })).resolves.toHaveLength(3);
    } finally {
      host.stop();
    }
  });

  it("deletes a Chapter, so the reads no longer serve it", async () => {
    const { host } = orderedHost();
    try {
      const client = createPluginClient(host.port);
      await expect(client.library.chapters.delete({ chapterId: "c2" })).resolves.toBeNull();

      await expect(client.library.chapters.get({ chapterId: "c2" })).resolves.toBeNull();
      await expect(client.library.chapters.list({ bookId: "b1" })).resolves.toMatchObject([
        { id: "c1" },
        { id: "c3" },
      ]);
    } finally {
      host.stop();
    }
  });

  it("refuses a delete of an unknown Chapter, leaving the Book alone", async () => {
    const { host } = orderedHost();
    try {
      const client = createPluginClient(host.port);
      await expect(client.library.chapters.delete({ chapterId: "absent" })).rejects.toMatchObject({
        code: "invalid-params",
        message: "Chapter absent does not exist",
      });
    } finally {
      host.stop();
    }
  });

  it("updates Book fields, and a null Genre or Target Word Count clears it", async () => {
    const book = { ...BOOK, genre: "Sci-fi", targetWordCount: 500 };
    const host = createTestHost({
      manifest: writeManifest(),
      permissions: ["library:read", "library:write"],
      library: { books: [book] },
    });
    try {
      const client = createPluginClient(host.port);
      await expect(client.library.books.update({ bookId: "b1", title: "Dune Messiah" })).resolves
        .toBeNull();
      expect(book.title).toBe("Dune Messiah");

      await expect(
        client.library.books.update({ bookId: "b1", genre: null, targetWordCount: null })
      ).resolves.toBeNull();
      expect(book.genre).toBeNull();
      expect(book.targetWordCount).toBeNull();
    } finally {
      host.stop();
    }
  });

  it("refuses a Book update naming no field and an unknown Book", async () => {
    const host = createTestHost({
      manifest: writeManifest(),
      permissions: ["library:read", "library:write"],
      library: { books: [{ ...BOOK }] },
    });
    try {
      const client = createPluginClient(host.port);
      await expect(client.library.books.update({ bookId: "b1" })).rejects.toMatchObject({
        code: "invalid-params",
        message: "Give at least one Book field to update",
      });
      await expect(
        client.library.books.update({ bookId: "absent", title: "Nowhere" })
      ).rejects.toMatchObject({
        code: "invalid-params",
        message: "Book absent does not exist",
      });
    } finally {
      host.stop();
    }
  });

  it("marks the Book changed on a Chapter field, order, create, or delete write", async () => {
    const { host } = orderedHost();
    try {
      const client = createPluginClient(host.port);
      await client.library.books.checkpoint({ bookId: "b1", label: "Before" });
      expect(host.checkpoints).toHaveLength(1);

      await client.library.chapters.update({ chapterId: "c1", status: "revised" });
      await expect(client.library.books.checkpoint({ bookId: "b1", label: "After" })).resolves
        .toMatchObject({ versionId: expect.any(String) });
      await client.library.chapters.reorder({ bookId: "b1", chapterIds: ["c2", "c1", "c3"] });
      await expect(client.library.books.checkpoint({ bookId: "b1", label: "After" })).resolves
        .toMatchObject({ versionId: expect.any(String) });
      await client.library.chapters.delete({ chapterId: "c3" });
      await expect(client.library.books.checkpoint({ bookId: "b1", label: "After" })).resolves
        .toMatchObject({ versionId: expect.any(String) });
    } finally {
      host.stop();
    }
  });
});
