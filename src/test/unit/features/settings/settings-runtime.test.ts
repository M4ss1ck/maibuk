import { describe, expect, it, afterEach } from "vitest";
import { buildOutline, pluginCardEntries } from "@/features/settings/outline";
import { SETTINGS_SECTIONS } from "@/components/settings/settings-sections";
import { usePluginManagementStore } from "@/features/plugins/management";
import type { PluginManagementEntry } from "@/features/plugins/types";
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";
import {
  registerPluginSettingsRows,
  isPluginSettingsRowId,
  findPluginSettingsRow,
  getPluginSettingsOwners,
  getPluginSettingsRows,
  pluginCardRowId,
  pluginIdOfCardRow,
  pluginIdOfSettingsRow,
  resolvePluginSettingsRowRename,
  type PluginSettingsRowDef,
} from "@/features/settings/rows";

const unregisters: Array<() => void> = [];
afterEach(() => {
  while (unregisters.length > 0) unregisters.pop()?.();
});

/** A management entry for the store, seeded with only the fields the cards read. */
function pluginEntry(overrides: {
  pluginId: string;
  name: string;
  description?: string;
  locales?: PluginManagementEntry["locales"];
}): PluginManagementEntry {
  return {
    pluginId: overrides.pluginId,
    manifest: {
      ...PLUGIN_MANIFEST,
      id: overrides.pluginId,
      name: overrides.name,
      description: overrides.description ?? "",
    },
    approval: null,
    locales: overrides.locales ?? {},
  } as unknown as PluginManagementEntry;
}

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

  it("lists the Plugins section's cards instead of the runtime Plugin Settings rows", () => {
    register("echoes", "Echoes", [{ id: "threshold", label: "Echo threshold" }]);
    const translate = (key: string) => key;
    const pluginCards = [
      { id: pluginCardRowId("echoes"), label: "Ecos", description: "Find repeated passages." },
    ];
    const outline = buildOutline(SETTINGS_SECTIONS, {
      present: ["plugins"],
      platform: "web",
      translate,
      query: "",
      openSection: "plugins",
      pluginCards,
    });
    const plugins = outline.find((section) => section.id === "plugins");
    // The core Plugins rows first, then one entry per card.
    expect(plugins?.rows.map((row) => row.id)).toEqual([
      "pluginDevelopmentMode",
      "pluginsAdd",
      "pluginsFilter",
      pluginCardRowId("echoes"),
    ]);
    // The old runtime Plugin Settings row is no longer an outline entry.
    expect(plugins?.rows.map((row) => row.id)).not.toContain("plugin.echoes.threshold");
  });

  it("matches a Plugin card name case- and accent-insensitively", () => {
    const translate = (key: string) => key;
    const pluginCards = [
      { id: pluginCardRowId("echoes"), label: "Ecos", description: "" },
    ];
    const outline = buildOutline(SETTINGS_SECTIONS, {
      present: ["plugins"],
      platform: "web",
      translate,
      query: "ecos",
      openSection: null,
      pluginCards,
    });
    const plugins = outline.find((section) => section.id === "plugins");
    expect(plugins?.rows.map((row) => row.label)).toEqual(["Ecos"]);
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

describe("Plugin card row ids", () => {
  it("round-trips a Plugin id and never collides with another row id", () => {
    expect(pluginCardRowId("echoes")).toBe("pluginCard.echoes");
    expect(pluginIdOfCardRow(pluginCardRowId("echoes"))).toBe("echoes");
    expect(pluginIdOfCardRow(pluginCardRowId("maibuk-echoes-2"))).toBe("maibuk-echoes-2");

    // Only a `pluginCard.<pluginId>` id resolves; everything else is null.
    expect(pluginIdOfCardRow("plugin.echoes.threshold")).toBeNull();
    expect(pluginIdOfCardRow("plugin.echoes")).toBeNull();
    expect(pluginIdOfCardRow("theme")).toBeNull();
    expect(pluginIdOfCardRow("pluginCard.")).toBeNull();
    expect(pluginIdOfCardRow("pluginCard.Echoes")).toBeNull();

    // A card id is neither a runtime Plugin row id nor a core row id.
    expect(isPluginSettingsRowId(pluginCardRowId("echoes"))).toBe(false);
    expect(pluginIdOfSettingsRow(pluginCardRowId("echoes"))).toBeNull();
    const coreIds = SETTINGS_SECTIONS.flatMap((section) => section.rows.map((row) => row.id));
    expect(coreIds).not.toContain(pluginCardRowId("echoes"));
    for (const id of coreIds) expect(pluginIdOfCardRow(id)).toBeNull();
  });
});

describe("pluginCardEntries()", () => {
  afterEach(() => usePluginManagementStore.setState({ plugins: {} }));

  it("names the cards the Plugins section renders: known Plugins by name, then legacy owners", () => {
    usePluginManagementStore.setState({
      plugins: {
        zeta: pluginEntry({ pluginId: "zeta", name: "Zeta", description: "Last" }),
        alpha: pluginEntry({ pluginId: "alpha", name: "Alpha", description: "First" }),
        local: pluginEntry({
          pluginId: "local",
          name: "Local",
          locales: { es: { name: "Localizado", description: "Descripción" } },
        }),
      },
    });
    register("echoes", "Echoes", [{ id: "threshold", label: "Echo threshold" }]);

    const cards = pluginCardEntries("en");
    expect(cards.map((card) => card.id)).toEqual([
      pluginCardRowId("alpha"),
      pluginCardRowId("local"),
      pluginCardRowId("zeta"),
      pluginCardRowId("echoes"),
    ]);
    expect(cards.map((card) => card.label)).toEqual(["Alpha", "Local", "Zeta", "Echoes"]);
    // A legacy Settings owner declares no description.
    expect(cards.at(-1)?.description).toBe("");

    // A Plugin's own locale names its card in that language.
    const spanish = pluginCardEntries("es").find(
      (card) => card.id === pluginCardRowId("local")
    );
    expect(spanish?.label).toBe("Localizado");
    expect(spanish?.description).toBe("Descripción");
  });
});
