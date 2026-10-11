import { afterEach, describe, expect, it } from "vitest";
import {
  getPluginItemMenuEntries,
  getPluginPage,
  getPluginPages,
  getPluginSidebarEntries,
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import type { PluginFolder, PluginManifest } from "@/features/plugins/types";
import { getPluginSettingsOwners, getPluginSettingsRows } from "@/features/settings/rows";
import { registeredToolbarButtons } from "@/features/settings/toolbar-config";
import { commandLabel, getCommand, isCommandId, isPluginCommandDef } from "@/lib/shortcut-registry";
import { pluginFolder } from "@/test/support/plugin-fixtures";
import i18n from "@/i18n";

const cleanups: Array<() => void> = [];

afterEach(async () => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
  await i18n.changeLanguage("en");
});

function sourceOf(folder: PluginFolder): { manifest: PluginManifest; folder: PluginFolder } {
  const result = readPluginManifest(folder);
  if (!result.ok) throw new Error(`fixture manifest is invalid: ${JSON.stringify(result.problems)}`);
  return { manifest: result.manifest, folder };
}

function sampleFolder(overrides: Partial<PluginManifest> = {}): PluginFolder {
  return pluginFolder(
    {
      "locales/es.json": JSON.stringify({
        name: "Muestra",
        "commands.report.label": "Informe",
        "pages.report.title": "Informe de la muestra",
        "settingsRows.threshold.label": "Umbral",
      }),
    },
    {
      id: "sample",
      name: "Sample",
      platforms: ["desktop"],
      lifecycle: "on-demand",
      contributes: {
        commands: [
          { id: "open", label: "Open report", contexts: ["global"], navigates: true },
          { id: "report", label: "Report", contexts: ["global"], targets: ["chapter", "note"] },
        ],
        pages: [{ id: "report", title: "Report", command: "open" }],
        sidebarEntries: [{ page: "report", icon: "book-open" }],
        settingsRows: [{ id: "threshold", label: "Threshold" }],
        toolbarButtons: [{ id: "reportButton", command: "report", icon: "book-open" }],
        itemMenuEntries: [{ command: "report" }],
      },
      ...overrides,
    }
  );
}

describe("registerPluginContributions", () => {
  it("admits Commands with derived ids and every locale's label", () => {
    cleanups.push(registerPluginContributions(sourceOf(sampleFolder())));

    const id = "plugin.sample.report" as const;
    expect(isCommandId(id)).toBe(true);
    const definition = getCommand(id);
    if (!isPluginCommandDef(definition)) throw new Error("expected a Plugin Command");
    expect(definition.label).toBe("Report");
    expect(definition.labels.es).toBe("Informe");
  });

  it("registers Settings rows, toolbar buttons, pages, sidebar entries, and Item Menu entries", () => {
    cleanups.push(registerPluginContributions(sourceOf(sampleFolder())));

    expect(getPluginSettingsOwners().map((owner) => owner.pluginId)).toContain("sample");
    expect(getPluginSettingsRows("sample").map((row) => row.id)).toEqual([
      "plugin.sample.threshold",
    ]);
    expect(registeredToolbarButtons().map((button) => button.id)).toEqual([
      "plugin.sample.reportButton",
    ]);
    expect(getPluginPages().map((page) => page.localId)).toEqual(["report"]);
    expect(getPluginSidebarEntries().map((entry) => entry.pageRoute)).toEqual([
      "/plugin/sample/report",
    ]);
    expect(getPluginItemMenuEntries("chapter").map((entry) => entry.localId)).toEqual(["report"]);
    expect(getPluginItemMenuEntries("canvasNode")).toEqual([]);
    expect(getPluginPage("sample", "report")?.title).toBe("Report");
  });

  it("localizes page titles, sidebar labels, and Settings rows for the UI language", async () => {
    cleanups.push(registerPluginContributions(sourceOf(sampleFolder())));
    await i18n.changeLanguage("es");

    expect(getPluginPage("sample", "report")?.title).toBe("Informe de la muestra");
    expect(getPluginSettingsRows("sample")[0].label).toBe("Umbral");
    // The Command keeps its default-language literal and gains the locale, so
    // an English UI still shows English after a Spanish session.
    const definition = getCommand("plugin.sample.report" as const);
    if (!isPluginCommandDef(definition)) throw new Error("expected a Plugin Command");
    expect(definition.label).toBe("Report");
    expect(definition.labels.es).toBe("Informe");
    const translate = (key: string) => key;
    expect(commandLabel("plugin.sample.report" as const, translate, "en")).toBe("Report");
    expect(commandLabel("plugin.sample.report" as const, translate, "es")).toBe("Informe");
  });

  it("filters out a contribution that does not run on this platform", () => {
    const folder = sampleFolder({
      platforms: ["desktop", "android"],
      contributes: {
        commands: [
          { id: "open", label: "Open report", contexts: ["global"], navigates: true },
          {
            id: "report",
            label: "Report",
            contexts: ["global"],
            targets: ["chapter"],
            platforms: ["android"],
          },
        ],
        pages: [{ id: "report", title: "Report", command: "open" }],
        settingsRows: [{ id: "threshold", label: "Threshold" }],
        itemMenuEntries: [{ command: "report" }],
      },
    });
    cleanups.push(registerPluginContributions(sourceOf(folder)));

    expect(isCommandId("plugin.sample.report")).toBe(false);
    expect(isCommandId("plugin.sample.open")).toBe(true);
    expect(getPluginItemMenuEntries("chapter")).toEqual([]);
  });

  it("orders owners Maibuk first, then by display name, then id", () => {
    const rows = { settingsRows: [{ id: "a", label: "A" }] };
    const zebra = pluginFolder({}, { id: "zebra", name: "Zebra", platforms: ["desktop"], contributes: rows });
    const alpha = pluginFolder({}, { id: "alpha", name: "Alpha", platforms: ["desktop"], contributes: rows });
    const builtIn = pluginFolder(
      {},
      { id: "maibuk", name: "Zulu", platforms: ["desktop"], contributes: rows }
    );
    cleanups.push(registerPluginContributions(sourceOf(zebra)));
    cleanups.push(registerPluginContributions(sourceOf(alpha)));
    cleanups.push(registerPluginContributions(sourceOf(builtIn)));

    expect(getPluginSettingsOwners().map((owner) => owner.pluginId)).toEqual([
      "maibuk",
      "alpha",
      "zebra",
    ]);
  });

  it("orders sidebar and Item Menu entries Maibuk first, then Plugin name, then declared order", () => {
    const make = (id: string, name: string) =>
      sourceOf(
        pluginFolder(
          {},
          {
            id,
            name,
            platforms: ["desktop"],
            contributes: {
              commands: [
                { id: "open", label: "Open", contexts: ["global"], navigates: true },
                { id: "tag", label: "Tag", contexts: ["chapterItem"], targets: ["chapter"] },
              ],
              pages: [{ id: "page", title: `${name} page`, command: "open" }],
              sidebarEntries: [{ page: "page", icon: "book-open" }],
              itemMenuEntries: [{ command: "tag" }],
            },
          }
        )
      );
    cleanups.push(registerPluginContributions(make("zebra", "Zebra")));
    cleanups.push(registerPluginContributions(make("alpha", "Alpha")));
    cleanups.push(registerPluginContributions(make("maibuk", "Zulu")));

    expect(getPluginSidebarEntries().map((entry) => entry.pluginId)).toEqual([
      "maibuk",
      "alpha",
      "zebra",
    ]);
    expect(getPluginItemMenuEntries("chapter").map((entry) => entry.pluginId)).toEqual([
      "maibuk",
      "alpha",
      "zebra",
    ]);
  });

  it("removes every surface when unregistered", () => {
    const unregister = registerPluginContributions(sourceOf(sampleFolder()));
    expect(isCommandId("plugin.sample.open")).toBe(true);

    unregister();

    expect(isCommandId("plugin.sample.open")).toBe(false);
    expect(getPluginSettingsOwners().map((owner) => owner.pluginId)).not.toContain("sample");
    expect(registeredToolbarButtons()).toEqual([]);
    expect(getPluginPages()).toEqual([]);
    expect(getPluginSidebarEntries()).toEqual([]);
    expect(getPluginItemMenuEntries("chapter")).toEqual([]);
  });
});
