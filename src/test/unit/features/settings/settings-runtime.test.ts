import { describe, expect, it, afterEach } from "vitest";
import { buildOutline } from "@/features/settings/outline";
import { SETTINGS_SECTIONS } from "@/components/settings/settings-sections";
import {
  registerPluginSettingsRows,
  isPluginSettingsRowId,
  findPluginSettingsRow,
  getPluginSettingsOwners,
  getPluginSettingsRows,
  resolvePluginSettingsRowRename,
  type PluginSettingsRowDef,
} from "@/features/settings/rows";

const unregisters: Array<() => void> = [];
afterEach(() => {
  while (unregisters.length > 0) unregisters.pop()?.();
});

function register(
  pluginId: string,
  displayName: string,
  rows: Array<{ id: string; label: string }>,
  renames?: Record<string, string>
) {
  const unregister = registerPluginSettingsRows(pluginId, {
    displayName,
    rows,
    ...(renames ? { rowRenames: renames } : {}),
  });
  unregisters.push(unregister);
  return unregister;
}

describe("settings runtime rows (issue #429)", () => {
  it("recognizes plugin row id shape", () => {
    expect(isPluginSettingsRowId("plugin.echoes.threshold")).toBe(true);
    expect(isPluginSettingsRowId("theme")).toBe(false);
  });

  it("finds a runtime row by its full id without running anything", () => {
    register("echoes", "Echoes", [{ id: "threshold", label: "Echo threshold" }]);
    const found = findPluginSettingsRow("plugin.echoes.threshold");
    expect(found?.pluginId).toBe("echoes");
    expect(found?.row.label).toBe("Echo threshold");
    expect(found?.row.id).toBe("plugin.echoes.threshold");
  });

  it("orders owners Maibuk first, then display name, then id", () => {
    register("zebra", "Zebra", [{ id: "a", label: "A" }]);
    register("maibuk-echoes", "Echoes", [{ id: "a", label: "A" }]);
    register("alpha", "Alpha", [{ id: "a", label: "A" }]);
    const owners = getPluginSettingsOwners().map((o) => o.pluginId);
    expect(owners).toEqual(["maibuk-echoes", "alpha", "zebra"]);
  });

  it("migrates stored row ids within one owner via rowRenames", () => {
    register("echoes", "Echoes", [{ id: "threshold", label: "Threshold" }], {
      oldThreshold: "threshold",
    });
    expect(resolvePluginSettingsRowRename("plugin.echoes.oldThreshold")).toBe(
      "plugin.echoes.threshold"
    );
    // Absent plugin keeps its id.
    expect(resolvePluginSettingsRowRename("plugin.gone.old")).toBe("plugin.gone.old");
  });

  it("keeps declared order within an owner", () => {
    register("echoes", "Echoes", [
      { id: "second", label: "Second" },
      { id: "first", label: "First" },
    ]);
    const found = findPluginSettingsRow("plugin.echoes.first");
    expect(found).toBeDefined();
    // Order checked via owners + rows accessor.
    const rows: PluginSettingsRowDef[] = getPluginSettingsRows("echoes");
    expect(rows.map((r) => r.localId)).toEqual(["second", "first"]);
  });

  it("appears in the Settings outline search without running anything", () => {
    register("echoes", "Echoes", [{ id: "threshold", label: "Echo threshold" }]);
    const translate = (key: string) => key;
    const outline = buildOutline(SETTINGS_SECTIONS, {
      present: ["plugins"],
      platform: "web",
      translate,
      query: "echo",
      openSection: null,
    });
    const plugins = outline.find((section) => section.id === "plugins");
    expect(plugins?.rows.map((row) => row.id)).toContain("plugin.echoes.threshold");
  });

  it("returns a stable owners snapshot that refreshes on registry change", () => {
    expect(getPluginSettingsOwners()).toEqual([]);
    const first = getPluginSettingsOwners();
    expect(getPluginSettingsOwners()).toBe(first);
    const unregister = registerPluginSettingsRows("echoes", {
      displayName: "Echoes",
      rows: [{ id: "threshold", label: "Echo threshold" }],
    });
    unregisters.push(unregister);
    expect(getPluginSettingsOwners()).not.toBe(first);
    expect(getPluginSettingsOwners().map((owner) => owner.pluginId)).toEqual(["echoes"]);
  });
});
