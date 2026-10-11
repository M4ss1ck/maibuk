import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLUGIN_APPROVALS_STORAGE_KEY, savePluginApproval } from "@/features/plugins/approvals";
import { pluginCommandBindings, runPluginCommand } from "@/features/plugins/commands";
import {
  getPluginItemMenuEntries,
  getPluginPages,
  getPluginSidebarEntries,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { createPluginLifecycle } from "@/features/plugins/lifecycle";
import type { PluginLifecycle } from "@/features/plugins/types";
import { getPluginSettingsOwners } from "@/features/settings/rows";
import { registeredToolbarButtons } from "@/features/settings/toolbar-config";
import { isCommandId } from "@/lib/shortcut-registry";
import {
  fakePluginFrame,
  installMicrotaskMessageChannel,
  pluginFolder,
} from "@/test/support/plugin-fixtures";
import { waitFor } from "@testing-library/react";

const lifecycles: PluginLifecycle[] = [];
let restoreMessageChannel: (() => void) | null = null;

beforeEach(() => {
  restoreMessageChannel = installMicrotaskMessageChannel();
});

afterEach(() => {
  for (const lifecycle of lifecycles.splice(0)) lifecycle.dispose();
  restoreMessageChannel?.();
  restoreMessageChannel = null;
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  resetPluginContributionsForTests();
});

async function launchApproved(overrides: Parameters<typeof pluginFolder>[1] = {}) {
  const folder = pluginFolder(
    {},
    {
      id: "sample",
      name: "Sample",
      platforms: ["desktop"],
      lifecycle: "persistent",
      contributes: {
        commands: [
          { id: "open", label: "Open report", contexts: ["global"], navigates: true },
          { id: "refresh", label: "Refresh", contexts: ["global"] },
          {
            id: "report",
            label: "Report",
            contexts: ["global"],
            targets: ["chapter"],
          },
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
  savePluginApproval({
    pluginId: "sample",
    pinnedHash: await hashPluginDirectory(folder.files),
    granted: [],
  });
  const lifecycle = createPluginLifecycle({
    directory: {
      listFolders: async () => ["sample"],
      readFolder: async () => folder,
    },
    createFrame: () => fakePluginFrame(),
    scheduleIdle: (work) => work(),
    whenLaunchSettled: async () => undefined,
    dataVersions: { get: async () => null, set: async () => undefined },
  });
  lifecycles.push(lifecycle);
  await lifecycle.launch();
  return lifecycle;
}

describe("a launched Plugin's contributions", () => {
  it("are present while enabled and gone when it is disposed", async () => {
    const lifecycle = await launchApproved();

    expect(isCommandId("plugin.sample.open")).toBe(true);
    expect(getPluginSettingsOwners().map((owner) => owner.pluginId)).toContain("sample");
    expect(registeredToolbarButtons().map((button) => button.id)).toEqual([
      "plugin.sample.reportButton",
    ]);
    expect(getPluginPages().map((page) => page.localId)).toEqual(["report"]);
    expect(getPluginSidebarEntries().map((entry) => entry.pageRoute)).toEqual([
      "/plugin/sample/report",
    ]);
    expect(getPluginItemMenuEntries("chapter").map((entry) => entry.localId)).toEqual(["report"]);
    expect(getPluginItemMenuEntries("note")).toEqual([]);

    lifecycle.dispose();

    expect(isCommandId("plugin.sample.open")).toBe(false);
    expect(getPluginSettingsOwners()).toEqual([]);
    expect(registeredToolbarButtons()).toEqual([]);
    expect(getPluginPages()).toEqual([]);
    expect(getPluginSidebarEntries()).toEqual([]);
  });

  it.each([
    ["Command", () => expect(isCommandId("plugin.sample.open")).toBe(true)],
    [
      "page",
      () => expect(getPluginPages().map((page) => page.localId)).toEqual(["report"]),
    ],
    [
      "sidebar entry",
      () =>
        expect(getPluginSidebarEntries().map((entry) => entry.pageRoute)).toEqual([
          "/plugin/sample/report",
        ]),
    ],
    [
      "Settings row",
      () =>
        expect(getPluginSettingsOwners().map((owner) => owner.pluginId)).toContain("sample"),
    ],
    [
      "toolbar button",
      () =>
        expect(registeredToolbarButtons().map((button) => button.id)).toEqual([
          "plugin.sample.reportButton",
        ]),
    ],
    [
      "Item Menu entry",
      () =>
        expect(getPluginItemMenuEntries("chapter").map((entry) => entry.localId)).toEqual([
          "report",
        ]),
    ],
  ])("presents its %s while enabled and removes it on dispose", async (_kind, present) => {
    const lifecycle = await launchApproved();
    present();
    lifecycle.dispose();
    expect(isCommandId("plugin.sample.open")).toBe(false);
    expect(getPluginPages()).toEqual([]);
    expect(getPluginSidebarEntries()).toEqual([]);
    expect(getPluginSettingsOwners()).toEqual([]);
    expect(registeredToolbarButtons()).toEqual([]);
    expect(getPluginItemMenuEntries("chapter")).toEqual([]);
  });

  it("leaves retained preferences intact on disable", async () => {
    const { useShortcutSettingsStore } = await import("@/features/settings/shortcut-store");
    const { resolveStoredToolbarButtonId, isLiveToolbarEntry } = await import(
      "@/features/settings/toolbar-config"
    );
    useShortcutSettingsStore.setState((state) => ({
      shortcuts: {
        ...state.shortcuts,
        custom: { ...state.shortcuts.custom, "plugin.sample.refresh": [["Mod", "Alt", "r"]] },
      },
    }));

    const lifecycle = await launchApproved();
    await waitFor(() => expect(lifecycle.state("sample")?.status).toBe("ready"));
    expect(isCommandId("plugin.sample.refresh")).toBe(true);
    expect(isLiveToolbarEntry("plugin.sample.reportButton")).toBe(true);

    lifecycle.dispose();

    // Disabling removes the surfaces but keeps the author's preferences for return.
    expect(isCommandId("plugin.sample.refresh")).toBe(false);
    expect(isLiveToolbarEntry("plugin.sample.reportButton")).toBe(false);
    expect(
      useShortcutSettingsStore.getState().shortcuts.custom["plugin.sample.refresh"]
    ).toEqual([["Mod", "Alt", "r"]]);
    // The toolbar arrangement retains the absent Plugin's button id.
    expect(resolveStoredToolbarButtonId("plugin.sample.reportButton")).toBe(
      "plugin.sample.reportButton"
    );
    useShortcutSettingsStore.getState().resetAllShortcuts();
  });

  it("bind its Command once ready, run it through the broker, and unbind it once stopped", async () => {
    const lifecycle = await launchApproved();
    await waitFor(() => expect(lifecycle.state("sample")?.status).toBe("ready"));

    const beforeReady = pluginCommandBindings(lifecycle, () => {}).find(
      (binding) => binding.id === "plugin.sample.refresh"
    );
    expect(beforeReady?.enabled).toBe(true);
    await expect(runPluginCommand(lifecycle, "sample", "refresh")).resolves.toBe("ran");

    lifecycle.stop("sample");
    const stopped = pluginCommandBindings(lifecycle, () => {}).find(
      (binding) => binding.id === "plugin.sample.refresh"
    );
    expect(stopped?.enabled).toBe(false);
  });
});
