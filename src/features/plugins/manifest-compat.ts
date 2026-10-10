/**
 * The compatibility verdict and the permission review diff (ADR 0022, #399).
 *
 * The Plugin API has its own semver, independent of Maibuk's Release number.
 * Before API 1.0 a minor is breaking, so `^0.3` pins 0.3.x. A Plugin the host
 * cannot run stays listed and off with a plain explanation; its data is kept.
 * The permission diff compares the old and new required/optional sets per
 * string, so a permission moving optional → required is flagged even though
 * its name is unchanged.
 */
import type { PluginManifest, PluginPermissions } from "@/features/plugins/manifest-schema";
import { compareSemver, parseSemver, rangeRelation, type Semver } from "@/features/plugins/semver";

/** What the host provides: its Plugin API version and its Release number. */
export interface PluginHostVersions {
  /** The Plugin API version this app implements, e.g. `0.3.0`. */
  apiVersion: string;
  /** The app's Release, e.g. `0.11.0`. */
  appVersion: string;
}

export type PluginCompatibilityReason = "api-version" | "min-app-version";

/**
 * `ok`: the Plugin can run. `needs-newer-app`: the Plugin wants a newer API or
 * app than this one. `older-api`: the app has moved past the API the Plugin
 * was built for. `message` is plain-language diagnostic text for tooling
 * (`plugin:check`, logs); in-app copy is localized from the verdict and reason.
 */
export type PluginCompatibility =
  | { verdict: "ok" }
  | { verdict: "needs-newer-app"; reason: PluginCompatibilityReason; message: string }
  | { verdict: "older-api"; reason: "api-version"; message: string };

function hostVersion(value: string, label: string): Semver {
  const parsed = parseSemver(value);
  if (parsed === null) throw new Error(`host ${label} "${value}" is not a semver version`);
  return parsed;
}

export function checkPluginCompatibility(
  manifest: PluginManifest,
  host: PluginHostVersions
): PluginCompatibility {
  const hostApi = hostVersion(host.apiVersion, "apiVersion");
  const hostApp = hostVersion(host.appVersion, "appVersion");
  const relation = rangeRelation(manifest.apiVersion, hostApi);
  if (relation === "wants-newer") {
    return {
      verdict: "needs-newer-app",
      reason: "api-version",
      message: `Needs Plugin API ${manifest.apiVersion}; this app provides ${host.apiVersion}`,
    };
  }
  if (relation === "wants-older") {
    return {
      verdict: "older-api",
      reason: "api-version",
      message: `Built for Plugin API ${manifest.apiVersion}; this app provides ${host.apiVersion}`,
    };
  }
  if (manifest.minAppVersion !== undefined) {
    const minimum = parseSemver(manifest.minAppVersion);
    if (minimum !== null && compareSemver(hostApp, minimum) < 0) {
      return {
        verdict: "needs-newer-app",
        reason: "min-app-version",
        message: `Needs Maibuk ${manifest.minAppVersion} or newer; this app is ${host.appVersion}`,
      };
    }
  }
  return { verdict: "ok" };
}

/** One permission in a diff, with the requirement it holds in its own version. */
export interface PluginPermissionChange {
  permission: string;
  /** Required in the manifest the entry describes (new for added, old for removed). */
  required: boolean;
}

export interface PluginPermissionDiff {
  added: PluginPermissionChange[];
  removed: PluginPermissionChange[];
  nowRequired: PluginPermissionChange[];
  nowOptional: PluginPermissionChange[];
}

/**
 * The review diff between two manifests' Plugin Permissions. A fresh install
 * passes `previous: null`, which lists every permission as added.
 */
export function diffPluginPermissions(
  previous: PluginPermissions | null,
  next: PluginPermissions
): PluginPermissionDiff {
  const prevRequired = new Set(previous?.required ?? []);
  const prevOptional = new Set(previous?.optional ?? []);
  const nextRequired = new Set(next.required);
  const nextOptional = new Set(next.optional);
  const everyPermission = new Set([
    ...prevRequired,
    ...prevOptional,
    ...nextRequired,
    ...nextOptional,
  ]);

  const diff: PluginPermissionDiff = {
    added: [],
    removed: [],
    nowRequired: [],
    nowOptional: [],
  };
  for (const permission of [...everyPermission].sort()) {
    const wasKnown = prevRequired.has(permission) || prevOptional.has(permission);
    const isKnown = nextRequired.has(permission) || nextOptional.has(permission);
    if (!wasKnown && isKnown) {
      diff.added.push({ permission, required: nextRequired.has(permission) });
      continue;
    }
    if (wasKnown && !isKnown) {
      diff.removed.push({ permission, required: prevRequired.has(permission) });
      continue;
    }
    if (prevOptional.has(permission) && nextRequired.has(permission)) {
      diff.nowRequired.push({ permission, required: true });
      continue;
    }
    if (prevRequired.has(permission) && nextOptional.has(permission)) {
      diff.nowOptional.push({ permission, required: false });
    }
  }
  return diff;
}
