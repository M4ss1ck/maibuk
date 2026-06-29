import { IS_WEB, getDialog, getFileSystem } from "@/lib/platform";

/** Slugifies a title into a safe filename with the given extension. */
export function exportFilename(title: string, extension: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "untitled"}.${extension}`;
}

/**
 * Saves binary data to disk. On the web build it triggers a download; on
 * desktop it opens a native save dialog. Returns true if a file was written,
 * false if the user cancelled the desktop dialog.
 */
export async function saveBinaryFile(
  filename: string,
  bytes: Uint8Array,
  mimeType: string,
  filter: { name: string; extensions: string[] }
): Promise<boolean> {
  if (IS_WEB) {
    const fs = await getFileSystem();
    fs.downloadFile(filename, bytes, mimeType);
    return true;
  }

  const dialog = await getDialog();
  const filePath = await dialog.save({
    defaultPath: filename,
    filters: [filter],
  });
  if (!filePath) return false;

  const fs = await getFileSystem();
  await fs.writeFile(filePath, bytes);
  return true;
}
