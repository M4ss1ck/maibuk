import type { FileSystemAdapter } from "../types";

export const webFileSystem: FileSystemAdapter = {
  async writeFile(_path: string, _data: Uint8Array): Promise<void> {
    // On web, we can't write directly to the file system
    // Use downloadFile instead
    throw new Error(
      "Direct file writing not supported on web. Use downloadFile instead."
    );
  },

  async readFile(_path: string): Promise<Uint8Array> {
    // On web, we can't read from arbitrary paths
    // Use openWithData from the dialog adapter instead
    throw new Error(
      "Direct file reading not supported on web. Use dialog.openWithData instead."
    );
  },

  downloadFile(filename: string, data: Uint8Array, mimeType: string): void {
    const blob = new Blob([new Uint8Array(data)], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
