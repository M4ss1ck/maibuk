import { afterEach, describe, expect, it } from "vitest";
import {
  PLUGIN_APPROVALS_STORAGE_KEY,
  savePluginApproval,
} from "@/features/plugins/approvals";
import {
  dropSeededPluginContributions,
  getPluginSidebarEntries,
  resetPluginContributionsForTests,
  type PluginSidebarEntryDef,
} from "@/features/plugins/contributions-registry";
import { registerPluginContributions } from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import {
  PLUGIN_SIDEBAR_SNAPSHOT_KEY,
  persistPluginSidebarSnapshot,
  readPluginSidebarSnapshot,
  seedPluginSidebarFromSnapshot,
  writePluginSidebarSnapshot,
} from "@/features/plugins/sidebar-snapshot";
import { pluginFolder } from "@/test/support/plugin-fixtures";

function entry(pluginId: string, pageId: string, title = pageId): PluginSidebarEntryDef {
  return {
    pluginId,
    displayName: pluginId,
    pageId,
    pageRoute: `/plugin/${pluginId}/${pageId}`,
    title,
    icon: "book-open",
    commandId: `plugin.${pluginId}.open` as PluginSidebarEntryDef["commandId"],
  };
}

function approve(pluginId: string, enabled = true): void {
  savePluginApproval({
    pluginId,
    pinnedHash: "h1:any",
    granted: [],
    enabled,
    approvedVersion: "",
    approvedPermissions: { required: [], optional: [] },
    approvedFiles: {},
  });
}

function registerSample(pluginId: string): () => void {
  const folder = pluginFolder(
    {},
    {
      id: pluginId,
      name: "Sample",
      platforms: ["desktop", "web"],
      contributes: {
        commands: [{ id: "open", label: "Open report", contexts: ["global"], navigates: true }],
        pages: [{ id: "report", title: "Live report", command: "open" }],
        sidebarEntries: [{ page: "report", icon: "book-open" }],
      },
    }
  );
  const parsed = readPluginManifest(folder);
  if (!parsed.ok) throw new Error("fixture manifest is invalid");
  return registerPluginContributions({ manifest: parsed.manifest, folder });
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  localStorage.removeItem(PLUGIN_SIDEBAR_SNAPSHOT_KEY);
});

describe("Plugin sidebar snapshot", () => {
  it("seeds the saved entries of enabled Plugins before any scan", () => {
    approve("alpha");
    writePluginSidebarSnapshot([entry("alpha", "report", "Report")]);

    seedPluginSidebarFromSnapshot();

    expect(getPluginSidebarEntries()).toEqual([
      expect.objectContaining({
        pluginId: "alpha",
        pageRoute: "/plugin/alpha/report",
        title: "Report",
        icon: "book-open",
        seeded: true,
      }),
    ]);
  });

  it("never seeds a disabled or removed Plugin's saved entry", () => {
    approve("alpha");
    approve("off", false);
    writePluginSidebarSnapshot([entry("alpha", "report"), entry("off", "x"), entry("gone", "y")]);

    seedPluginSidebarFromSnapshot();

    expect(getPluginSidebarEntries().map((item) => item.pluginId)).toEqual(["alpha"]);
  });

  it.each([
    ["not JSON", "{"],
    ["the wrong version", JSON.stringify({ version: 99, entries: [entry("alpha", "report")] })],
    ["a non-list", JSON.stringify({ version: 1, entries: "nope" })],
  ])("seeds nothing from a snapshot that is %s", (_name, raw) => {
    approve("alpha");
    localStorage.setItem(PLUGIN_SIDEBAR_SNAPSHOT_KEY, raw);

    expect(() => seedPluginSidebarFromSnapshot()).not.toThrow();
    expect(getPluginSidebarEntries()).toEqual([]);
  });

  it("skips a malformed entry and rebuilds the route from the ids, never trusting a stored route", () => {
    approve("alpha");
    localStorage.setItem(
      PLUGIN_SIDEBAR_SNAPSHOT_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          { ...entry("alpha", "report"), pageRoute: "/settings" },
          { ...entry("alpha", "broken"), title: 42 },
          { ...entry("alpha", "badIcon"), icon: { elements: "nope" } },
          { ...entry("alpha", "../escape") },
        ],
      })
    );

    seedPluginSidebarFromSnapshot();

    expect(getPluginSidebarEntries().map((item) => item.pageRoute)).toEqual([
      "/plugin/alpha/report",
    ]);
  });

  it("lets the scan's registration replace a seeded entry", () => {
    approve("sample");
    writePluginSidebarSnapshot([entry("sample", "report", "Stale title")]);
    seedPluginSidebarFromSnapshot();

    cleanups.push(registerSample("sample"));

    expect(getPluginSidebarEntries()).toEqual([
      expect.objectContaining({ title: "Live report", pageRoute: "/plugin/sample/report" }),
    ]);
    expect(getPluginSidebarEntries()[0].seeded).toBeUndefined();
  });

  it("drops the seeded entries the scan never replaced", () => {
    approve("sample");
    approve("stale");
    writePluginSidebarSnapshot([entry("sample", "report"), entry("stale", "report")]);
    seedPluginSidebarFromSnapshot();
    cleanups.push(registerSample("sample"));

    dropSeededPluginContributions();

    expect(getPluginSidebarEntries().map((item) => item.pluginId)).toEqual(["sample"]);
  });

  it("saves the live entries on every contribution change once persistence starts", () => {
    const stop = persistPluginSidebarSnapshot();
    cleanups.push(stop);
    expect(readPluginSidebarSnapshot()).toEqual([]);

    const unregister = registerSample("sample");
    expect(readPluginSidebarSnapshot()).toEqual([
      expect.objectContaining({ pluginId: "sample", title: "Live report" }),
    ]);
    expect(readPluginSidebarSnapshot()[0].seeded).toBeUndefined();

    unregister();
    expect(readPluginSidebarSnapshot()).toEqual([]);

    stop();
    cleanups.push(registerSample("sample"));
    expect(readPluginSidebarSnapshot()).toEqual([]);
  });
});
