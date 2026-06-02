import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Editor as TiptapEditor, Extensions } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { CustomHighlight } from "./extensions/CustomHighlight";
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
import { ImageFigure } from "./extensions/ImageFigure";
import { Link } from "@tiptap/extension-link";
import { useEffect, useCallback, useRef, useState } from "react";
import { EditorToolbar } from "./EditorToolbar";
import { SelectionToolbar } from "./SelectionToolbar";
import { LinkClickHandler } from "./LinkClickHandler";
import { LinkDialog } from "./LinkDialog";
import { ImageContextMenu } from "./ImageContextMenu";
import { FootnoteList } from "./FootnoteList";
import { SceneBreak } from "./extensions/SceneBreak";
import { FontSize } from "./extensions/FontSize";
import { LineHeight } from "./extensions/LineHeight";
import { Indent } from "./extensions/Indent";
import { PasteHandler } from "./extensions/PasteHandler";
import { CopyHandler } from "./extensions/CopyHandler";
import { SpellCheck } from "./extensions/SpellCheck";
import { Footnote } from "./extensions/Footnote";
import { MetricsObserver } from "./extensions/MetricsObserver";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../features/settings/store";
import { setContentSilently } from "../../features/metrics/programmatic";

export interface EditorStats {
  words: number;
  characters: number;
  hasSelection: boolean;
}

interface EditorProps {
  content: string | null;
  onUpdate: (content: string) => void;
  onWordCountChange?: (count: number) => void;
  onStatsChange?: (stats: EditorStats) => void;
  onBlur?: () => void;
  placeholder?: string;
  editable?: boolean;
  focusMode?: boolean;
  footnoteStartIndex?: number;
  showInlineFootnotes?: boolean;
  bookId?: string | null;
  chapterId?: string | null;
  extraExtensions?: Extensions;
  headerContent?: React.ReactNode;
  onEditorReady?: (editor: TiptapEditor | null) => void;
}

export function Editor({
  content,
  onUpdate,
  onWordCountChange,
  onStatsChange,
  onBlur,
  placeholder = "Start writing your chapter...",
  editable = true,
  focusMode = false,
  footnoteStartIndex = 1,
  showInlineFootnotes = true,
  bookId = null,
  chapterId = null,
  extraExtensions,
  headerContent,
  onEditorReady,
}: EditorProps) {
  const { t } = useTranslation();
  const spellCheckEnabled = useSettingsStore(
    (state) => state.spellCheckEnabled,
  );
  const language = useSettingsStore((state) => state.language);
  const [showBubbleLinkDialog, setShowBubbleLinkDialog] = useState(false);
  const appliedContentRef = useRef(content);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        // Disable extensions we configure separately
        link: false,
        underline: false,
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
      CharacterCount,
      Underline,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      CustomHighlight.configure({
        multicolor: true,
      }),
      Typography,
      TextStyle,
      FontFamily,
      FontSize,
      LineHeight,
      Color,
      Subscript,
      Superscript,
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: "editor-table",
        },
      }),
      TableRow,
      TableCell,
      TableHeader,
      ImageFigure.configure({
        allowBase64: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "editor-link",
        },
      }),
      SceneBreak,
      Indent,
      PasteHandler,
      CopyHandler,
      Footnote.configure({
        startIndex: footnoteStartIndex,
      }),
      SpellCheck.configure({
        enabled: spellCheckEnabled,
        language,
      }),
      MetricsObserver.configure({
        workId: bookId,
        chapterId,
      }),
      ...(extraExtensions ?? []),
    ],
    content: content || "",
    editable,
    editorProps: {
      attributes: {
        class: "editor-content outline-none min-h-[500px]",
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      appliedContentRef.current = html;
      onUpdate(html);

      if (onWordCountChange) {
        const words = editor.storage.characterCount.words();
        onWordCountChange(words);
      }
    },
  });

  // Expose the editor instance to parents (e.g. the table-of-contents panel)
  useEffect(() => {
    onEditorReady?.(editor ?? null);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  // Update content when it changes externally (e.g., switching chapters)
  useEffect(() => {
    if (!editor || content === null) return;
    if (appliedContentRef.current === content) return;

    setContentSilently(editor, content);
    appliedContentRef.current = content;
  }, [editor, content]);

  useEffect(() => {
    if (!editor?.commands?.setSpellCheckEnabled) return;
    editor.commands.setSpellCheckEnabled(spellCheckEnabled);
  }, [editor?.commands?.setSpellCheckEnabled, spellCheckEnabled]);

  useEffect(() => {
    if (!editor?.commands?.setSpellCheckLanguage) return;
    editor.commands.setSpellCheckLanguage(language);
  }, [editor?.commands?.setSpellCheckLanguage, language]);

  // Update word count on initial load
  useEffect(() => {
    if (editor && onWordCountChange) {
      const words = editor.storage.characterCount.words();
      onWordCountChange(words);
    }
  }, [editor, onWordCountChange]);

  // Track selection changes and update stats
  useEffect(() => {
    if (!editor || !onStatsChange) return;

    const updateStats = () => {
      const { from, to } = editor.state.selection;
      const hasSelection = from !== to;

      if (hasSelection) {
        // Get selected text and calculate stats
        const selectedText = editor.state.doc.textBetween(from, to, " ");
        const words = selectedText
          .trim()
          .split(/\s+/)
          .filter((word) => word.length > 0).length;
        const characters = selectedText.length;
        onStatsChange({ words, characters, hasSelection: true });
      } else {
        // No selection - use total document stats
        const words = editor.storage.characterCount.words();
        const characters = editor.storage.characterCount.characters();
        onStatsChange({ words, characters, hasSelection: false });
      }
    };

    // Initial stats
    updateStats();

    // Listen to selection changes
    editor.on("selectionUpdate", updateStats);
    editor.on("update", updateStats);

    return () => {
      editor.off("selectionUpdate", updateStats);
      editor.off("update", updateStats);
    };
  }, [editor, onStatsChange]);

  const handleFocus = useCallback(() => {
    editor?.chain().focus().run();
  }, [editor]);

  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);

  if (!editor) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">
          {t("editor.loadingEditor")}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex-1 flex flex-col min-h-0 ${focusMode ? "focus-mode" : ""}`}
    >
      {!focusMode && (
        <EditorToolbar
          editor={editor}
          onContextMenuOpenChange={setIsContextMenuOpen}
        />
      )}

      {headerContent}

      <div
        className="flex-1 overflow-auto min-h-0"
        onClick={handleFocus}
        onKeyDown={handleFocus}
        onBlur={onBlur}
      >
        <div className="max-w-editor-max mx-auto p-8">
          <EditorContent editor={editor} />
          {showInlineFootnotes && (
            <FootnoteList editor={editor} startIndex={footnoteStartIndex} />
          )}
        </div>
      </div>

      <LinkClickHandler editor={editor} />
      <ImageContextMenu editor={editor} />

      {/* Floating selection toolbar — hidden when the context menu is open */}
      {!focusMode && !isContextMenuOpen && (
        <SelectionToolbar
          editor={editor}
          onLinkClick={() => setShowBubbleLinkDialog(true)}
        />
      )}
      <LinkDialog
        editor={editor}
        isOpen={showBubbleLinkDialog}
        onClose={() => setShowBubbleLinkDialog(false)}
      />
    </div>
  );
}
