import { describe, expect, it } from "vitest";
import { ALL_GROUP_IDS, FLOATING_ELIGIBLE_IDS } from "@/features/settings/toolbar-config";
import {
  TOOLBAR_GROUP_META,
  TOOLBAR_GROUP_META_LIST,
} from "@/components/editor/toolbar/toolbar-groups";

describe("TOOLBAR_GROUP_META", () => {
  it("has an entry for every group id and nothing extra", () => {
    expect(Object.keys(TOOLBAR_GROUP_META).sort()).toEqual([...ALL_GROUP_IDS].sort());
  });
  it("marks floating eligibility consistently with the config module", () => {
    for (const id of ALL_GROUP_IDS) {
      expect(TOOLBAR_GROUP_META[id].floatingEligible).toBe(FLOATING_ELIGIBLE_IDS.has(id));
    }
  });
  it("lists groups in ALL_GROUP_IDS order with non-empty label keys and icons", () => {
    expect(TOOLBAR_GROUP_META_LIST.map((meta) => meta.id)).toEqual([...ALL_GROUP_IDS]);
    for (const meta of TOOLBAR_GROUP_META_LIST) {
      expect(meta.labelKey).toMatch(/^toolbar\.groups\./);
      expect(meta.Icon).toBeTruthy();
      expect(["function", "object"]).toContain(typeof meta.Icon);
    }
  });
});
