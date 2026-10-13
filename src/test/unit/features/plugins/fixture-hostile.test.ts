// @vitest-environment node
/**
 * The fixture-hostile Plugin source (issue #446): one escape attempt per
 * Command, so the @sandbox E2E lane can prove every escape fails safely on the
 * real engines. The manifest is committed by hand under
 * e2e/fixtures/plugin-sources/, so this guards it before global setup ever
 * bundles the Plugin. The list below is the manifest's contract with the E2E
 * spec (`e2e/specs/plugins-hostile.spec.ts`): the two must name the same
 * Commands, or a spec would run a Command that does not exist.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_PERMISSION_NAMES, parsePluginManifest } from "@/features/plugins/manifest-validate";
import type { PluginManifest } from "@/features/plugins/types";

const SOURCE_DIR = join(process.cwd(), "e2e/fixtures/plugin-sources/fixture-hostile");

/** Every escape Command the fixture must declare, one per escape attempt. */
const ESCAPE_COMMANDS = [
  "escapeFetch",
  "escapeXhr",
  "escapeWebSocket",
  "escapeEventSource",
  "escapeSendBeacon",
  "escapeImportScripts",
  "escapeDynamicImport",
  "escapeEval",
  "escapeDataWorker",
  "escapeIndexedDb",
  "escapeCaches",
  "escapeLocalStorage",
  "escapeTauriIpc",
  "escapeOversized",
  "escapeUnknownMethod",
  "escapeSpoofedReply",
  "escapeWrite",
  "escapeAfterRevoke",
  "escapeBusyLoop",
  "escapeAllocate",
  "escapeFlood",
] as const;

function readManifest(): PluginManifest {
  const result = parsePluginManifest(readFileSync(join(SOURCE_DIR, "manifest.json"), "utf8"));
  if (!result.ok) throw new Error(`manifest.json: ${JSON.stringify(result.problems, null, 2)}`);
  return result.manifest;
}

describe("fixture-hostile Plugin source", () => {
  it("parses with the real validator", () => {
    const manifest = readManifest();
    expect(manifest.id).toBe("fixture-hostile");
    expect(manifest.lifecycle).toBe("persistent");
  });

  it("declares one Command per escape attempt, plus the page-ops", () => {
    const ids = new Set((readManifest().contributes?.commands ?? []).map((command) => command.id));
    for (const id of ESCAPE_COMMANDS) {
      expect(ids.has(id), `missing Command ${id}`).toBe(true);
    }
    // The page opener and the Remote UI violation and flood Commands.
    expect(ids.has("openPanel")).toBe(true);
    expect(ids.has("uiViolation")).toBe(true);
    expect(ids.has("uiFlood")).toBe(true);
  });

  it("asks only for library:read, so a write and a revoked read are both refused", () => {
    const { required, optional } = readManifest().permissions;
    expect(required).toEqual([]);
    expect(optional).toEqual(["library:read"]);
    for (const permission of [...required, ...optional]) {
      expect(PLUGIN_PERMISSION_NAMES).toContain(permission);
    }
    // library:write is deliberately never declared: the write escape must be
    // refused for lack of the Plugin Permission, not for lack of a handler.
    expect([...required, ...optional]).not.toContain("library:write");
  });

  it("declares the readiness page and the Remote UI violation and flood pages", () => {
    const pages = readManifest().contributes?.pages ?? [];
    expect(pages.map((page) => page.id).sort()).toEqual(["flood", "panel", "violation"]);
  });
});
