import { afterEach, describe, expect, it, vi } from "vitest";
import { isMac } from "../../../../lib/platform/detect";

function stubNavigator(platform: string, userAgentDataPlatform?: string) {
  vi.stubGlobal("navigator", {
    platform,
    userAgentData: userAgentDataPlatform ? { platform: userAgentDataPlatform } : undefined,
  });
}

describe("isMac()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true for macOS platforms", () => {
    stubNavigator("MacIntel");

    expect(isMac()).toBe(true);
  });

  it("uses userAgentData platform when available", () => {
    stubNavigator("Linux x86_64", "iPad");

    expect(isMac()).toBe(true);
  });

  it("returns false for non-Apple platforms", () => {
    stubNavigator("Win32");

    expect(isMac()).toBe(false);
  });

  it("returns false when navigator is unavailable", () => {
    vi.stubGlobal("navigator", undefined);

    expect(isMac()).toBe(false);
  });
});
