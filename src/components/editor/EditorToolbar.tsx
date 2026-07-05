import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { TableMenu } from "@/components/editor/TableMenu";
import { SceneBreakMenu } from "@/components/editor/SceneBreakMenu";
import { FindReplace } from "@/components/editor/FindReplace";
import { ImageInsertDialog } from "@/components/editor/ImageInsertDialog";
import { FootnoteDialog } from "@/components/editor/FootnoteDialog";
import { LinkDialog, type InternalTarget, type InternalTargetChildrenLoader } from "@/components/editor/LinkDialog";
import { HtmlViewPanel } from "@/components/editor/HtmlViewPanel";
import { EditorContextMenu } from "@/components/editor/EditorContextMenu";
import { findBlockOffsetInHtml } from "@/components/editor/HtmlInspectMenu";
import { ColorPicker } from "@/components/editor/ColorPicker";
import { ToolbarButton, Divider } from "@/components/editor/ToolbarButton";
import { TooltipGroup } from "@/components/ui";
import { TextCaseMenu } from "@/components/editor/TextCaseMenu";
import { FontSizeSelect } from "@/components/editor/FontSizeSelect";
import { LineHeightSelect } from "@/components/editor/LineHeightSelect";
import { FontFamilySelect } from "@/components/editor/FontFamilySelect";
import { ZoomControl } from "@/components/editor/ZoomControl";
import { WidthControl } from "@/components/editor/WidthControl";
import { DictionaryDialog } from "@/components/editor/DictionaryDialog";
import { ShortcutsHelpDialog } from "@/components/ShortcutsHelpDialog";
import { useActiveShortcuts } from "@/hooks";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/features/settings/store";
import { LANGUAGE_OPTIONS, type Language } from "@/features/settings/types";
import { openExternal } from "@/lib/platform";
import { isModKey } from "@/lib/keyboard";
import { useShortcuts } from "@/lib/shortcuts";
import { matchKeys } from "@/lib/shortcut-registry";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Highlighter,
  Subscript,
  Superscript,
  Baseline,
  Link,
  Code,
  SquareCode,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  IndentIncrease,
  IndentDecrease,
  AlignLeft,
  AlignCenter,
  AlignRight,
  RemoveFormatting,
  Image,
  MessageSquareText,
  Minus,
  Undo2,
  Redo2,
  Search,
  Code2,
  WrapText,
  ChevronDown,
  ChevronUp,
  BookOpen,
  SpellCheck,
  FileDown,
  FileText,
  ImageDown,
} from "lucide-react";

interface EditorToolbarProps {
  editor: Editor;
  onContextMenuOpenChange?: (open: boolean) => void;
  bookId?: string | null;
  spellCheckLanguage: Language;
  onSpellCheckLanguageChange?: (language: Language) => void;
  internalTargets?: InternalTarget[];
  loadInternalTargetChildren?: InternalTargetChildrenLoader;
  onExportMarkdown?: () => void;
  onExportPdf?: () => void;
  onExportImage?: () => void;
}

const HEADING_SIZES: Record<1 | 2 | 3, string> = {
  1: "36",
  2: "27",
  3: "22",
};
const DEFAULT_FONT_SIZE = "18";

export function EditorToolbar({
  editor,
  onContextMenuOpenChange,
  bookId,
  spellCheckLanguage,
  onSpellCheckLanguageChange,
  internalTargets,
  loadInternalTargetChildren,
  onExportMarkdown,
  onExportPdf,
  onExportImage,
}: EditorToolbarProps) {
  const { t } = useTranslation();
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findReplaceFocusSignal, setFindReplaceFocusSignal] = useState(0);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [showFootnoteDialog, setShowFootnoteDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showHtmlPanel, setShowHtmlPanel] = useState(false);
  const [showDictionaryDialog, setShowDictionaryDialog] = useState(false);
  const [dictionaryWord, setDictionaryWord] = useState("");
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const shortcuts = useActiveShortcuts();
  const [isToolbarExpanded, setIsToolbarExpanded] = [
    useSettingsStore((state) => state.toolbarExpanded),
    useSettingsStore((state) => state.setToolbarExpanded),
  ];
  const spellCheckEnabled = useSettingsStore((state) => state.spellCheckEnabled);
  const setSpellCheckEnabled = useSettingsStore((state) => state.setSpellCheckEnabled);
  const showNotesChapter = useSettingsStore((state) => state.showNotesChapter);
  const setShowNotesChapter = useSettingsStore((state) => state.setShowNotesChapter);
  const bookSidePanelTab = useSettingsStore((state) => state.bookSidePanelTab);
  const setBookSidePanelTab = useSettingsStore((state) => state.setBookSidePanelTab);
  const dictionaryOpenInBrowser = useSettingsStore((state) => state.dictionaryOpenInBrowser);

  // Track editor focus with a delayed blur so toolbar clicks still read it as focused
  const editorWasFocusedRef = useRef(false);
  const showHtmlPanelRef = useRef(showHtmlPanel);
  showHtmlPanelRef.current = showHtmlPanel;
  const htmlPanelHandleRef = useRef<{
    highlightRange: (from: number, to: number) => void;
  } | null>(null);
  const pendingInspectRef = useRef<number | null>(null);

  const handleInspect = useCallback(
    (blockIndex: number) => {
      // Open panel if not already open
      if (!showHtmlPanelRef.current) {
        setShowHtmlPanel(true);
      }

      // If handle is ready, highlight immediately; otherwise queue it for onReady
      const html = editor.getHTML();
      const range = findBlockOffsetInHtml(html, blockIndex);
      if (range && htmlPanelHandleRef.current) {
        htmlPanelHandleRef.current.highlightRange(range.from, range.to);
      } else {
        pendingInspectRef.current = blockIndex;
      }
    },
    [editor]
  );

  const openFindReplace = useCallback(() => {
    setShowFindReplace(true);
    setFindReplaceFocusSignal((current) => current + 1);
  }, []);

  const handleHtmlPanelReady = useCallback(
    (handle: { highlightRange: (from: number, to: number) => void } | null) => {
      htmlPanelHandleRef.current = handle;
      if (handle && pendingInspectRef.current !== null) {
        const html = editor.getHTML();
        const range = findBlockOffsetInHtml(html, pendingInspectRef.current);
        if (range) {
          handle.highlightRange(range.from, range.to);
        }
        pendingInspectRef.current = null;
      }
    },
    [editor]
  );
  useEffect(() => {
    const dom = editor.view.dom;
    const onFocus = () => {
      editorWasFocusedRef.current = true;
    };
    const onBlur = () => {
      setTimeout(() => {
        editorWasFocusedRef.current = false;
      }, 150);
    };
    dom.addEventListener("focus", onFocus);
    dom.addEventListener("blur", onBlur);
    return () => {
      dom.removeEventListener("focus", onFocus);
      dom.removeEventListener("blur", onBlur);
    };
  }, [editor]);

  const editorState = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const attrs = e.getAttributes("textStyle");
      const highlightAttrs = e.getAttributes("highlight");

      return {
        fontSize: attrs.fontSize ? attrs.fontSize.replace("px", "") : DEFAULT_FONT_SIZE,
        lineHeight: attrs.lineHeight || "1.5",
        fontFamily: attrs.fontFamily || "Literata, serif",
        color: attrs.color || "",
        highlightColor: highlightAttrs.color || "",
        isBold: e.isActive("bold"),
        isItalic: e.isActive("italic"),
        isUnderline: e.isActive("underline"),
        isStrike: e.isActive("strike"),
        isHighlight: e.isActive("highlight"),
        isSubscript: e.isActive("subscript"),
        isSuperscript: e.isActive("superscript"),
        isLink: e.isActive("link"),
        isCode: e.isActive("code"),
        isCodeBlock: e.isActive("codeBlock"),
        isH1: e.isActive("heading", { level: 1 }),
        isH2: e.isActive("heading", { level: 2 }),
        isH3: e.isActive("heading", { level: 3 }),
        isBulletList: e.isActive("bulletList"),
        isOrderedList: e.isActive("orderedList"),
        isTaskList: e.isActive("taskList"),
        isBlockquote: e.isActive("blockquote"),
        isAlignLeft: e.isActive({ textAlign: "left" }),
        isAlignCenter: e.isActive({ textAlign: "center" }),
        isAlignRight: e.isActive({ textAlign: "right" }),
        hasSelection: !e.state.selection.empty,
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        canSinkListItem: e.can().sinkListItem("listItem"),
        canLiftListItem: e.can().liftListItem("listItem"),
      };
    },
  });

  const handleHeadingToggle = (level: 1 | 2 | 3) => {
    const isCurrentlyActive =
      (level === 1 && editorState.isH1) ||
      (level === 2 && editorState.isH2) ||
      (level === 3 && editorState.isH3);

    if (isCurrentlyActive) {
      editor
        .chain()
        .focus()
        .toggleHeading({ level })
        .setFontSize(`${DEFAULT_FONT_SIZE}px`)
        .setFontFamily(editorState.fontFamily)
        .run();
    } else {
      editor
        .chain()
        .focus()
        .toggleHeading({ level })
        .setFontSize(`${HEADING_SIZES[level]}px`)
        .setFontFamily(editorState.fontFamily)
        .run();
    }
  };

  const handleSpellCheckToggle = () => {
    const nextEnabled = !spellCheckEnabled;
    setSpellCheckEnabled(nextEnabled);
  };

  const handleOpenDictionary = () => {
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ").trim();
    if (!selectedText) return;
    const word = selectedText.split(/\s+/)[0];
    if (!word) return;
    handleLookupWord(word);
  };

  const handleLookupWord = useCallback(
    (word: string) => {
      if (dictionaryOpenInBrowser) {
        const url = `https://${spellCheckLanguage}.wiktionary.org/wiki/${encodeURIComponent(word)}`;
        openExternal(url);
        return;
      }
      setDictionaryWord(word);
      setShowDictionaryDialog(true);
    },
    [dictionaryOpenInBrowser, spellCheckLanguage]
  );

  const handleSpellCheckLanguageChange = useCallback(
    (nextLanguage: Language) => {
      editor.commands.setSpellCheckLanguage(nextLanguage);
      onSpellCheckLanguageChange?.(nextLanguage);
    },
    [editor, onSpellCheckLanguageChange]
  );

  useEffect(() => {
    const dom = editor.view.dom;

    const handleEditorKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || !isModKey(event)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "k") {
        event.preventDefault();
        setShowLinkDialog(true);
        return;
      }

      if (event.altKey && key === "n") {
        event.preventDefault();
        setShowFootnoteDialog(true);
      }

      if (event.shiftKey && key === "u") {
        event.preventDefault();
        setShowHtmlPanel(!showHtmlPanelRef.current);
        return;
      }
    };

    dom.addEventListener("keydown", handleEditorKeyDown);
    return () => {
      dom.removeEventListener("keydown", handleEditorKeyDown);
    };
  }, [editor]);

  useShortcuts([
    {
      keys: matchKeys("editor.findReplace"),
      allowInInput: true,
      onTrigger: openFindReplace,
    },
  ]);

  return (
    <TooltipGroup>
    <div className="border-b border-border bg-background sticky top-0 z-10">
      {/* Compact toolbar — always visible */}
      <div className="flex flex-wrap items-center px-2 sm:px-4 py-1 sm:py-2 gap-0.5 sm:gap-1">
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editorState.canUndo}
          label={t("editor.undo")}
          shortcut="editor.undo"
        >
          <Undo2 className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editorState.canRedo}
          label={t("editor.redo")}
          shortcut="editor.redo"
        >
          <Redo2 className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        <FontSizeSelect editor={editor} value={editorState.fontSize} />
        <FontFamilySelect editor={editor} value={editorState.fontFamily} />

        <Divider />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editorState.isBold}
          label={t("editor.bold")}
          shortcut="editor.bold"
        >
          <Bold className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editorState.isItalic}
          label={t("editor.italic")}
          shortcut="editor.italic"
        >
          <Italic className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editorState.isUnderline}
          label={t("editor.underline")}
          shortcut="editor.underline"
        >
          <Underline className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editorState.isStrike}
          label={t("editor.strikethrough")}
        >
          <Strikethrough className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        <ToolbarButton
          onClick={() => handleHeadingToggle(1)}
          isActive={editorState.isH1}
          label={t("editor.heading1")}
        >
          <Heading1 className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => handleHeadingToggle(2)}
          isActive={editorState.isH2}
          label={t("editor.heading2")}
        >
          <Heading2 className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => handleHeadingToggle(3)}
          isActive={editorState.isH3}
          label={t("editor.heading3")}
        >
          <Heading3 className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        <ToolbarButton
          onClick={() => {
            if (showFindReplace) {
              setShowFindReplace(false);
            } else {
              openFindReplace();
            }
          }}
          isActive={showFindReplace}
          label={t("editor.findReplace")}
          shortcut="editor.findReplace"
        >
          <Search className="w-4 h-4" />
        </ToolbarButton>

        {/* Expand/collapse toggle */}
        <div className="ml-auto flex items-center gap-0.5">
          <WidthControl />
          <Divider />
          <ZoomControl />
          <button
            type="button"
            onClick={() => setIsToolbarExpanded(!isToolbarExpanded)}
            className="p-2 rounded hover:bg-muted transition-colors text-muted-foreground"
            title={isToolbarExpanded ? t("editor.hideToolbar") : t("editor.showToolbar")}
          >
            {isToolbarExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Extended toolbar — visible when expanded */}
      {isToolbarExpanded && (
        <div className="flex flex-wrap items-center px-2 sm:px-4 py-1 sm:py-2 gap-0.5 sm:gap-1 overflow-x-auto border-t border-border">
          <LineHeightSelect editor={editor} value={editorState.lineHeight} />

          <Divider />

          <ColorPicker
            value={editorState.highlightColor}
            onChange={(color) => editor.chain().focus().setHighlight({ color }).run()}
            onClear={() => editor.chain().focus().unsetHighlight().run()}
            onToggle={() =>
              editor
                .chain()
                .focus()
                .toggleHighlight({
                  color: editorState.highlightColor || "#FFFF00",
                })
                .run()
            }
            isActive={editorState.isHighlight}
            title={t("editor.highlight")}
            icon={<Highlighter className="w-4 h-4" />}
          />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleSubscript().run()}
          isActive={editorState.isSubscript}
          label={t("editor.subscript")}
        >
          <Subscript className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
          isActive={editorState.isSuperscript}
          label={t("editor.superscript")}
        >
          <Superscript className="w-4 h-4" />
        </ToolbarButton>

          <ColorPicker
            value={editorState.color}
            onChange={(color) => editor.chain().focus().setColor(color).run()}
            onClear={() => editor.chain().focus().unsetColor().run()}
            onToggle={() =>
              editorState.color
                ? editor.chain().focus().unsetColor().run()
                : editor.chain().focus().setColor("#000000").run()
            }
            isActive={!!editorState.color}
            title={t("editor.textColor")}
            icon={<Baseline className="w-4 h-4" />}
          />

        <ToolbarButton
          onClick={() => setShowLinkDialog(true)}
          isActive={editorState.isLink}
          label={t("editor.insertLink")}
          shortcut="editor.insertLink"
        >
          <Link className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editorState.isCode}
          label={t("editor.code")}
        >
          <Code className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          isActive={editorState.isCodeBlock}
          label={t("editor.codeBlock")}
        >
          <SquareCode className="w-4 h-4" />
        </ToolbarButton>

          <Divider />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editorState.isBulletList}
            label={t("editor.bulletList")}
          >
            <List className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editorState.isOrderedList}
            label={t("editor.numberedList")}
          >
            <ListOrdered className="w-4 h-4" />
          </ToolbarButton>

          {editor.schema.nodes.taskList !== undefined && (
            <ToolbarButton
              onClick={() => (editor.commands as any).toggleTaskList()}
              isActive={editorState.isTaskList}
              label={t("editor.taskList")}
            >
              <ListChecks className="w-4 h-4" />
            </ToolbarButton>
          )}

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            isActive={editorState.isBlockquote}
            label={t("editor.quote")}
          >
            <Quote className="w-4 h-4" />
          </ToolbarButton>

          <Divider />

          <ToolbarButton
            onClick={() =>
              editorState.canSinkListItem
                ? editor.chain().focus().sinkListItem("listItem").run()
                : editor.chain().focus().increaseIndent().run()
            }
            label={t("editor.increaseIndent")}
            shortcut="editor.increaseIndent"
          >
            <IndentIncrease className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() =>
              editorState.canLiftListItem
                ? editor.chain().focus().liftListItem("listItem").run()
                : editor.chain().focus().decreaseIndent().run()
            }
            label={t("editor.decreaseIndent")}
            shortcut="editor.decreaseIndent"
          >
            <IndentDecrease className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().increaseFirstLineIndent().run()}
            label={t("editor.increaseFirstLineIndent")}
          >
            <WrapText className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().decreaseFirstLineIndent().run()}
            label={t("editor.decreaseFirstLineIndent")}
          >
            <WrapText className="w-4 h-4 scale-x-[-1]" />
          </ToolbarButton>

          <Divider />

          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            isActive={editorState.isAlignLeft}
            label={t("editor.alignLeft")}
          >
            <AlignLeft className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            isActive={editorState.isAlignCenter}
            label={t("editor.alignCenter")}
          >
            <AlignCenter className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            isActive={editorState.isAlignRight}
            label={t("editor.alignRight")}
          >
            <AlignRight className="w-4 h-4" />
          </ToolbarButton>

          <Divider />

          <ToolbarButton
            onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
            label={t("editor.removeFormatting")}
          >
            <RemoveFormatting className="w-4 h-4" />
          </ToolbarButton>

          <Divider />

          <TextCaseMenu editor={editor} />

          <Divider />

          <TableMenu editor={editor} />

          <ToolbarButton onClick={() => setShowImageDialog(true)} label={t("editor.insertImage")}>
            <Image className="w-4 h-4" />
          </ToolbarButton>

          <SceneBreakMenu editor={editor} bookId={bookId} />

          <ToolbarButton
            onClick={() => {
              if (editorWasFocusedRef.current) {
                setShowFootnoteDialog(true);
              } else if (showNotesChapter && bookSidePanelTab === "footnotes") {
                setShowNotesChapter(false);
              } else {
                setBookSidePanelTab("footnotes");
                setShowNotesChapter(true);
              }
            }}
            label={t("editor.footnote")}
          >
            <MessageSquareText className="w-4 h-4" />
          </ToolbarButton>

          <Divider />

          <ToolbarButton
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            label={t("editor.horizontalRule")}
          >
            <Minus className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={handleSpellCheckToggle}
            isActive={spellCheckEnabled}
            label={t("editor.spellCheck")}
          >
            <SpellCheck className="w-4 h-4" />
          </ToolbarButton>
          <SpellCheckLanguageMenu
            value={spellCheckLanguage}
            onChange={handleSpellCheckLanguageChange}
            label={t("editor.spellCheckLanguage")}
          />

          <ToolbarButton
            onClick={handleOpenDictionary}
            disabled={!editorState.hasSelection}
            label={t("editor.dictionary")}
          >
            <BookOpen className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => {
              setShowHtmlPanel(true);
            }}
            label={t("editor.viewHtml")}
          >
            <Code2 className="w-4 h-4" />
          </ToolbarButton>

          {(onExportMarkdown || onExportPdf || onExportImage) && <Divider />}
          {onExportMarkdown && (
            <ToolbarButton onClick={onExportMarkdown} label={t("editor.exportMarkdown")}>
              <FileDown className="w-4 h-4" />
            </ToolbarButton>
          )}
          {onExportPdf && (
            <ToolbarButton onClick={onExportPdf} label={t("editor.exportPdf")}>
              <FileText className="w-4 h-4" />
            </ToolbarButton>
          )}
          {onExportImage && (
            <ToolbarButton onClick={onExportImage} label={t("editor.exportImage")}>
              <ImageDown className="w-4 h-4" />
            </ToolbarButton>
          )}

          <Divider />

          <ToolbarButton
            onClick={() => setShowShortcutsHelp(true)}
            label={t("shortcuts.title")}
          >
            <span className="w-4 h-4 flex items-center justify-center font-bold">?</span>
          </ToolbarButton>
        </div>
      )}

      {/* Panels and Dialogs */}
      {showHtmlPanel && (
        <HtmlViewPanel
          editor={editor}
          isOpen={showHtmlPanel}
          onClose={() => {
            setShowHtmlPanel(false);
            htmlPanelHandleRef.current = null;
            pendingInspectRef.current = null;
          }}
          onReady={handleHtmlPanelReady}
        />
      )}
      <EditorContextMenu
        editor={editor}
        onInspect={handleInspect}
        onLookup={handleLookupWord}
        onEditLink={() => setShowLinkDialog(true)}
        onOpenChange={onContextMenuOpenChange}
      />
      <FindReplace
        editor={editor}
        isOpen={showFindReplace}
        onClose={() => setShowFindReplace(false)}
        focusSignal={findReplaceFocusSignal}
      />
      <ImageInsertDialog
        editor={editor}
        isOpen={showImageDialog}
        onClose={() => setShowImageDialog(false)}
      />
      <FootnoteDialog
        editor={editor}
        isOpen={showFootnoteDialog}
        onClose={() => setShowFootnoteDialog(false)}
      />
      <LinkDialog
        editor={editor}
        isOpen={showLinkDialog}
        onClose={() => setShowLinkDialog(false)}
        bookId={bookId}
        internalTargets={internalTargets}
        loadInternalTargetChildren={loadInternalTargetChildren}
      />
      <DictionaryDialog
        isOpen={showDictionaryDialog}
        word={dictionaryWord}
        language={spellCheckLanguage}
        onClose={() => setShowDictionaryDialog(false)}
      />
      <ShortcutsHelpDialog
        isOpen={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
        title={t("shortcuts.title")}
        shortcuts={shortcuts}
      />
    </div>
    </TooltipGroup>
  );
}

interface SpellCheckLanguageMenuProps {
  value: Language;
  onChange: (language: Language) => void;
  label: string;
}

function SpellCheckLanguageMenu({ value, onChange, label }: SpellCheckLanguageMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = LANGUAGE_OPTIONS.find((option) => option.value === value) ?? LANGUAGE_OPTIONS[0];

  const toggle = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((current) => !current);
  };

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const isMenuTarget =
        target instanceof HTMLElement && target.closest(".spellcheck-language-menu-portal");
      if (buttonRef.current?.contains(target) || isMenuTarget) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title={label}
        aria-label={label}
        className={`flex h-8 w-7 flex-col items-center justify-center gap-0 rounded text-[10px] font-medium leading-none transition-colors ${open ? "bg-primary text-white" : "hover:bg-muted"
          }`}
      >
        <span className="uppercase">{selected.value}</span>
        <ChevronDown className="h-2.5 w-2.5" />
      </button>
      {open &&
        createPortal(
          <div
            className="spellcheck-language-menu-portal fixed z-50 min-w-32 rounded-lg border border-border bg-card py-1 shadow-lg"
            style={{ top: position.top, left: position.left }}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted ${option.value === value ? "text-primary" : "text-foreground"
                  }`}
              >
                <span>{option.label}</span>
                <span className="text-xs uppercase text-muted-foreground">{option.value}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
