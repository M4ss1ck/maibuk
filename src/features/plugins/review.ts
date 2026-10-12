/**
 * The pure review of an installed copy (#442). It compares the copy the author
 * approved against what the Plugin Directory holds now — the pinned `h1:` hash,
 * the per-file digests, the manifest's Plugin Permissions, and its version —
 * and reports whether the copy is approved, needs review, or was never
 * approved. The state alone decides; a caller gates the lifecycle on
 * `review-required` (slice 3) and shows the diff.
 */

import { diffPluginPermissions } from "@/features/plugins/manifest-compat";
import { compareSemver, parseSemver } from "@/features/plugins/semver";
import type {
  PluginApproval,
  PluginFileDiff,
  PluginManifest,
  PluginReview,
} from "@/features/plugins/types";

/** What a review reads: the record, the folder's current digests and pin, and the manifest. */
export interface PluginReviewInput {
  /** The stored approval, or null when the Plugin was never approved. */
  approval: PluginApproval | null;
  /** The folder's current per-file digests (`pluginFileDigests` output). */
  digests: ReadonlyMap<string, string>;
  /** The folder's current `h1:` hash. */
  hash: string;
  /** The manifest parsed from the folder now. */
  manifest: PluginManifest;
}

function diffFiles(
  approvedFiles: Record<string, string>,
  digests: ReadonlyMap<string, string>
): PluginFileDiff {
  const added: string[] = [];
  const changed: string[] = [];
  for (const [path, digest] of digests) {
    const previous = approvedFiles[path];
    if (previous === undefined) added.push(path);
    else if (previous !== digest) changed.push(path);
  }
  const removed = Object.keys(approvedFiles).filter((path) => !digests.has(path));
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

/** True when the installed version is behind the one the author approved. */
function isOlder(approvedVersion: string, currentVersion: string): boolean {
  const approved = parseSemver(approvedVersion);
  const current = parseSemver(currentVersion);
  if (approved === null || current === null) return false;
  return compareSemver(current, approved) < 0;
}

export function reviewPluginCopy(input: PluginReviewInput): PluginReview {
  const { approval, digests, hash, manifest } = input;
  if (approval === null) {
    return {
      status: "not-approved",
      files: diffFiles({}, digests),
      permissions: diffPluginPermissions(null, manifest.permissions),
      olderVersion: false,
    };
  }
  return {
    status: approval.pinnedHash === hash ? "approved" : "review-required",
    files: diffFiles(approval.approvedFiles, digests),
    permissions: diffPluginPermissions(approval.approvedPermissions, manifest.permissions),
    olderVersion: isOlder(approval.approvedVersion, manifest.version),
  };
}
