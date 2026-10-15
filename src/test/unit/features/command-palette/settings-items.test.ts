import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS } from "@/components/settings/settings-sections";
import { buildSettingsItems } from "@/features/command-palette/settings-items";
import { usePluginManagementStore } from "@/features/plugins/management";
import type { PluginManagementEntry } from "@/features/plugins/types";
import {
  pluginCardRowId,
  registerPluginSettingsRows,
  rowOnPlatform,
} from "@/features/settings/rows";
import type { SettingsPlatform, SettingsRowDef } from "@/features/settings/rows";
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";

const t = (key: string, options?: Record<string, unknown>) => {
  if (options?.returnObjects === true) {
    const lists: Record<string, string[]> = {
      "settings.keywords.theme": ["dark", "light", "mode"],
      "settings.keywords.resetDatabase": ["delete everything", "wipe"],
    };
    return lists[key] ?? [];
  }
  const labels: Record<string, string> = {
    "settings.theme": "Theme",
    "settings.themeDescription": "Choose your preferred theme",
    "settings.appearance": "Appearance",
    "settings.exportDatabase": "Export Database",
    "settings.exportDatabaseDescription": "Save a copy of your Library",
    "settings.advanced": "Advanced",
  };
  return labels[key] ?? key;
};

/** Every declared row, widened so the optional fields are readable. */
function allRows(): SettingsRowDef[] {
  return SETTINGS_SECTIONS.flatMap((section) => [...section.rows]);
}

describe("buildSettingsItems()", () => {
  it("builds one runnable item per declared row, keyed by row id", () => {
    const items = buildSettingsItems({ t, platform: "desktop" });
    const declared = allRows().filter((row) => rowOnPlatform(row, "desktop"));

    expect(items).toHaveLength(declared.length);
    expect(items.map((item) => item.key)).toEqual(declared.map((row) => `settingsRow:${row.id}`));
    expect(items.every((item) => item.kind === "settingsRow")).toBe(true);
    expect(items.every((item) => item.state === "runnable")).toBe(true);
    // Every declared row id is unique across sections, so no key collides.
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });

  it("uses the row label and its section as the detail", () => {
    const items = buildSettingsItems({ t, platform: "desktop" });
    const theme = items.find((item) => item.key === "settingsRow:theme");

    expect(theme?.label).toBe("Theme");
    expect(theme?.detail).toBe("Appearance");
  });

  it("searches the description and the keyword list, so 'dark' finds the theme row", () => {
    const items = buildSettingsItems({ t, platform: "desktop" });
    const theme = items.find((item) => item.key === "settingsRow:theme");

    expect(theme?.terms).toEqual(["Choose your preferred theme", "dark", "light", "mode"]);
  });

  it("leaves terms empty for a row with neither description nor keywords", () => {
    const items = buildSettingsItems({ t, platform: "desktop" });
    const row = items.find((item) => !item.terms.length);

    expect(row).toBeDefined();
    expect(row?.label).not.toBe("");
  });

  it("hides rows the platform does not have", () => {
    const withExcluded = allRows().filter(
      (row) => row.platforms !== undefined && !row.platforms.includes("web")
    );
    expect(withExcluded.length).toBeGreaterThan(0);

    const web = buildSettingsItems({ t, platform: "web" }).map((item) => item.key);
    const desktop = buildSettingsItems({ t, platform: "desktop" }).map((item) => item.key);

    for (const row of withExcluded) {
      expect(web).not.toContain(`settingsRow:${row.id}`);
      expect(desktop).toContain(`settingsRow:${row.id}`);
    }
    expect(web.length).toBeLessThan(desktop.length);
  });

  it("keeps the declared row ids matching the sections that render them", () => {
    const items = buildSettingsItems({ t, platform: "desktop" });
    const declared: string[] = allRows().map((row) => row.id);
    const built: string[] = items.map((item) => item.id);

    // Only rows off the platform are absent, and none are invented.
    expect(built.filter((id) => !declared.includes(id))).toEqual([]);
  });

  it.each([
    "web",
    "desktop",
    "android",
  ] as const)("keeps every row that %s actually has", (platform: SettingsPlatform) => {
    const items = buildSettingsItems({ t, platform });
    for (const row of allRows()) {
      const present = items.some((item) => item.id === row.id);
      expect(present, `${row.id} on ${platform}`).toBe(rowOnPlatform(row, platform));
    }
  });

  it("adds one item per Plugin card and keeps the runtime Plugin Settings row items", () => {
    const unregister = registerPluginSettingsRows("echoes", {
      displayName: "Echoes",
      rows: [{ id: "threshold", label: "Echo threshold", description: "How alike" }],
    });
    usePluginManagementStore.setState({
      plugins: {
        echoes: {
          pluginId: "echoes",
          manifest: {
            ...PLUGIN_MANIFEST,
            id: "echoes",
            name: "Echoes",
            description: "Find repeated passages.",
          },
          locales: {},
        } as unknown as PluginManagementEntry,
      },
    });
    try {
      const items = buildSettingsItems({ t, platform: "web" });

      // One item per card, keyed and labelled like the card's outline entry.
      const card = items.find((item) => item.key === `settingsRow:${pluginCardRowId("echoes")}`);
      expect(card).toBeDefined();
      expect(card?.id).toBe(pluginCardRowId("echoes"));
      expect(card?.kind).toBe("settingsRow");
      expect(card?.label).toBe("Echoes");
      expect(card?.terms).toEqual(["Find repeated passages."]);
      expect(card?.detail).toBe("settings.plugins");

      // The runtime Plugin Settings row stays findable in the palette.
      const runtime = items.find((item) => item.key === "settingsRow:plugin.echoes.threshold");
      expect(runtime).toBeDefined();
      expect(runtime?.label).toBe("Echo threshold");
      expect(runtime?.terms).toEqual(["How alike"]);
    } finally {
      usePluginManagementStore.setState({ plugins: {} });
      unregister();
    }
  });
});
