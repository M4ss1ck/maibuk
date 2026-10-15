import { afterEach, describe, expect, it } from "vitest";
import {
  PLUGIN_APPROVALS_STORAGE_KEY,
  approveBuiltInCopy,
  approvePluginCopy,
  clearStartupError,
  disablePlugin,
  enablePlugin,
  getPluginApproval,
  hasMissingRequired,
  listPluginApprovals,
  recordStartupError,
  removePluginApproval,
  revokePermission,
  savePluginApproval,
  serializePluginApprovals,
} from "@/features/plugins/approvals";
import type { PluginApproval, PluginManifest } from "@/features/plugins/types";
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";

const APPROVAL: PluginApproval = {
  pluginId: "tracer",
  pinnedHash: "h1:abc",
  granted: ["library:read"],
  enabled: true,
  approvedVersion: "1.0.0",
  approvedPermissions: { required: ["library:read"], optional: [] },
  approvedFiles: { "manifest.json": "aa" },
};

const MANIFEST: PluginManifest = {
  ...PLUGIN_MANIFEST,
  permissions: {
    required: ["library:read"],
    optional: ["editor:read", "network:api.example.com"],
  },
};

afterEach(() => {
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
});

describe("Plugin approvals", () => {
  it("round-trips a v2 approval through device-local storage", () => {
    savePluginApproval(APPROVAL);
    expect(listPluginApprovals()).toEqual([APPROVAL]);
    expect(getPluginApproval("tracer")).toEqual(APPROVAL);
    expect(getPluginApproval("other")).toBeNull();
  });

  it("replaces an approval for the same Plugin instead of duplicating it", () => {
    savePluginApproval(APPROVAL);
    savePluginApproval({ ...APPROVAL, pinnedHash: "h1:def" });
    expect(listPluginApprovals()).toEqual([{ ...APPROVAL, pinnedHash: "h1:def" }]);
  });

  it("removes an approval", () => {
    savePluginApproval(APPROVAL);
    removePluginApproval("tracer");
    expect(listPluginApprovals()).toEqual([]);
  });

  it("reports nothing for corrupt storage instead of failing the launch", () => {
    localStorage.setItem(PLUGIN_APPROVALS_STORAGE_KEY, "{not json");
    expect(listPluginApprovals()).toEqual([]);
    localStorage.setItem(PLUGIN_APPROVALS_STORAGE_KEY, JSON.stringify({ approvals: "nope" }));
    expect(listPluginApprovals()).toEqual([]);
  });

  it("writes the v2 payload", () => {
    const serialized = serializePluginApprovals([APPROVAL]);
    expect(JSON.parse(serialized)).toEqual({ version: 2, approvals: [APPROVAL] });
  });

  it("writes v2 even when asked for a record through the writer", () => {
    savePluginApproval(APPROVAL);
    const raw = localStorage.getItem(PLUGIN_APPROVALS_STORAGE_KEY);
    expect(JSON.parse(raw as string).version).toBe(2);
  });

  it("migrates a v1 payload on read", () => {
    localStorage.setItem(
      PLUGIN_APPROVALS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        approvals: [{ pluginId: "tracer", pinnedHash: "h1:abc", granted: ["library:read"] }],
      })
    );
    expect(listPluginApprovals()).toEqual([
      {
        pluginId: "tracer",
        pinnedHash: "h1:abc",
        granted: ["library:read"],
        enabled: true,
        approvedVersion: "",
        approvedPermissions: { required: ["library:read"], optional: [] },
        approvedFiles: {},
      },
    ]);
  });
});

describe("approvePluginCopy()", () => {
  it("grants every required permission, the chosen optional ones, and enables the copy", () => {
    const approval = approvePluginCopy(
      MANIFEST,
      "h1:abc",
      new Map([
        ["manifest.json", "aa"],
        ["index.js", "bb"],
      ]),
      ["editor:read"]
    );
    expect(approval).toEqual({
      pluginId: "tracer",
      pinnedHash: "h1:abc",
      granted: ["library:read", "editor:read"],
      enabled: true,
      approvedVersion: MANIFEST.version,
      approvedPermissions: {
        required: ["library:read"],
        optional: ["editor:read", "network:api.example.com"],
      },
      approvedFiles: { "manifest.json": "aa", "index.js": "bb" },
    });
  });

  it("grants no optional permission when none is chosen", () => {
    const approval = approvePluginCopy(MANIFEST, "h1:abc", new Map());
    expect(approval.granted).toEqual(["library:read"]);
    expect(approval.enabled).toBe(true);
  });
});

describe("approveBuiltInCopy()", () => {
  it("pre-grants every declared permission but leaves the Built-in off on first sight", () => {
    const approval = approveBuiltInCopy(
      MANIFEST,
      "h1:abc",
      new Map([
        ["manifest.json", "aa"],
        ["index.js", "bb"],
      ]),
      "h1:shipped"
    );
    expect(approval).toEqual({
      pluginId: "tracer",
      pinnedHash: "h1:abc",
      granted: ["library:read", "editor:read", "network:api.example.com"],
      enabled: false,
      approvedVersion: MANIFEST.version,
      approvedPermissions: {
        required: ["library:read"],
        optional: ["editor:read", "network:api.example.com"],
      },
      approvedFiles: { "manifest.json": "aa", "index.js": "bb" },
      builtIn: { shippedHash: "h1:shipped" },
    });
  });

  it("turns on with no review because every required permission is pre-granted", () => {
    const approval = approveBuiltInCopy(MANIFEST, "h1:abc", new Map(), "h1:shipped");
    const result = enablePlugin(approval, MANIFEST);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.approval.enabled).toBe(true);
  });
});

describe("revokePermission()", () => {
  it("disables the Plugin when a required permission is revoked", () => {
    const revoked = revokePermission(APPROVAL, "library:read", MANIFEST);
    expect(revoked.granted).toEqual([]);
    expect(revoked.enabled).toBe(false);
  });

  it("keeps the Plugin enabled when an optional permission is revoked", () => {
    const approval: PluginApproval = { ...APPROVAL, granted: ["library:read", "editor:read"] };
    const revoked = revokePermission(approval, "editor:read", MANIFEST);
    expect(revoked.granted).toEqual(["library:read"]);
    expect(revoked.enabled).toBe(true);
  });

  it("leaves the record untouched when the permission was not granted", () => {
    const revoked = revokePermission(APPROVAL, "editor:read", MANIFEST);
    expect(revoked).toEqual(APPROVAL);
  });
});

describe("disablePlugin() and enablePlugin()", () => {
  it("disables the Plugin", () => {
    expect(disablePlugin(APPROVAL).enabled).toBe(false);
  });

  it("refuses to enable while a required permission is not granted", () => {
    const disabled = disablePlugin({ ...APPROVAL, granted: [] });
    const result = enablePlugin(disabled, MANIFEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("required-permissions-missing");
      expect(result.missing).toEqual(["library:read"]);
      expect(result.approval).toEqual(disabled);
    }
  });

  it("enables the Plugin when every required permission is granted", () => {
    const result = enablePlugin(disablePlugin(APPROVAL), MANIFEST);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.approval.enabled).toBe(true);
  });
});

describe("hasMissingRequired()", () => {
  it("is true when an approved copy no longer grants a required permission", () => {
    expect(hasMissingRequired({ approval: { ...APPROVAL, granted: [] }, manifest: MANIFEST })).toBe(
      true
    );
  });

  it("is false while every required permission is still granted", () => {
    expect(hasMissingRequired({ approval: APPROVAL, manifest: MANIFEST })).toBe(false);
  });

  it("is false for a copy that was never approved", () => {
    expect(hasMissingRequired({ approval: null, manifest: MANIFEST })).toBe(false);
  });
});

describe("startup errors", () => {
  it("records a refusal's code and clears it on the next successful start", () => {
    savePluginApproval(APPROVAL);

    recordStartupError("tracer", { code: "incompatible", compatibility: { verdict: "ok" } });

    expect(getPluginApproval("tracer")?.startupError).toBe("incompatible");

    clearStartupError("tracer");

    expect(getPluginApproval("tracer")?.startupError).toBeUndefined();
  });

  it("records a refusal's own message when it has one", () => {
    savePluginApproval(APPROVAL);

    recordStartupError("tracer", { code: "worker-error", message: "boom" });

    expect(getPluginApproval("tracer")?.startupError).toBe("boom");
  });

  it("records nothing for a review state", () => {
    savePluginApproval(APPROVAL);

    recordStartupError("tracer", { code: "review-required", status: "review-required" });

    expect(getPluginApproval("tracer")?.startupError).toBeUndefined();
  });
});
