/**
 * The test kit drives the same tracer fixture the E2E lane seeds into OPFS
 * (issue #434). The fixture is loaded as a real ES module from its file, with
 * `fetch` injected, so the bytes under test are exactly the bytes the browser
 * lanes run; a drift in its protocol strings fails here first.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";
import { createTestHost } from "@/features/plugins/test-kit";
import { PLUGIN_READY_MESSAGE } from "@/plugin-sdk/protocol";
import { createPluginClient } from "@/plugin-sdk";

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
          { variant: "info", message: "tracer ready; direct fetch: refused" },
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

describe("the tracer fixture and the protocol", () => {
  it("signals readiness with the protocol's ready kind", () => {
    const source = readFileSync(join(FIXTURE_DIR, "index.js"), "utf8");
    expect(source).toContain(PLUGIN_READY_MESSAGE.kind);
  });
});
