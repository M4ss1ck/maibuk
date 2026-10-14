/**
 * Echoes' Plugin-level behavior (#450, unit 1) through the supported Plugin
 * test kit: the real broker, method table, and Remote UI renderer. The runtime
 * is driven over the polyfill-free `@/plugin-sdk/ui-serve` entry, the same one
 * the kit's jsdom uses; `index.tsx` (the Worker bootstrap) is never imported.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/i18n";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";
import { createTestHost } from "@/features/plugins/test-kit";
import type { PluginManifest } from "@/features/plugins/types";
import { createPluginClient } from "@/plugin-sdk";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import { FIND_ECHOES, REPORT_PAGE_ID, startEchoes } from "./runtime";

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

function echoesManifest(): PluginManifest {
  const result = parsePluginManifest(readFileSync(join(__dirname, "manifest.json"), "utf8"), {
    builtIn: true,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.manifest;
}

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
      expect(await screen.findByText(CHAPTER.title)).toBeInTheDocument();
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
      expect(await screen.findByText(en["report.placeholder"])).toBeInTheDocument();
      expect(await screen.findByText(BOOK.title)).toBeInTheDocument();
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
      expect(await screen.findByText(en["report.placeholder"])).toBeInTheDocument();

      await act(async () => {
        host.setLanguage("es");
      });
      expect(await screen.findByText(es["report.placeholder"])).toBeInTheDocument();
      page.unmount();
    } finally {
      host.stop();
    }
  });
});
