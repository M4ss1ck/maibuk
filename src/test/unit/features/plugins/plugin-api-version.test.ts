import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_API_VERSION } from "@/features/plugins/api-table";
import { checkPluginCompatibility } from "@/features/plugins/manifest-compat";
import { validateManifestValue } from "@/features/plugins/manifest-validate";
import type { PluginManifest } from "@/features/plugins/types";

// ADR 0029: before 1.0 a Plugin API patch is additive, so a `^0.1` Plugin keeps
// loading on 0.1.1, and a Plugin that needs the 0.1.1 addition declares `^0.1.1`
// and is refused by a 0.1.0 host with the usual compatibility message (#530).
// 0.1.2 adds the editor's language and the Ephemeral editor entity (ADR 0030).
// 0.1.3 adds the Plugin Endpoint request and its client.onEndpointRequest
// handler, which a Plugin holding `serve` answers (#586, ADR 0031).
// 0.1.4 adds the Plugin Endpoint address a Plugin reads and the event that
// tells it when that address moved (#587).
// 0.1.5 adds the Book and Chapter read fields and the Book, Chapter, and Note
// writes #588 added, all additive: a ^0.1.4 Plugin keeps loading.
// 0.1.6 adds permissions.granted and permissions.changed, so a Plugin learns
// the Plugin Permissions it holds (#591), all additive: a ^0.1.5 Plugin keeps
// loading.
// 0.1.7 adds expectedUpdatedAt to library.notes.update, so a Plugin's Note
// write is refused when the Note changed since it was read (#593), and Tags to
// library.notes.create, so a new Note lands with its Tags in the same write;
// both additive: a ^0.1.6 Plugin keeps loading.
// 0.1.8 adds library.search, so a Plugin searches the Library with the same
// query and switches as Library Search (#641), additive: a ^0.1.7 Plugin keeps
// loading.
// 0.1.9 adds the `files` namespace and its `files:pick` Plugin Permission, so a
// Plugin reads files the author picks (ADR 0036, #653), additive: a ^0.1.8
// Plugin keeps loading.

function manifestWith(apiVersion: string): PluginManifest {
  const result = validateManifestValue({
    manifestVersion: 1,
    id: "echoes",
    name: "Echoes",
    description: "Highlights overused words.",
    author: "Andy",
    version: "1.0.0",
    apiVersion,
    entry: "dist/index.js",
    platforms: ["desktop", "web", "android"],
    lifecycle: "on-demand",
    defaultLanguage: "en",
    permissions: { required: ["library:read"], optional: [] },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.manifest;
}

const APP = "0.12.0";

describe("Plugin API patch compatibility (ADR 0029)", () => {
  it("the host reports Plugin API 0.1.9", () => {
    expect(PLUGIN_API_VERSION).toBe("0.1.9");
  });

  it("a ^0.1.7 Plugin still loads against the 0.1.9 host", () => {
    const verdict = checkPluginCompatibility(manifestWith("^0.1.7"), {
      apiVersion: "0.1.9",
      appVersion: APP,
    });
    expect(verdict.verdict).toBe("ok");
  });

  it("a ^0.1.6 Plugin still loads against the 0.1.9 host", () => {
    const verdict = checkPluginCompatibility(manifestWith("^0.1.6"), {
      apiVersion: "0.1.9",
      appVersion: APP,
    });
    expect(verdict.verdict).toBe("ok");
  });

  it("a ^0.1.5 Plugin still loads against the 0.1.9 host", () => {
    const verdict = checkPluginCompatibility(manifestWith("^0.1.5"), {
      apiVersion: "0.1.9",
      appVersion: APP,
    });
    expect(verdict.verdict).toBe("ok");
  });

  it("a ^0.1.4 Plugin still loads against the 0.1.9 host", () => {
    const verdict = checkPluginCompatibility(manifestWith("^0.1.4"), {
      apiVersion: "0.1.9",
      appVersion: APP,
    });
    expect(verdict.verdict).toBe("ok");
  });

  it("a ^0.1.3 Plugin still loads against the 0.1.9 host", () => {
    const verdict = checkPluginCompatibility(manifestWith("^0.1.3"), {
      apiVersion: "0.1.9",
      appVersion: APP,
    });
    expect(verdict.verdict).toBe("ok");
  });

  it("a ^0.1.2 Plugin still loads against the 0.1.9 host", () => {
    const verdict = checkPluginCompatibility(manifestWith("^0.1.2"), {
      apiVersion: "0.1.9",
      appVersion: APP,
    });
    expect(verdict.verdict).toBe("ok");
  });

  it("a ^0.1.1 Plugin still loads against the 0.1.9 host", () => {
    const verdict = checkPluginCompatibility(manifestWith("^0.1.1"), {
      apiVersion: "0.1.9",
      appVersion: APP,
    });
    expect(verdict.verdict).toBe("ok");
  });

  it("a ^0.1 Plugin still loads against the 0.1.1 host", () => {
    const verdict = checkPluginCompatibility(manifestWith("^0.1"), {
      apiVersion: "0.1.1",
      appVersion: APP,
    });
    expect(verdict.verdict).toBe("ok");
  });

  it("a ^0.1.1 Plugin is refused by a 0.1.0 host with the usual message", () => {
    const verdict = checkPluginCompatibility(manifestWith("^0.1.1"), {
      apiVersion: "0.1.0",
      appVersion: APP,
    });
    expect(verdict).toEqual({
      verdict: "needs-newer-app",
      reason: "api-version",
      message: "Needs Plugin API ^0.1.1; this app provides 0.1.0",
    });
  });

  it("a ^0.1.7 Plugin is refused by a 0.1.6 host with the usual message", () => {
    const verdict = checkPluginCompatibility(manifestWith("^0.1.7"), {
      apiVersion: "0.1.6",
      appVersion: APP,
    });
    expect(verdict).toEqual({
      verdict: "needs-newer-app",
      reason: "api-version",
      message: "Needs Plugin API ^0.1.7; this app provides 0.1.6",
    });
  });

  it("a ^0.1.6 Plugin is refused by a 0.1.5 host with the usual message", () => {
    const verdict = checkPluginCompatibility(manifestWith("^0.1.6"), {
      apiVersion: "0.1.5",
      appVersion: APP,
    });
    expect(verdict).toEqual({
      verdict: "needs-newer-app",
      reason: "api-version",
      message: "Needs Plugin API ^0.1.6; this app provides 0.1.5",
    });
  });

  it("the Echoes manifest is 0.4.0 and needs Plugin API ^0.1.2", () => {
    const text = readFileSync(
      join(process.cwd(), "plugins", "maibuk-echoes", "manifest.json"),
      "utf8"
    );
    const json = JSON.parse(text) as { version: string; apiVersion: string };
    expect(json.version).toBe("0.4.0");
    expect(json.apiVersion).toBe("^0.1.2");
  });
});
