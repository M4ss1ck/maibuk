import { save, open } from "@tauri-apps/plugin-dialog";
import type { DialogAdapter, SaveDialogOptions, OpenDialogOptions } from "../types";

export const tauriDialog: DialogAdapter = {
  async save(options: SaveDialogOptions): Promise<string | null> {
    return save(options);
  },

  async open(options: OpenDialogOptions): Promise<string | null> {
    const result = await open({
      multiple: options.multiple,
      filters: options.filters,
    });
    // open() returns string | string[] | null depending on multiple option
    if (Array.isArray(result)) {
      return result[0] || null;
    }
    return result;
  },
};
