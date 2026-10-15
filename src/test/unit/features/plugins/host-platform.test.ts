// The Frame platform gate (#454, D6): the Frame is off on Android in v1 and on
// everywhere else today. The rule is pure, so it is proven over each platform
// string without the build env.

import { describe, expect, it } from "vitest";
import { pluginFrameAvailableOn } from "@/features/plugins/host-platform";

describe("pluginFrameAvailableOn()", () => {
  it("is available on desktop, web (null), and unknown targets", () => {
    expect(pluginFrameAvailableOn("linux")).toBe(true);
    expect(pluginFrameAvailableOn("windows")).toBe(true);
    expect(pluginFrameAvailableOn(null)).toBe(true);
  });

  it("is unavailable on Android", () => {
    expect(pluginFrameAvailableOn("android")).toBe(false);
  });
});
