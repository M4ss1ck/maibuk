import { describe, expect, it, afterEach } from "vitest";
import {
  DEFAULT_TOOLBAR_CONFIG,
  normalizeToolbarConfig,
  deriveFloatingGroupIds,
  setGroupFloatingVisible,
  setGroupToolbarVisible,
  registerToolbarButtons,
  isPluginToolbarButtonId,
  withRegisteredToolbarButtons,
  applyToolbarButtonRenames,
  type ToolbarConfig,
} from "@/features/settings/toolbar-config";

const unregisters: Array<() => void> = [];
afterEach(() => {
  while (unregisters.length > 0) unregisters.pop()?.();
});

function register(pluginId: string, buttons: string[], renames?: Record<string, string>) {
  const unregister = registerToolbarButtons(pluginId, {
    buttons: buttons.map((id) => ({ id })),
    ...(renames ? { buttonRenames: renames } : {}),
  });
  unregisters.push(unregister);
  return unregister;
}

function ids(config: ToolbarConfig): string[] {
  return [...config.start, ...config.end]
    .filter((e) => e.kind === "group")
    .map((e) => e.id);
}

describe("toolbar runtime buttons (issue #429)", () => {
  it("keeps unknown ids under plugin. and drops other unknowns", () => {
    const result = normalizeToolbarConfig({
      start: [
        { kind: "group", id: "basic-marks", toolbarVisible: true, floatingVisible: true },
        { kind: "group", id: "plugin.echoes.showReport", toolbarVisible: false, floatingVisible: true },
        { kind: "group", id: "not-a-real-group", toolbarVisible: true, floatingVisible: true },
        { kind: "group", id: "plugin.bad id!", toolbarVisible: true, floatingVisible: true },
      ],
      end: [],
    });
    const all = ids(result);
    expect(all).toContain("plugin.echoes.showReport");
    expect(all).not.toContain("not-a-real-group");
    expect(all).not.toContain("plugin.bad id!");
  });

  it("appends new runtime buttons to the author's order", () => {
    const base = normalizeToolbarConfig({ start: [], end: [] });
    const beforeIds = ids(base);
    register("echoes", ["showReport"]);
    const withNew = withRegisteredToolbarButtons(base);
    const afterIds = ids(withNew);
    expect(afterIds.slice(0, beforeIds.length)).toEqual(beforeIds);
    expect(afterIds[afterIds.length - 1]).toBe("plugin.echoes.showReport");
  });

  it("preserves arrangement including selection membership across disappear and return", () => {
    register("echoes", ["showReport"]);
    let config = withRegisteredToolbarButtons(DEFAULT_TOOLBAR_CONFIG);
    // Author moves it to End and puts it in the selection toolbar.
    const idx = config.start.findIndex((e) => e.kind === "group" && e.id === "plugin.echoes.showReport");
    expect(idx).toBeGreaterThanOrEqual(0);
    const moved = config.start[idx];
    config = {
      start: config.start.filter((_, i) => i !== idx),
      end: [...config.end, moved],
    };
    config = setGroupFloatingVisible(config, "plugin.echoes.showReport" as never, true);
    config = setGroupToolbarVisible(config, "plugin.echoes.showReport" as never, false);
    const snapshot = JSON.stringify(config);

    // Plugin disappears: normalize keeps the id (retained preference).
    const kept = normalizeToolbarConfig(JSON.parse(snapshot));
    expect(ids(kept)).toContain("plugin.echoes.showReport");

    // Plugin returns: arrangement survives, no duplicate append.
    const back = withRegisteredToolbarButtons(kept);
    expect(JSON.stringify(back)).toBe(snapshot);
    expect(ids(back).filter((id) => id === "plugin.echoes.showReport")).toHaveLength(1);
    expect(deriveFloatingGroupIds(back)).toContain("plugin.echoes.showReport");
  });

  it("migrates stored ids within one owner via buttonRenames", () => {
    register("echoes", ["showReport"], { oldReport: "showReport" });
    const config: ToolbarConfig = {
      start: [
        { kind: "group", id: "plugin.echoes.oldReport" as never, toolbarVisible: false, floatingVisible: true },
      ],
      end: [],
    };
    const migrated = applyToolbarButtonRenames(config);
    expect(ids(migrated)).toEqual(["plugin.echoes.showReport"]);
    expect(migrated.start[0]).toMatchObject({ toolbarVisible: false, floatingVisible: true });
  });

  it("recognizes plugin button id shape", () => {
    expect(isPluginToolbarButtonId("plugin.echoes.showReport")).toBe(true);
    expect(isPluginToolbarButtonId("history")).toBe(false);
    expect(isPluginToolbarButtonId("plugin.echoes.ShowReport")).toBe(false);
  });
});
