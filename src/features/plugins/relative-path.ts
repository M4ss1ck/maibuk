/**
 * The one Plugin-folder-relative path normalizer: it strips `.` and empty
 * segments, so `./ui/x.html` matches the folder's verified `ui/x.html`. The
 * manifest validator's existence check and the Frame load-message builder share
 * it so the path a manifest validated is the path a Frame looks up. A leaf, so
 * the Frame host does not pull the manifest validator's Zod schema.
 */
export function normalizeRelativePath(value: string): string {
  return value
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
}
