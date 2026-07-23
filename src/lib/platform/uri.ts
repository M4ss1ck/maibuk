// Android document pickers return content:// (or file://) URIs, not
// slash-separated filesystem paths. These helpers avoid deriving user-facing
// names/extensions from an opaque URI tail.
export function isContentUri(value: string): boolean {
  return value.startsWith("content://") || value.startsWith("file://");
}

export function displayNameFromPath(value: string, fallback: string): string {
  if (isContentUri(value)) return fallback;
  const segment = value.split(/[\\/]/).pop();
  return segment && segment.length > 0 ? segment : fallback;
}

export function extensionFromPath(value: string, fallback: string): string {
  if (isContentUri(value)) return fallback;
  const name = value.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return fallback;
  return name.slice(dot + 1).toLowerCase();
}
