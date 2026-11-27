/**
 * Whether a file name ends in one of `extensions` (lowercase, no dot), ignoring
 * the name's case, the way a folder `files.pick` filters what it grants. A dot
 * file such as `.epub` names no extension.
 */
export function hasPluginFileExtension(name: string, extensions: readonly string[]): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return extensions.includes(name.slice(dot + 1).toLowerCase());
}
