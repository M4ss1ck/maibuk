import { describe, expect, it } from "vitest";
import { checkPluginCompatibility, diffPluginPermissions } from "@/features/plugins/manifest-compat";
import { validateManifestValue } from "@/features/plugins/manifest-validate";
import type { PluginHostVersions, PluginManifest } from "@/features/plugins/types";

type Mutable = Record<string, any>;

function manifest(overrides: Mutable = {}): PluginManifest {
  const result = validateManifestValue({
    manifestVersion: 1,
    id: "echoes",
    name: "Echoes",
    description: "Highlights overused words.",
    author: "Andy",
    version: "1.0.0",
    apiVersion: "^0.3",
    entry: "dist/index.js",
    platforms: ["desktop", "web", "android"],
    lifecycle: "on-demand",
    defaultLanguage: "en",
    permissions: {
      required: ["library:read"],
      optional: ["editor:decorate", "network:api.example.com"],
    },
    ...overrides,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.manifest;
}

const HOST: PluginHostVersions = { apiVersion: "0.3.2", appVersion: "0.11.0" };

function failed(compatibility: ReturnType<typeof checkPluginCompatibility>) {
  if (compatibility.verdict === "ok") throw new Error("expected a non-ok verdict");
  return compatibility;
}

describe("checkPluginCompatibility", () => {
  it("is ok when the API range and minAppVersion are met", () => {
    expect(checkPluginCompatibility(manifest(), HOST).verdict).toBe("ok");
    expect(
      checkPluginCompatibility(manifest({ apiVersion: "*", minAppVersion: "0.11.0" }), HOST).verdict
    ).toBe("ok");
  });

  it("is ok when minAppVersion is absent", () => {
    expect(checkPluginCompatibility(manifest({ minAppVersion: undefined }), HOST).verdict).toBe(
      "ok"
    );
  });

  it("pre-1.0: ^0.3 pins 0.3.x", () => {
    expect(checkPluginCompatibility(manifest({ apiVersion: "^0.3" }), HOST).verdict).toBe("ok");
    const older = failed(
      checkPluginCompatibility(manifest({ apiVersion: "^0.3" }), {
        apiVersion: "0.4.0",
        appVersion: "0.11.0",
      })
    );
    expect(older.verdict).toBe("older-api");
    expect(older.reason).toBe("api-version");
    expect(older.message).toMatch(/0\.3/);
  });

  it("needs a newer app when the API range is above the host's API", () => {
    const verdict = failed(checkPluginCompatibility(manifest({ apiVersion: "^0.4" }), HOST));
    expect(verdict.verdict).toBe("needs-newer-app");
    expect(verdict.reason).toBe("api-version");
    expect(verdict.message).toMatch(/0\.4/);
  });

  it("needs a newer app when minAppVersion is unmet", () => {
    const verdict = failed(checkPluginCompatibility(manifest({ minAppVersion: "0.12.0" }), HOST));
    expect(verdict.verdict).toBe("needs-newer-app");
    expect(verdict.reason).toBe("min-app-version");
    expect(verdict.message).toMatch(/0\.12\.0/);
    expect(verdict.message).toMatch(/0\.11\.0/);
  });

  it("reports the API problem when both gates are unmet", () => {
    const verdict = failed(
      checkPluginCompatibility(manifest({ apiVersion: "^0.1", minAppVersion: "0.12.0" }), HOST)
    );
    expect(verdict.verdict).toBe("older-api");
    expect(verdict.reason).toBe("api-version");
  });

  it("refuses a host whose API version is not a version", () => {
    expect(() =>
      checkPluginCompatibility(manifest(), { apiVersion: "latest", appVersion: "0.11.0" })
    ).toThrow(/apiVersion/);
  });
});

describe("diffPluginPermissions", () => {
  const next = {
    required: ["library:read", "editor:write"],
    optional: ["network:api.example.com", "secrets"],
  };

  it("reports every permission of a fresh install as added, with its requirement", () => {
    const diff = diffPluginPermissions(null, next);
    expect(diff.added).toEqual([
      { permission: "editor:write", required: true },
      { permission: "library:read", required: true },
      { permission: "network:api.example.com", required: false },
      { permission: "secrets", required: false },
    ]);
    expect(diff.removed).toEqual([]);
    expect(diff.nowRequired).toEqual([]);
    expect(diff.nowOptional).toEqual([]);
  });

  it("flags an optional permission that became required as nowRequired", () => {
    const diff = diffPluginPermissions(
      { required: ["library:read"], optional: ["editor:write", "secrets"] },
      next
    );
    expect(diff.nowRequired).toEqual([{ permission: "editor:write", required: true }]);
    expect(diff.added).toEqual([{ permission: "network:api.example.com", required: false }]);
    expect(diff.removed).toEqual([]);
    expect(diff.nowOptional).toEqual([]);
  });

  it("flags a required permission that became optional as nowOptional", () => {
    const diff = diffPluginPermissions(
      { required: ["library:read", "secrets"], optional: [] },
      next
    );
    expect(diff.nowOptional).toEqual([{ permission: "secrets", required: false }]);
    expect(diff.added).toEqual([
      { permission: "editor:write", required: true },
      { permission: "network:api.example.com", required: false },
    ]);
    expect(diff.nowRequired).toEqual([]);
  });

  it("reports added and removed permissions", () => {
    const diff = diffPluginPermissions(
      { required: ["library:write"], optional: ["clipboard"] },
      next
    );
    expect(diff.removed).toEqual([
      { permission: "clipboard", required: false },
      { permission: "library:write", required: true },
    ]);
    expect(diff.added).toEqual([
      { permission: "editor:write", required: true },
      { permission: "library:read", required: true },
      { permission: "network:api.example.com", required: false },
      { permission: "secrets", required: false },
    ]);
  });

  it("returns empty groups when nothing changed", () => {
    const diff = diffPluginPermissions(next, next);
    expect(diff).toEqual({ added: [], removed: [], nowRequired: [], nowOptional: [] });
  });
});
