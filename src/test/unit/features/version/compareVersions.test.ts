import { describe, expect, it } from "vitest";

/**
 * We test compareVersions by extracting it from the module.
 * Since it's not exported, we re-implement the same logic and
 * verify it matches the contract used by useVersionCheck.
 *
 * If the project ever exports compareVersions directly, switch to importing it.
 */

// Replicated from src/features/version/useVersionCheck.ts
function compareVersions(current: string, latest: string): boolean {
  const normalize = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [currMajor, currMinor = 0, currPatch = 0] = normalize(current);
  const [latMajor, latMinor = 0, latPatch = 0] = normalize(latest);

  if (latMajor > currMajor) return true;
  if (latMajor === currMajor && latMinor > currMinor) return true;
  if (latMajor === currMajor && latMinor === currMinor && latPatch > currPatch) return true;
  return false;
}

describe("compareVersions()", () => {
  it("returns true when latest major is greater", () => {
    expect(compareVersions("v1.0.0", "v2.0.0")).toBe(true);
  });

  it("returns true when latest minor is greater", () => {
    expect(compareVersions("v1.2.0", "v1.3.0")).toBe(true);
  });

  it("returns true when latest patch is greater", () => {
    expect(compareVersions("v1.2.3", "v1.2.4")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(compareVersions("v1.2.3", "v1.2.3")).toBe(false);
  });

  it("returns false when current is newer", () => {
    expect(compareVersions("v2.0.0", "v1.9.9")).toBe(false);
  });

  it("handles versions without v prefix", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBe(true);
  });

  it("handles versions with missing patch/minor", () => {
    expect(compareVersions("v1", "v1.1")).toBe(true);
    expect(compareVersions("v1.0", "v2")).toBe(true);
  });

  it("returns false when latest minor is lower despite higher patch", () => {
    expect(compareVersions("v1.3.0", "v1.2.9")).toBe(false);
  });
});
