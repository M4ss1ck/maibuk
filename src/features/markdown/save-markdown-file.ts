import { IS_WEB, getDialog, getFileSystem } from "../../lib/platform";

/**
 * Saves Markdown text to disk. On the web build it triggers a download; on
 * desktop it opens a native save dialog. Returns true if a file was written,
 * false if the user cancelled the desktop dialog.
 */
export async function saveMarkdownFile(filename: string, markdown: string): Promise<boolean> {
  const bytes = new TextEncoder().encode(markdown);

  if (IS_WEB) {
    const fs = await getFileSystem();
    fs.downloadFile(filename, bytes, "text/markdown");
    return true;
  }

  const dialog = await getDialog();
  const filePath = await dialog.save({
    defaultPath: filename,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!filePath) return false;

  const fs = await getFileSystem();
  await fs.writeFile(filePath, bytes);
  return true;
}
