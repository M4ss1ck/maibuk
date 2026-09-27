import { saveBinaryFile } from "@/features/export/save-binary-file";
import { IS_WEB, getDialog, getFileSystem, getWebDialog } from "@/lib/platform";
import { serializeShortcutFile, type CustomShortcuts } from "@/lib/shortcut-resolve";

export const SHORTCUT_FILE_NAME = "maibuk-shortcuts.json";
const JSON_FILTER = { name: "JSON", extensions: ["json"] };

/** Saves a Shortcut File; false when the author cancelled the desktop dialog. */
export function saveShortcutFile(custom: CustomShortcuts): Promise<boolean> {
  const bytes = new TextEncoder().encode(serializeShortcutFile(custom));
  return saveBinaryFile(SHORTCUT_FILE_NAME, bytes, "application/json", JSON_FILTER);
}

/** The text of a Shortcut File the author picks, or null when they cancel. */
export async function pickShortcutFileText(): Promise<string | null> {
  let data: Uint8Array | null = null;
  if (IS_WEB) {
    const dialog = await getWebDialog();
    data = (await dialog.openWithData({ filters: [JSON_FILTER] }))?.data ?? null;
  } else {
    const dialog = await getDialog();
    const path = await dialog.open({ filters: [JSON_FILTER] });
    if (path) data = await (await getFileSystem()).readFile(path);
  }
  return data ? new TextDecoder().decode(data) : null;
}
