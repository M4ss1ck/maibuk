import { describe, expect, it } from "vitest";

import { tauriAndroidTarget } from "@/test/support/plugin-conformance";

describe("tauriAndroidTarget", () => {
  it.each([
    ["x86_64", "x86_64"],
    ["arm64-v8a", "aarch64"],
    ["armeabi-v7a", "armv7"],
    ["x86", "i686"],
  ])("maps the device ABI %s to the Tauri target %s", (abi, target) => {
    expect(tauriAndroidTarget(abi)).toBe(target);
  });

  it("trims the adb shell line ending", () => {
    expect(tauriAndroidTarget("x86_64\r\n")).toBe("x86_64");
  });

  it("returns null for an ABI Tauri does not build, so the lane builds every target", () => {
    expect(tauriAndroidTarget("mips")).toBeNull();
  });
});
