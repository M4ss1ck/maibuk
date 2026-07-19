import type { DroppedTextFile } from "@/hooks/useTextFileDrop";
import { droppedTextToEditorHtml } from "@/features/markdown/dropped-file";

/** Editor HTML for a batch of dropped files, concatenated in drop order. */
export function buildDropHtml(files: DroppedTextFile[]): string {
  return files
    .map((file) => droppedTextToEditorHtml(file.text, file.extension))
    .filter(Boolean)
    .join("");
}
