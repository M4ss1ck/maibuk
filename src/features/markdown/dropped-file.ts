import { looksLikeMarkdown } from "@/features/markdown/detect-markdown";
import { markdownToEditorHtml } from "@/features/markdown/markdown-to-html";

/**
 * The file-drop boundary: which dropped files we import as text, and how their
 * content becomes editor HTML. `.txt` is sniffed — markdown-looking text goes
 * through the markdown pipeline, plain prose becomes escaped paragraphs.
 */

export const TEXT_DROP_EXTENSIONS = [".md", ".markdown", ".txt"] as const;

/** Matched supported extension (lowercase, with dot), or null. */
export function textDropExtension(name: string): string | null {
  const lower = name.toLowerCase();
  return TEXT_DROP_EXTENSIONS.find((ext) => lower.endsWith(ext)) ?? null;
}

/** Filename without its supported extension; unchanged if none matches. */
export function textDropStem(name: string): string {
  const ext = textDropExtension(name);
  return ext ? name.slice(0, -ext.length) : name;
}

export function droppedTextToEditorHtml(text: string, extension: string): string {
  if (!text.trim()) return "";
  if (extension === ".txt" && !looksLikeMarkdown(text)) return plainTextToHtml(text);
  return markdownToEditorHtml(text);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Blank-line-separated blocks become <p>; single newlines become <br>. */
function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
