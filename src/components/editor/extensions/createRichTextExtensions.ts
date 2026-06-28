import StarterKit from "@tiptap/starter-kit";
import type { Extensions } from "@tiptap/core";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Typography from "@tiptap/extension-typography";
import { TextStyle } from "@tiptap/extension-text-style";
import { FontFamily } from "@tiptap/extension-font-family";
import { Color } from "@tiptap/extension-color";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Link } from "@tiptap/extension-link";
import { CustomHighlight } from "./CustomHighlight";
import { ImageFigure } from "./ImageFigure";
import { SceneBreak } from "./SceneBreak";
import { FontSize } from "./FontSize";
import { LineHeight } from "./LineHeight";
import { Indent } from "./Indent";
import { PasteHandler } from "./PasteHandler";
import { CopyHandler } from "./CopyHandler";
import { CodeBlockWithCopy } from "./CodeBlock";
import { SmartItalic } from "./SmartItalic";
import { SpellCheck } from "./SpellCheck";
import { Footnote } from "./Footnote";
import { HeadingId } from "./HeadingId";
import type { Language } from "../../../features/settings/types";

export interface RichTextExtensionsOptions {
  onMarkdownPaste?: (text: string) => void;
  footnoteStartIndex?: number;
  spellCheck?: { enabled: boolean; language: Language };
}

/**
 * Canonical rich-text schema and authoring behavior shared by the main editor,
 * Quick Note, and the canvas text nodes. Document- and runtime-only extensions
 * (Placeholder, CharacterCount, SearchReplace, MetricsObserver, …) stay with the
 * consumers that need them.
 */
export function createRichTextExtensions({
  onMarkdownPaste,
  footnoteStartIndex = 1,
  spellCheck,
}: RichTextExtensionsOptions = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      underline: false,
      codeBlock: false,
      italic: false,
    }),
    CodeBlockWithCopy,
    SmartItalic,
    HeadingId,
    Underline,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    CustomHighlight.configure({ multicolor: true }),
    Typography,
    TextStyle,
    FontFamily,
    FontSize,
    LineHeight,
    Color,
    Subscript,
    Superscript,
    Table.configure({ resizable: true, HTMLAttributes: { class: "editor-table" } }),
    TableRow,
    TableCell,
    TableHeader,
    ImageFigure.configure({ allowBase64: true }),
    Link.configure({
      openOnClick: false,
      protocols: ["maibuk"],
      HTMLAttributes: { class: "editor-link" },
    }),
    SceneBreak,
    Indent,
    PasteHandler.configure({ onMarkdownPaste: onMarkdownPaste ?? null }),
    CopyHandler,
    Footnote.configure({ startIndex: footnoteStartIndex }),
    ...(spellCheck ? [SpellCheck.configure(spellCheck)] : []),
  ];
}
