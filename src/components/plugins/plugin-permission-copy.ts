/**
 * Plain-language copy for one Plugin Permission (#442). The prototype's
 * dictionary (PR #410, map section 3) covers `library:read`, `editor:read`,
 * `editor:decorate`, `secrets`, `network:<host>`, and `process`; the three
 * remaining names (`library:write`, `editor:write`, `clipboard`) carry
 * authored copy in the same voice, flagged as new in the PR.
 */

/** A translation function narrowed to the keys and options this module uses. */
export type PermissionTranslate = (key: string, options?: Record<string, unknown>) => string;

/** The i18n suffix of a permission's title/detail pair, keyed by permission name. */
const PERMISSION_COPY_KEYS: Record<string, string> = {
  "library:read": "read",
  "library:write": "libraryWrite",
  "editor:read": "editorRead",
  "editor:decorate": "decorate",
  "editor:write": "editorWrite",
  secrets: "secrets",
  clipboard: "clipboard",
  process: "process",
};

/** The title and detail of one Plugin Permission, in the author's language. */
export function pluginPermissionCopy(
  permission: string,
  t: PermissionTranslate
): { title: string; detail: string } {
  if (permission.startsWith("network:")) {
    return {
      title: t("plugins.permissions.network", { host: permission.slice("network:".length) }),
      detail: t("plugins.permissions.networkDetail"),
    };
  }
  const key = PERMISSION_COPY_KEYS[permission];
  if (key === undefined) return { title: permission, detail: "" };
  return {
    title: t(`plugins.permissions.${key}`),
    detail: t(`plugins.permissions.${key}Detail`),
  };
}
