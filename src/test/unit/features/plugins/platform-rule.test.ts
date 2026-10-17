// The Plugin Platforms rule (#517). Android runs a Plugin only when its manifest
// lists "android" in `platforms`; an omitted `platforms` means desktop and web;
// a declared list without "android" excludes Android. Pure, so it needs no mocks.

import { describe, expect, it } from "vitest";
import {
  PLUGIN_HOST_UNSUPPORTED_PLATFORMS,
  manifestRunsOn,
  pluginsRunOn,
} from "@/features/plugins/host-platform";

describe("manifestRunsOn()", () => {
  it("runs a manifest that omits platforms on desktop and web, never on Android", () => {
    expect(manifestRunsOn(undefined, "desktop")).toBe(true);
    expect(manifestRunsOn(undefined, "web")).toBe(true);
    expect(manifestRunsOn(undefined, "android")).toBe(false);
  });

  it("runs a manifest that lists android on Android", () => {
    expect(manifestRunsOn(["android"], "android")).toBe(true);
    expect(manifestRunsOn(["web", "desktop", "android"], "android")).toBe(true);
  });

  it("excludes Android from a declared list that does not name it", () => {
    expect(manifestRunsOn(["web", "desktop"], "android")).toBe(false);
    expect(manifestRunsOn(["web", "desktop"], "desktop")).toBe(true);
    expect(manifestRunsOn(["web", "desktop"], "web")).toBe(true);
  });

  it("runs only on the declared platforms", () => {
    expect(manifestRunsOn(["desktop"], "web")).toBe(false);
    expect(manifestRunsOn(["android"], "desktop")).toBe(false);
  });
});

describe("the host rule after the Android ban is lifted (#517)", () => {
  it("runs Plugins on every host platform, Android included", () => {
    expect(PLUGIN_HOST_UNSUPPORTED_PLATFORMS).toEqual([]);
    expect(pluginsRunOn("android")).toBe(true);
    expect(pluginsRunOn("desktop")).toBe(true);
    expect(pluginsRunOn("web")).toBe(true);
  });
});
