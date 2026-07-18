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
import { CustomHighlight } from "@/components/editor/extensions/CustomHighlight";
import { ImageFigure } from "@/components/editor/extensions/ImageFigure";
import { SceneBreak } from "@/components/editor/extensions/SceneBreak";
import { FontSize } from "@/components/editor/extensions/FontSize";
import { LineHeight } from "@/components/editor/extensions/LineHeight";
import { Indent } from "@/components/editor/extensions/Indent";
import { PasteHandler } from "@/components/editor/extensions/PasteHandler";
import { CopyHandler } from "@/components/editor/extensions/CopyHandler";
import { CodeBlockWithCopy } from "@/components/editor/extensions/CodeBlock";
import { CustomCode } from "@/components/editor/extensions/CustomCode";
import { SmartItalic } from "@/components/editor/extensions/SmartItalic";
import { SpellCheck } from "@/components/editor/extensions/SpellCheck";
import { Footnote } from "@/components/editor/extensions/Footnote";
import { HeadingId } from "@/components/editor/extensions/HeadingId";
import { SymbolAutocomplete } from "@/components/editor/extensions/SymbolAutocomplete";
import { AutoClose } from "@/components/editor/extensions/AutoClose";
import type { Language } from "@/features/settings/types";

export interface RichTextExtensionsOptions {
  onMarkdownPaste?: (text: string) => void;
  footnoteStartIndex?: number;
  spellCheck?: { enabled: boolean; language: Language };
  autoClose?: boolean;
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
  autoClose = false,
}: RichTextExtensionsOptions = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      underline: false,
      codeBlock: false,
      italic: false,
      code: false,
    }),
    CodeBlockWithCopy,
    CustomCode,
    SmartItalic,
    ...(autoClose ? [AutoClose] : []),
    HeadingId,
    Underline,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    CustomHighlight.configure({ multicolor: true }),
    // When autoclose is on, AutoClose owns double quotes (inserting curly pairs),
    // so Typography's double-quote rules are disabled to avoid the two racing on
    // dead-key/composition input. All other Typography rules stay active.
    Typography.configure(autoClose ? { openDoubleQuote: false, closeDoubleQuote: false } : {}),
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
    SymbolAutocomplete,
    Footnote.configure({ startIndex: footnoteStartIndex }),
    ...(spellCheck ? [SpellCheck.configure(spellCheck)] : []),
  ];
}
