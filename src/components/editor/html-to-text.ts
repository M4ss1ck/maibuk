/**
 * The plain text of stored editor HTML (#396). This is the single helper the
 * Plugin Library reads (#440) and the editor selection/highlight/reveal work
 * (#441) share as their one coordinate system, so it must derive text exactly
 * the way the editor does.
 *
 * `generateJSON` parses the HTML into a document with the app's rich-text
 * extensions, and `generateText` walks that schema through the same code path
 * as `editor.getText()`: block nodes separate with TipTap's default
 * `"\n\n"` and a hard break becomes `"\n"`. Nothing is trimmed beyond what the
 * walk produces; trimming would shift the offsets selection and reveal ranges
 * are measured against.
 */

import { generateJSON, generateText, type Extensions } from "@tiptap/core";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";

// Resolving the schema is the expensive part; the extension list is stateless
// configuration, so one shared instance serves every conversion.
let extensions: Extensions | null = null;

function editorExtensions(): Extensions {
  extensions ??= createRichTextExtensions();
  return extensions;
}

export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  const content = generateJSON(html, editorExtensions());
  return generateText(content, editorExtensions());
}
