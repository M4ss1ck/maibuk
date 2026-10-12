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
