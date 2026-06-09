import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SCENE_BREAK } from "../../../../components/editor/extensions/scene-break-utils";
import {
  normalizeSceneBreak,
  useSettingsStore,
} from "../../../../features/settings/store";

describe("scene break settings", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      lastSceneBreak: DEFAULT_SCENE_BREAK,
      sceneBreakPresets: [],
    });
  });

  it("defaults last-used to '* * *'", () => {
    expect(useSettingsStore.getState().lastSceneBreak).toEqual(
      DEFAULT_SCENE_BREAK,
    );
  });

  it("sets last-used", () => {
    useSettingsStore
      .getState()
      .setLastSceneBreak({ kind: "text", symbols: "❧" });

    expect(useSettingsStore.getState().lastSceneBreak).toEqual({
      kind: "text",
      symbols: "❧",
    });
  });

  it("adds and removes presets without duplicating", () => {
    const preset = { kind: "text", symbols: "❧" } as const;

    useSettingsStore.getState().addSceneBreakPreset(preset);
    useSettingsStore.getState().addSceneBreakPreset(preset);

    expect(useSettingsStore.getState().sceneBreakPresets).toHaveLength(1);
    useSettingsStore.getState().removeSceneBreakPreset(0);
    expect(useSettingsStore.getState().sceneBreakPresets).toHaveLength(0);
  });

  it("normalizeSceneBreak self-heals malformed input", () => {
    expect(normalizeSceneBreak(undefined)).toEqual(DEFAULT_SCENE_BREAK);
    expect(normalizeSceneBreak({ kind: "text" })).toEqual(DEFAULT_SCENE_BREAK);
    expect(normalizeSceneBreak({ kind: "image", src: "data:x" })).toEqual({
      kind: "image",
      src: "data:x",
    });
  });
});
