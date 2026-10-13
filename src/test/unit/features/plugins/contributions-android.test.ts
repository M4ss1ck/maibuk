/**
 * Contributions on Android (#447, T8): the host runs no Plugin there, so
 * registering an otherwise-everywhere manifest must add nothing to any shared
 * registry — no Command, page, sidebar entry, Settings row, toolbar button, or
 * Item Menu entry. The platform is forced through the platform flags the way the
 * Settings section test forces it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPluginItemMenuEntries,
  getPluginPages,
  getPluginSidebarEntries,
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import { getPluginSettingsOwners, getPluginSettingsRows } from "@/features/settings/rows";
import { registeredToolbarButtons } from "@/features/settings/toolbar-config";
import { isCommandId } from "@/lib/shortcut-registry";
import { pluginFolder } from "@/test/support/plugin-fixtures";
import i18n from "@/i18n";

vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return {
    ...actual,
    get IS_WEB() {
      return false;
    },
    get IS_TAURI() {
      return true;
    },
    get IS_MOBILE() {
      return true;
    },
    get IS_DESKTOP() {
      return false;
    },
    get IS_ANDROID() {
      return true;
    },
  };
});

const cleanups: Array<() => void> = [];

afterEach(async () => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
  await i18n.changeLanguage("en");
});

describe("registerPluginContributions on Android", () => {
  it("registers nothing for a manifest that runs everywhere", () => {
    const folder = pluginFolder({}, {
      id: "sample",
      name: "Sample",
      platforms: ["web", "desktop", "android"],
      lifecycle: "persistent",
      contributes: {
        commands: [
          { id: "open", label: "Open report", contexts: ["global"], navigates: true },
          { id: "report", label: "Report", contexts: ["global"], targets: ["chapter"] },
        ],
        pages: [{ id: "report", title: "Report", command: "open" }],
        sidebarEntries: [{ page: "report", icon: "book-open" }],
        settingsRows: [{ id: "threshold", label: "Threshold" }],
        toolbarButtons: [{ id: "reportButton", command: "report", icon: "book-open" }],
        itemMenuEntries: [{ command: "report" }],
      },
    });
    const read = readPluginManifest(folder);
    if (!read.ok) throw new Error(`fixture manifest is invalid: ${JSON.stringify(read.problems)}`);

    cleanups.push(registerPluginContributions({ manifest: read.manifest, folder }));

    expect(isCommandId("plugin.sample.open")).toBe(false);
    expect(isCommandId("plugin.sample.report")).toBe(false);
    expect(getPluginPages()).toEqual([]);
    expect(getPluginSidebarEntries()).toEqual([]);
    expect(getPluginItemMenuEntries("chapter")).toEqual([]);
    expect(registeredToolbarButtons()).toEqual([]);
    expect(getPluginSettingsOwners()).toEqual([]);
    expect(getPluginSettingsRows("sample")).toEqual([]);
  });
});
