import { describe, expect, it } from "vitest";
import { pluginFileDigests, hashPluginDirectory } from "@/features/plugins/directory-hash";
import { reviewPluginCopy } from "@/features/plugins/review";
import type { PluginApproval, PluginManifest } from "@/features/plugins/types";
import { PLUGIN_MANIFEST, pluginFolder } from "@/test/support/plugin-fixtures";

const MANIFEST: PluginManifest = {
  ...PLUGIN_MANIFEST,
  permissions: { required: ["library:read"], optional: [] },
};

function approval(overrides: Partial<PluginApproval> = {}): PluginApproval {
  return {
    pluginId: "tracer",
    pinnedHash: "h1:pin",
    granted: ["library:read"],
    enabled: true,
    approvedVersion: MANIFEST.version,
    approvedPermissions: { required: ["library:read"], optional: [] },
    approvedFiles: {},
    ...overrides,
  };
}

describe("reviewPluginCopy()", () => {
  it("is not-approved when there is no approval record", () => {
    const review = reviewPluginCopy({
      approval: null,
      digests: new Map([["index.js", "aa"]]),
      hash: "h1:anything",
      manifest: MANIFEST,
    });
    expect(review.status).toBe("not-approved");
    expect(review.olderVersion).toBe(false);
  });

  it("is approved when the current hash still matches the pin", () => {
    const review = reviewPluginCopy({
      approval: approval(),
      digests: new Map(),
      hash: "h1:pin",
      manifest: MANIFEST,
    });
    expect(review.status).toBe("approved");
  });

  it("needs review when the current hash no longer matches the pin", () => {
    const review = reviewPluginCopy({
      approval: approval(),
      digests: new Map(),
      hash: "h1:changed",
      manifest: MANIFEST,
    });
    expect(review.status).toBe("review-required");
  });

  it("diffs the files added, removed, and changed since approval", () => {
    const review = reviewPluginCopy({
      approval: approval({ approvedFiles: { "a.js": "aa", "b.js": "bb", "d.js": "dd" } }),
      digests: new Map([
        ["a.js", "aa"],
        ["b.js", "cc"],
        ["c.js", "ee"],
      ]),
      hash: "h1:changed",
      manifest: MANIFEST,
    });
    expect(review.files).toEqual({ added: ["c.js"], removed: ["d.js"], changed: ["b.js"] });
  });

  it("reports the permission diff, including Now required", () => {
    const review = reviewPluginCopy({
      approval: approval({ approvedPermissions: { required: [], optional: ["editor:read"] } }),
      digests: new Map(),
      hash: "h1:changed",
      manifest: {
        ...MANIFEST,
        permissions: { required: ["editor:read"], optional: [] },
      },
    });
    expect(review.permissions.nowRequired).toEqual([{ permission: "editor:read", required: true }]);
  });

  it("flags the copy as an older version when it is behind the approved one", () => {
    const review = reviewPluginCopy({
      approval: approval({ approvedVersion: "2.0.0" }),
      digests: new Map(),
      hash: "h1:pin",
      manifest: { ...MANIFEST, version: "1.0.0" },
    });
    expect(review.olderVersion).toBe(true);
  });

  it("does not flag a newer or equal version as older", () => {
    const review = reviewPluginCopy({
      approval: approval({ approvedVersion: "1.0.0" }),
      digests: new Map(),
      hash: "h1:pin",
      manifest: { ...MANIFEST, version: "2.0.0" },
    });
    expect(review.olderVersion).toBe(false);
  });

  it("reads the real digests and pin of a folder without changes", async () => {
    const folder = pluginFolder({}, { id: "tracer", permissions: MANIFEST.permissions });
    const digests = await pluginFileDigests(folder.files);
    const hash = await hashPluginDirectory(folder.files);
    const review = reviewPluginCopy({
      approval: approval({
        pinnedHash: hash,
        approvedFiles: Object.fromEntries(digests),
      }),
      digests,
      hash,
      manifest: MANIFEST,
    });
    expect(review.status).toBe("approved");
    expect(review.files).toEqual({ added: [], removed: [], changed: [] });
  });
});
