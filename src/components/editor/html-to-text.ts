/**
 * The plain text of stored editor HTML (#396). This is the single helper the
 * Plugin Library reads (#440) and the editor selection/highlight/reveal work
 * (#441) share as their one coordinate system, so it must derive text exactly
 * the way the editor does.
 *
 * The parse is TipTap's own `generateJSON` + `generateText` path: the HTML
 * goes through the app's rich-text schema, and the walk separates block nodes
 * with TipTap's default `"\n\n"` and turns a hard break into `"\n"`. Nothing is
 * trimmed beyond what the walk produces; trimming would shift the offsets
 * selection and reveal ranges are measured against.
 *
 * The schema, its parser, and the `DOMParser` are built once, not per call.
 * Rebuilding them (and a fresh `DOMParser`) for every block made a full index
 * rebuild of a 1M-word Library take a minute and leaked a document per call;
 * one cached set gives the same text, exactly, and keeps the rebuild inside
 * its budget (#639).
 */

import {
  generateJSON,
  generateText,
  getSchema,
  getText,
  getTextSerializersFromSchema,
  type Extensions,
  type TextSerializer,
} from "@tiptap/core";
import { DOMParser as ProseMirrorDOMParser, type Schema } from "@tiptap/pm/model";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";

// Resolving the schema is the expensive part; the extension list is stateless
// configuration, so one shared instance serves every conversion.
let extensions: Extensions | null = null;
let schema: Schema | null = null;
let parser: ProseMirrorDOMParser | null = null;
let serializers: Record<string, TextSerializer> | null = null;
let htmlParser: DOMParser | null = null;

function editorExtensions(): Extensions {
  extensions ??= createRichTextExtensions();
  return extensions;
}

/**
 * TipTap's own `elementFromString` cleanup: it drops whitespace-only text
 * nodes between blocks before parsing, so the walk sees the same document
 * `generateJSON` would.
 */
function removeWhitespaces(node: Element): void {
  for (let i = node.childNodes.length - 1; i >= 0; i -= 1) {
    const child = node.childNodes[i];
    if (child.nodeType === Node.TEXT_NODE && child.nodeValue && /^(\n\s\s|\n)$/.test(child.nodeValue)) {
      node.removeChild(child);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      removeWhitespaces(child as Element);
    }
  }
}

export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  // TipTap's helpers throw their own error without a window; keep that for a
  // Node caller that reaches this by mistake.
  if (typeof window === "undefined") {
    return generateText(generateJSON(html, editorExtensions()), editorExtensions());
  }

  schema ??= getSchema(editorExtensions());
  parser ??= ProseMirrorDOMParser.fromSchema(schema);
  serializers ??= getTextSerializersFromSchema(schema);
  htmlParser ??= new window.DOMParser();
  const body = htmlParser.parseFromString(`<body>${html}</body>`, "text/html").body;
  removeWhitespaces(body);
  return getText(parser.parse(body), {
    blockSeparator: "\n\n",
    textSerializers: serializers,
  });
}
