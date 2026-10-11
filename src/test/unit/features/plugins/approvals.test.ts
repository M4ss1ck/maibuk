import { afterEach, describe, expect, it } from "vitest";
import {
  PLUGIN_APPROVALS_STORAGE_KEY,
  getPluginApproval,
  listPluginApprovals,
  removePluginApproval,
  savePluginApproval,
  serializePluginApprovals,
} from "@/features/plugins/approvals";

const APPROVAL = {
  pluginId: "tracer",
  pinnedHash: "h1:abc",
  granted: ["library:read" as const],
};

afterEach(() => {
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
});

describe("Plugin approvals", () => {
  it("round-trips an approval through device-local storage", () => {
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

  it("serializes the same record shape the E2E seed writes", () => {
    const serialized = serializePluginApprovals([APPROVAL]);
    expect(JSON.parse(serialized)).toEqual({ version: 1, approvals: [APPROVAL] });
  });
});
