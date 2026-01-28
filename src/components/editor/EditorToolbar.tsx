import { useState } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { TableMenu } from "./TableMenu";
import { FindReplace } from "./FindReplace";
import { ImageInsertDialog } from "./ImageInsertDialog";
import { FootnoteDialog } from "./FootnoteDialog";
import { LinkDialog } from "./LinkDialog";
import { HtmlViewPanel } from "./HtmlViewPanel";
import { ColorPicker } from "./ColorPicker";
import { ToolbarButton, Divider } from "./ToolbarButton";
import { TextCaseMenu } from "./TextCaseMenu";
import { FontSizeSelect } from "./FontSizeSelect";
import { LineHeightSelect } from "./LineHeightSelect";
import { FontFamilySelect } from "./FontFamilySelect";
import { useTranslation } from "react-i18next";
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
  Quote,
  IndentIncrease,
  IndentDecrease,
  AlignLeft,
  AlignCenter,
  AlignRight,
  RemoveFormatting,
  Image,
  Ellipsis,
  MessageSquareText,
  Minus,
  Undo2,
  Redo2,
  Search,
  Code2,
  WrapText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface EditorToolbarProps {
  editor: Editor;
}

const HEADING_SIZES: Record<1 | 2 | 3, string> = {
  1: "36",
  2: "27",
  3: "22",
};
const DEFAULT_FONT_SIZE = "18";

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const { t } = useTranslation();
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [showFootnoteDialog, setShowFootnoteDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showHtmlDialog, setShowHtmlDialog] = useState(false);
  const [isToolbarExpanded, setIsToolbarExpanded] = useState(false);

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
        isBlockquote: e.isActive("blockquote"),
        isAlignLeft: e.isActive({ textAlign: "left" }),
        isAlignCenter: e.isActive({ textAlign: "center" }),
        isAlignRight: e.isActive({ textAlign: "right" }),
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

  return (
    <div className="border-b border-border bg-background sticky top-0 z-10">
      {/* Mobile toolbar toggle */}
      <div className="flex md:hidden items-center justify-between px-4 py-1 border-b border-border">
        <span className="text-xs font-medium">{t("editor.toolbar")}</span>
        <button
          onClick={() => setIsToolbarExpanded(!isToolbarExpanded)}
          className="p-1 rounded hover:bg-muted transition-colors"
          title={isToolbarExpanded ? t("editor.hideToolbar") : t("editor.showToolbar")}
        >
          {isToolbarExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Toolbar content */}
      <div className={`${isToolbarExpanded ? 'flex' : 'hidden'} md:flex flex-wrap items-center px-2 sm:px-4 py-1 sm:py-2 gap-0.5 sm:gap-1 overflow-x-auto`}>
        <FontSizeSelect editor={editor} value={editorState.fontSize} />
        <FontFamilySelect editor={editor} value={editorState.fontFamily} />

        <Divider />

        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} isActive={editorState.isBold} title={t("editor.bold")}>
          <Bold className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} isActive={editorState.isItalic} title={t("editor.italic")}>
          <Italic className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} isActive={editorState.isUnderline} title={t("editor.underline")}>
          <Underline className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} isActive={editorState.isStrike} title={t("editor.strikethrough")}>
          <Strikethrough className="w-4 h-4" />
        </ToolbarButton>

        <ColorPicker
          value={editorState.highlightColor}
          onChange={(color) => editor.chain().focus().setHighlight({ color }).run()}
          onClear={() => editor.chain().focus().unsetHighlight().run()}
          onToggle={() => editor.chain().focus().toggleHighlight({ color: editorState.highlightColor || "#FFFF00" }).run()}
          isActive={editorState.isHighlight}
          title={t("editor.highlight")}
          icon={<Highlighter className="w-4 h-4" />}
        />

        <ToolbarButton onClick={() => editor.chain().focus().toggleSubscript().run()} isActive={editorState.isSubscript} title={t("editor.subscript")}>
          <Subscript className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => editor.chain().focus().toggleSuperscript().run()} isActive={editorState.isSuperscript} title={t("editor.superscript")}>
          <Superscript className="w-4 h-4" />
        </ToolbarButton>

        <ColorPicker
          value={editorState.color}
          onChange={(color) => editor.chain().focus().setColor(color).run()}
          onClear={() => editor.chain().focus().unsetColor().run()}
          onToggle={() => editorState.color ? editor.chain().focus().unsetColor().run() : editor.chain().focus().setColor("#000000").run()}
          isActive={!!editorState.color}
          title={t("editor.textColor")}
          icon={<Baseline className="w-4 h-4" />}
        />

        <ToolbarButton onClick={() => setShowLinkDialog(true)} isActive={editorState.isLink} title={t("editor.insertLinkShortcut")}>
          <Link className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} isActive={editorState.isCode} title={t("editor.code")}>
          <Code className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} isActive={editorState.isCodeBlock} title={t("editor.codeBlock")}>
          <SquareCode className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        <ToolbarButton onClick={() => handleHeadingToggle(1)} isActive={editorState.isH1} title={t("editor.heading1")}>
          <Heading1 className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => handleHeadingToggle(2)} isActive={editorState.isH2} title={t("editor.heading2")}>
          <Heading2 className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => handleHeadingToggle(3)} isActive={editorState.isH3} title={t("editor.heading3")}>
          <Heading3 className="w-4 h-4" />
        </ToolbarButton>

        <LineHeightSelect editor={editor} value={editorState.lineHeight} />

        <Divider />

        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} isActive={editorState.isBulletList} title={t("editor.bulletList")}>
          <List className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} isActive={editorState.isOrderedList} title={t("editor.numberedList")}>
          <ListOrdered className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} isActive={editorState.isBlockquote} title={t("editor.quote")}>
          <Quote className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        <ToolbarButton
          onClick={() => editorState.canSinkListItem ? editor.chain().focus().sinkListItem("listItem").run() : editor.chain().focus().increaseIndent().run()}
          title={t("editor.increaseIndent")}
        >
          <IndentIncrease className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editorState.canLiftListItem ? editor.chain().focus().liftListItem("listItem").run() : editor.chain().focus().decreaseIndent().run()}
          title={t("editor.decreaseIndent")}
        >
          <IndentDecrease className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => editor.chain().focus().increaseFirstLineIndent().run()} title={t("editor.increaseFirstLineIndent")}>
          <WrapText className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => editor.chain().focus().decreaseFirstLineIndent().run()} title={t("editor.decreaseFirstLineIndent")}>
          <WrapText className="w-4 h-4 scale-x-[-1]" />
        </ToolbarButton>

        <Divider />

        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("left").run()} isActive={editorState.isAlignLeft} title={t("editor.alignLeft")}>
          <AlignLeft className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("center").run()} isActive={editorState.isAlignCenter} title={t("editor.alignCenter")}>
          <AlignCenter className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("right").run()} isActive={editorState.isAlignRight} title={t("editor.alignRight")}>
          <AlignRight className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        <ToolbarButton onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title={t("editor.removeFormatting")}>
          <RemoveFormatting className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        <TextCaseMenu editor={editor} />

        <Divider />

        <TableMenu editor={editor} />

        <ToolbarButton onClick={() => setShowImageDialog(true)} title={t("editor.insertImage")}>
          <Image className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => (editor.commands as any).setSceneBreak?.()} title={t("editor.sceneBreak")}>
          <Ellipsis className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => setShowFootnoteDialog(true)} title={t("editor.footnote")}>
          <MessageSquareText className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title={t("editor.horizontalRule")}>
          <Minus className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editorState.canUndo} title={t("editor.undo")}>
          <Undo2 className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editorState.canRedo} title={t("editor.redo")}>
          <Redo2 className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        <ToolbarButton onClick={() => setShowFindReplace(!showFindReplace)} isActive={showFindReplace} title={t("editor.findReplaceShortcut")}>
          <Search className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton onClick={() => setShowHtmlDialog(true)} title={t("editor.viewHtml")}>
          <Code2 className="w-4 h-4" />
        </ToolbarButton>
      </div>

      {/* Panels and Dialogs */}
      <HtmlViewPanel editor={editor} isOpen={showHtmlDialog} onClose={() => setShowHtmlDialog(false)} />
      <FindReplace editor={editor} isOpen={showFindReplace} onClose={() => setShowFindReplace(false)} />
      <ImageInsertDialog editor={editor} isOpen={showImageDialog} onClose={() => setShowImageDialog(false)} />
      <FootnoteDialog editor={editor} isOpen={showFootnoteDialog} onClose={() => setShowFootnoteDialog(false)} />
      <LinkDialog editor={editor} isOpen={showLinkDialog} onClose={() => setShowLinkDialog(false)} />
    </div>
  );
}
