/**
 * Test-only helpers shared by the Reader suites. It reads the `manifest.json`
 * the build ships and parses it the way the host validates it, and it builds
 * the small byte arrays and Shelf rows the tests seed. Never imported by the
 * runtime: the Built-in build bundles only the entry and its import graph, and
 * the import-boundary test skips this file the way it skips a `.test` file.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type userEvent from "@testing-library/user-event";
import type { PluginManifest } from "@/features/plugins/types";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";
import type { DocumentFormat, ShelfEntry } from "./shelf";

/** A `user-event` instance, as `userEvent.setup()` returns it. */
export type User = ReturnType<typeof userEvent.setup>;

/** Tabs forward until `element` has focus, so every action is reached by keyboard. */
export async function tabTo(user: User, element: HTMLElement, max = 40): Promise<void> {
  for (let i = 0; i < max && document.activeElement !== element; i++) await user.tab();
}

/** The Reader manifest the build ships, parsed with the host's Built-in rules. */
export function readerManifest(): PluginManifest {
  const result = parsePluginManifest(readFileSync(join(__dirname, "manifest.json"), "utf8"), {
    builtIn: true,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.manifest;
}

/** A fresh in-memory storage with no Shelf written yet. */
export function readerStorage(): Map<string, unknown> {
  return new Map();
}

const encoder = new TextEncoder();

/** A tiny PDF: enough magic for sniffing, no pages to render yet. */
export function pdfBytes(text = "Reader test"): Uint8Array {
  return encoder.encode(`%PDF-1.7\n${text}\n%%EOF\n`);
}

/** A tiny EPUB: a zip's local-file header and the given name decide its format. */
export function epubBytes(text = "Reader test"): Uint8Array {
  return encoder.encode(`PK\x03\x04${text}`);
}

/** One Shelf row, with the defaults a newly opened Document carries. */
export function shelfEntry(
  overrides: Partial<ShelfEntry> & Pick<ShelfEntry, "id" | "grant">
): ShelfEntry {
  return {
    fingerprint: `${overrides.id}:fingerprint`,
    title: "Dune",
    author: "",
    format: "pdf" as DocumentFormat,
    lastReadAt: 1_000,
    progress: null,
    state: "ok",
    ...overrides,
  };
}
