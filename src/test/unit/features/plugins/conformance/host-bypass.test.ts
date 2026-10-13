import { describe, expect, it } from "vitest";

import {
  PLUGIN_HOST_UNSUPPORTED_PLATFORMS,
  pluginsRunOn,
} from "@/features/plugins/host-platform";
import { conformanceDirectoryKind } from "@/features/plugins/conformance/host-bypass";

describe("conformanceDirectoryKind()", () => {
  it("hands the Android seam a directory kind the host rule runs Plugins on", () => {
    // Without this the real lifecycle's scan refuses the Android directory and
    // no check can run, so the lane stops measuring the platform #492 targets.
    expect(pluginsRunOn(conformanceDirectoryKind("android"))).toBe(true);
  });

  it("leaves the product rule untouched: the host still refuses Android", () => {
    expect(pluginsRunOn("android")).toBe(false);
    expect(PLUGIN_HOST_UNSUPPORTED_PLATFORMS).toContain("android");
  });

  it("passes the desktop and web kinds through unchanged", () => {
    expect(conformanceDirectoryKind("desktop")).toBe("desktop");
    expect(conformanceDirectoryKind("web")).toBe("web");
  });
});
