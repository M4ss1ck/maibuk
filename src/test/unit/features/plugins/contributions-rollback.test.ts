/**
 * A partial registration must not leak (the palette keeps no ghost Commands):
 * when one of the registries apply() calls refuses, what earlier calls in the
 * same apply() stored is undone, the contributions map is cleaned, and the
 * error is rethrown. A language re-apply fails the same way without throwing
 * into i18next: it logs and unwinds. The lifecycle isolation test mocks the
 * whole function and cannot catch this, so these mocks throw from inside the
 * real one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPluginPage,
  getPluginPages,
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import { getPluginSettingsOwners } from "@/features/settings/rows";
import { registeredToolbarButtons } from "@/features/settings/toolbar-config";
import { isCommandId } from "@/lib/shortcut-registry";
import i18n from "@/i18n";
import { pluginFolder } from "@/test/support/plugin-fixtures";

// Calls 1..`passing` succeed, later calls throw.
let toolbarCalls = 0;
let passing = Number.POSITIVE_INFINITY;

vi.mock("@/features/settings/toolbar-config", async (importOriginal) => {
  const mod = await importOriginal<
    typeof import("@/features/settings/toolbar-config")
  >();
  return {
    ...mod,
    registerToolbarButtons: ((
      pluginId: Parameters<typeof mod.registerToolbarButtons>[0],
      registration: Parameters<typeof mod.registerToolbarButtons>[1]
    ) => {
      toolbarCalls += 1;
      if (toolbarCalls > passing) throw new Error("toolbar refused");
      return mod.registerToolbarButtons(pluginId, registration);
    }) as typeof mod.registerToolbarButtons,
  };
});

const cleanups: Array<() => void> = [];

function sampleSource(toolbar: boolean) {
  const folder = pluginFolder(
    {},
    {
      id: "sample",
      name: "Sample",
      platforms: ["desktop"],
      contributes: {
        commands: [{ id: "report", label: "Report", contexts: ["global"] }],
        ...(toolbar
          ? { toolbarButtons: [{ id: "reportButton", command: "report", icon: "book-open" }] }
          : {}),
      },
    }
  );
  const parsed = readPluginManifest(folder);
  if (!parsed.ok) throw new Error("fixture manifest is invalid");
  return { manifest: parsed.manifest, folder };
}

beforeEach(() => {
  toolbarCalls = 0;
  passing = Number.POSITIVE_INFINITY;
});

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
});

describe("partial registration rollback", () => {
  it("unregisters what an apply stored before a later registry call threw", () => {
    passing = 0;
    expect(() => registerPluginContributions(sampleSource(true))).toThrow("toolbar refused");

    expect(isCommandId("plugin.sample.report")).toBe(false);
    expect(getPluginPages()).toEqual([]);
    expect(getPluginSettingsOwners()).toEqual([]);
    expect(registeredToolbarButtons()).toEqual([]);
  });

  it("catches, logs, and unregisters when a language re-apply throws", async () => {
    passing = 1;
    cleanups.push(registerPluginContributions(sampleSource(true)));
    expect(isCommandId("plugin.sample.report")).toBe(true);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await i18n.changeLanguage("es");

      expect(isCommandId("plugin.sample.report")).toBe(false);
      expect(getPluginPage("sample", "report")).toBeUndefined();
      expect(getPluginSettingsOwners()).toEqual([]);
      expect(getPluginPages()).toEqual([]);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      await i18n.changeLanguage("en");
    }
  });

  it("registers the same Plugin again after a failed first apply", () => {
    passing = 0;
    expect(() => registerPluginContributions(sampleSource(true))).toThrow("toolbar refused");

    passing = Number.POSITIVE_INFINITY;
    cleanups.push(registerPluginContributions(sampleSource(false)));
    expect(isCommandId("plugin.sample.report")).toBe(true);
    expect(getPluginPages()).toEqual([]);
  });
});
