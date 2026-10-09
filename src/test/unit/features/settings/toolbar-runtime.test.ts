import { describe, expect, it, afterEach } from "vitest";
import {
  DEFAULT_TOOLBAR_CONFIG,
  applyToolbarButtonRenames,
  deriveFloatingGroupIds,
  isLiveToolbarEntry,
  isPluginToolbarButtonId,
  normalizeToolbarConfig,
  registerToolbarButtons,
  setGroupFloatingVisible,
  setGroupToolbarVisible,
  withRegisteredToolbarButtons,
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
  return [...config.start, ...config.end].filter((e) => e.kind === "group").map((e) => e.id);
}

describe("toolbar runtime buttons (issue #429)", () => {
  it("keeps unknown ids under plugin. and drops other unknowns", () => {
    const result = normalizeToolbarConfig({
      start: [
        { kind: "group", id: "basic-marks", toolbarVisible: true, floatingVisible: true },
        {
          kind: "group",
          id: "plugin.echoes.showReport",
          toolbarVisible: false,
          floatingVisible: true,
        },
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
    const idx = config.start.findIndex(
      (e) => e.kind === "group" && e.id === "plugin.echoes.showReport"
    );
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
        {
          kind: "group",
          id: "plugin.echoes.oldReport" as never,
          toolbarVisible: false,
          floatingVisible: true,
        },
      ],
      end: [],
    };
    const migrated = applyToolbarButtonRenames(config);
    expect(ids(migrated)).toEqual(["plugin.echoes.showReport"]);
    expect(migrated.start[0]).toMatchObject({ toolbarVisible: false, floatingVisible: true });
  });

  it("keeps the declared entry when a renamed old id and the new id both exist", () => {
    register("echoes", ["neu"], { old: "neu" });
    const hidden = {
      kind: "group",
      id: "plugin.echoes.old",
      toolbarVisible: false,
      floatingVisible: false,
    } as const;
    const visible = {
      kind: "group",
      id: "plugin.echoes.neu",
      toolbarVisible: true,
      floatingVisible: true,
    } as const;
    for (const start of [
      [hidden, visible],
      [visible, hidden],
    ] as const) {
      const migrated = applyToolbarButtonRenames({ start: [...start], end: [] });
      const groups = migrated.start.filter((e) => e.kind === "group");
      expect(groups.map((e) => e.id)).toEqual(["plugin.echoes.neu"]);
      expect(groups[0]).toMatchObject({ toolbarVisible: true, floatingVisible: true });
    }
    for (const config of [
      { start: [{ ...hidden }], end: [{ ...visible }] },
      { start: [{ ...visible }], end: [{ ...hidden }] },
    ]) {
      const migrated = applyToolbarButtonRenames(config as ToolbarConfig);
      const groups = [...migrated.start, ...migrated.end].filter((e) => e.kind === "group");
      expect(groups.map((e) => e.id)).toEqual(["plugin.echoes.neu"]);
      expect(groups[0]).toMatchObject({ toolbarVisible: true, floatingVisible: true });
    }
  });

  it("recognizes plugin button id shape", () => {
    expect(isPluginToolbarButtonId("plugin.echoes.showReport")).toBe(true);
    expect(isPluginToolbarButtonId("history")).toBe(false);
    expect(isPluginToolbarButtonId("plugin.echoes.ShowReport")).toBe(false);
  });

  it("treats core ids as live, and plugin ids as live only while registered", () => {
    expect(isLiveToolbarEntry("history")).toBe(true);
    expect(isLiveToolbarEntry("not-a-real-group")).toBe(false);
    expect(isLiveToolbarEntry("plugin.echoes.show")).toBe(false);
    const unregister = registerToolbarButtons("echoes", { buttons: [{ id: "show" }] });
    unregisters.push(unregister);
    expect(isLiveToolbarEntry("plugin.echoes.show")).toBe(true);
    expect(isLiveToolbarEntry("plugin.echoes.other")).toBe(false);
  });

  it("excludes a retained absent button from the selection toolbar", () => {
    const config: ToolbarConfig = {
      start: [
        {
          kind: "group",
          id: "plugin.echoes.gone",
          toolbarVisible: true,
          floatingVisible: true,
        },
      ],
      end: [],
    };
    expect(deriveFloatingGroupIds(config)).not.toContain("plugin.echoes.gone");
  });
});
