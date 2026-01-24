import type {
  WebDialogAdapter,
  SaveDialogOptions,
  OpenDialogOptions,
  FileWithData,
} from "../types";

function getAcceptString(
  filters?: { name: string; extensions: string[] }[]
): string {
  if (!filters) return "*";
  return filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");
}

export const webDialog: WebDialogAdapter = {
  async save(options: SaveDialogOptions): Promise<string | null> {
    // On web, we don't show a real save dialog - just return the suggested filename
    // The actual download happens through FileSystemAdapter.downloadFile
    const filename = options.defaultPath || "download";
    return filename;
  },

  async open(options: OpenDialogOptions): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = getAcceptString(options.filters);

      input.onchange = () => {
        const file = input.files?.[0];
        resolve(file ? file.name : null);
      };

      // Handle cancel by detecting focus return without selection
      const handleFocus = () => {
        // Small delay to allow onchange to fire first if a file was selected
        setTimeout(() => {
          if (!input.files?.length) {
            resolve(null);
          }
          window.removeEventListener("focus", handleFocus);
        }, 300);
      };
      window.addEventListener("focus", handleFocus);

      input.click();
    });
  },

  async openWithData(options: OpenDialogOptions): Promise<FileWithData | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = getAcceptString(options.filters);

      input.onchange = async () => {
        const file = input.files?.[0];
        if (file) {
          try {
            const buffer = await file.arrayBuffer();
            resolve({
              name: file.name,
              data: new Uint8Array(buffer),
            });
          } catch (error) {
            console.error("Failed to read file:", error);
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };

      // Handle cancel
      const handleFocus = () => {
        setTimeout(() => {
          if (!input.files?.length) {
            resolve(null);
          }
          window.removeEventListener("focus", handleFocus);
        }, 300);
      };
      window.addEventListener("focus", handleFocus);

      input.click();
    });
  },
};
