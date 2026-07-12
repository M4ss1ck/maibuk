import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEditorState, type Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  BookOpen,
  ChevronDown,
  Code,
  Code2,
  FileDown,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image,
  ImageDown,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareText,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  Search,
  SpellCheck,
  SquareCode,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Undo2,
  WrapText,
} from "lucide-react";
import { ColorPicker } from "@/components/editor/ColorPicker";
import { FontFamilySelect } from "@/components/editor/FontFamilySelect";
import { FontSizeSelect } from "@/components/editor/FontSizeSelect";
import { LineHeightSelect } from "@/components/editor/LineHeightSelect";
import { SceneBreakMenu } from "@/components/editor/SceneBreakMenu";
import { TableMenu } from "@/components/editor/TableMenu";
import { TextCaseMenu } from "@/components/editor/TextCaseMenu";
import { ToolbarButton } from "@/components/editor/ToolbarButton";
import { Tooltip } from "@/components/ui";
import { useSettingsStore } from "@/features/settings/store";
import {
  LANGUAGE_OPTIONS,
  type Language,
} from "@/features/settings/types";
import type { ToolbarGroupId } from "@/features/settings/toolbar-config";

const HEADING_SIZES: Record<1 | 2 | 3, string> = {
  1: "36",
  2: "27",
  3: "22",
};
const DEFAULT_FONT_SIZE = "18";

export interface ToolbarGroupCallbacks {
  bookId?: string | null;
  spellCheckLanguage: Language;
  onSpellCheckLanguageChange: (language: Language) => void;
  openFindReplace: () => void;
  isFindReplaceOpen: boolean;
  onToggleFindReplace: () => void;
  openImageDialog: () => void;
  openFootnote: () => void;
  openLinkDialog: () => void;
  openDictionary: () => void;
  openHtmlPanel: () => void;
  onExportMarkdown?: () => void;
  onExportPdf?: () => void;
  onExportImage?: () => void;
}

interface ToolbarGroupBoundaryProps {
  children: ReactNode;
  wrapItems?: boolean;
  "data-group-id"?: string;
}

export function ToolbarGroupBoundary({
  children,
  wrapItems = false,
  ...rest
}: ToolbarGroupBoundaryProps) {
  return (
    <span
      className={
        wrapItems
          ? "contents"
          : "inline-flex flex-shrink-0 items-center gap-0.5 sm:gap-1"
      }
      {...rest}
    >
      {children}
    </span>
  );
}

interface EditorToolbarGroupsProps {
  editor: Editor;
  groupIds: ToolbarGroupId[];
  callbacks: ToolbarGroupCallbacks;
  iconSize?: "sm" | "md";
  wrapItems?: boolean;
}

export function EditorToolbarGroups({
  editor,
  groupIds,
  callbacks,
  iconSize = "md",
  wrapItems = false,
}: EditorToolbarGroupsProps) {
  const { t } = useTranslation();
  const markdownHints = (name: string) =>
    (t as any)(`editor.markdownHints.${name}`, { returnObjects: true }) as string[];
  const spellCheckEnabled = useSettingsStore(
    (state) => state.spellCheckEnabled,
  );
  const setSpellCheckEnabled = useSettingsStore(
    (state) => state.setSpellCheckEnabled,
  );
  const editorState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      const attrs = currentEditor.getAttributes("textStyle");
      const highlightAttrs = currentEditor.getAttributes("highlight");
      return {
        fontSize: attrs.fontSize
          ? attrs.fontSize.replace("px", "")
          : DEFAULT_FONT_SIZE,
        lineHeight: attrs.lineHeight || "1.5",
        fontFamily: attrs.fontFamily || "Literata, serif",
        color: attrs.color || "",
        highlightColor: highlightAttrs.color || "",
        isBold: currentEditor.isActive("bold"),
        isItalic: currentEditor.isActive("italic"),
        isUnderline: currentEditor.isActive("underline"),
        isStrike: currentEditor.isActive("strike"),
        isHighlight: currentEditor.isActive("highlight"),
        isSubscript: currentEditor.isActive("subscript"),
        isSuperscript: currentEditor.isActive("superscript"),
        isLink: currentEditor.isActive("link"),
        isCode: currentEditor.isActive("code"),
        isCodeBlock: currentEditor.isActive("codeBlock"),
        isH1: currentEditor.isActive("heading", { level: 1 }),
        isH2: currentEditor.isActive("heading", { level: 2 }),
        isH3: currentEditor.isActive("heading", { level: 3 }),
        isBulletList: currentEditor.isActive("bulletList"),
        isOrderedList: currentEditor.isActive("orderedList"),
        isTaskList: currentEditor.isActive("taskList"),
        isBlockquote: currentEditor.isActive("blockquote"),
        isAlignLeft: currentEditor.isActive({ textAlign: "left" }),
        isAlignCenter: currentEditor.isActive({ textAlign: "center" }),
        isAlignRight: currentEditor.isActive({ textAlign: "right" }),
        hasSelection: !currentEditor.state.selection.empty,
        canUndo: currentEditor.can().undo(),
        canRedo: currentEditor.can().redo(),
        canSinkListItem: currentEditor.can().sinkListItem("listItem"),
        canLiftListItem: currentEditor.can().liftListItem("listItem"),
      };
    },
  });
  const icon = iconSize === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  const handleHeadingToggle = (level: 1 | 2 | 3) => {
    const isCurrentlyActive =
      (level === 1 && editorState.isH1) ||
      (level === 2 && editorState.isH2) ||
      (level === 3 && editorState.isH3);
    editor
      .chain()
      .focus()
      .toggleHeading({ level })
      .setFontSize(
        `${isCurrentlyActive ? DEFAULT_FONT_SIZE : HEADING_SIZES[level]}px`,
      )
      .setFontFamily(editorState.fontFamily)
      .run();
  };

  const renderGroup = (id: ToolbarGroupId): ReactNode => {
    switch (id) {
      case "history":
        return (
          <>
            <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editorState.canUndo} label={t("editor.undo")} shortcut="editor.undo"><Undo2 className={icon} /></ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editorState.canRedo} label={t("editor.redo")} shortcut="editor.redo"><Redo2 className={icon} /></ToolbarButton>
          </>
        );
      case "font":
        return <><FontSizeSelect editor={editor} value={editorState.fontSize} /><FontFamilySelect editor={editor} value={editorState.fontFamily} /></>;
      case "basic-marks":
        return (
          <>
            <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} isActive={editorState.isBold} label={t("editor.bold")} shortcut="editor.bold" markdownHint={markdownHints("bold")}><Bold className={icon} /></ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} isActive={editorState.isItalic} label={t("editor.italic")} shortcut="editor.italic" markdownHint={markdownHints("italic")}><Italic className={icon} /></ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} isActive={editorState.isUnderline} label={t("editor.underline")} shortcut="editor.underline"><Underline className={icon} /></ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} isActive={editorState.isStrike} label={t("editor.strikethrough")} shortcut="editor.strikethrough" markdownHint={markdownHints("strikethrough")}><Strikethrough className={icon} /></ToolbarButton>
          </>
        );
      case "headings":
        return (
          <>
            <ToolbarButton onClick={() => handleHeadingToggle(1)} isActive={editorState.isH1} label={t("editor.heading1")} shortcut="editor.heading1" markdownHint={markdownHints("heading1")}><Heading1 className={icon} /></ToolbarButton>
            <ToolbarButton onClick={() => handleHeadingToggle(2)} isActive={editorState.isH2} label={t("editor.heading2")} shortcut="editor.heading2" markdownHint={markdownHints("heading2")}><Heading2 className={icon} /></ToolbarButton>
            <ToolbarButton onClick={() => handleHeadingToggle(3)} isActive={editorState.isH3} label={t("editor.heading3")} shortcut="editor.heading3" markdownHint={markdownHints("heading3")}><Heading3 className={icon} /></ToolbarButton>
          </>
        );
      case "find":
        return <ToolbarButton onClick={() => callbacks.isFindReplaceOpen ? callbacks.onToggleFindReplace() : callbacks.openFindReplace()} isActive={callbacks.isFindReplaceOpen} label={t("editor.findReplace")} shortcut="editor.findReplace"><Search className={icon} /></ToolbarButton>;
      case "line-height":
        return <LineHeightSelect editor={editor} value={editorState.lineHeight} />;
      case "highlight":
        return <ColorPicker value={editorState.highlightColor} onChange={(color) => editor.chain().focus().setHighlight({ color }).run()} onClear={() => editor.chain().focus().unsetHighlight().run()} onToggle={() => editor.chain().focus().toggleHighlight({ color: editorState.highlightColor || "#FFFF00" }).run()} isActive={editorState.isHighlight} label={t("editor.highlight")} shortcut="editor.highlight" markdownHint={markdownHints("highlight")} icon={<Highlighter className={icon} />} />;
      case "script":
        return <><ToolbarButton onClick={() => editor.chain().focus().toggleSubscript().run()} isActive={editorState.isSubscript} label={t("editor.subscript")} shortcut="editor.subscript"><Subscript className={icon} /></ToolbarButton><ToolbarButton onClick={() => editor.chain().focus().toggleSuperscript().run()} isActive={editorState.isSuperscript} label={t("editor.superscript")} shortcut="editor.superscript"><Superscript className={icon} /></ToolbarButton></>;
      case "text-color":
        return <ColorPicker value={editorState.color} onChange={(color) => editor.chain().focus().setColor(color).run()} onClear={() => editor.chain().focus().unsetColor().run()} onToggle={() => editorState.color ? editor.chain().focus().unsetColor().run() : editor.chain().focus().setColor("#000000").run()} isActive={!!editorState.color} label={t("editor.textColor")} icon={<Baseline className={icon} />} />;
      case "link-code":
        return <><ToolbarButton onClick={callbacks.openLinkDialog} isActive={editorState.isLink} label={t("editor.insertLink")} shortcut="editor.insertLink"><Link className={icon} /></ToolbarButton><ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} isActive={editorState.isCode} label={t("editor.code")} shortcut="editor.code" markdownHint={markdownHints("code")}><Code className={icon} /></ToolbarButton><ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} isActive={editorState.isCodeBlock} label={t("editor.codeBlock")} shortcut="editor.codeBlock" markdownHint={markdownHints("codeBlock")}><SquareCode className={icon} /></ToolbarButton></>;
      case "lists":
        return <><ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} isActive={editorState.isBulletList} label={t("editor.bulletList")} shortcut="editor.bulletList" markdownHint={markdownHints("bulletList")}><List className={icon} /></ToolbarButton><ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} isActive={editorState.isOrderedList} label={t("editor.numberedList")} shortcut="editor.numberedList" markdownHint={markdownHints("numberedList")}><ListOrdered className={icon} /></ToolbarButton><ToolbarButton onClick={() => (editor.commands as { toggleTaskList: () => unknown }).toggleTaskList()} isActive={editorState.isTaskList} disabled={editor.schema.nodes.taskList === undefined} label={t("editor.taskList")} shortcut="editor.taskList" markdownHint={markdownHints("taskList")}><ListChecks className={icon} /></ToolbarButton></>;
      case "blockquote":
        return <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} isActive={editorState.isBlockquote} label={t("editor.quote")} shortcut="editor.quote" markdownHint={markdownHints("quote")}><Quote className={icon} /></ToolbarButton>;
      case "indent":
        return <><ToolbarButton onClick={() => editorState.canSinkListItem ? editor.chain().focus().sinkListItem("listItem").run() : editor.chain().focus().increaseIndent().run()} label={t("editor.increaseIndent")} shortcut="editor.increaseIndent"><IndentIncrease className={icon} /></ToolbarButton><ToolbarButton onClick={() => editorState.canLiftListItem ? editor.chain().focus().liftListItem("listItem").run() : editor.chain().focus().decreaseIndent().run()} label={t("editor.decreaseIndent")} shortcut="editor.decreaseIndent"><IndentDecrease className={icon} /></ToolbarButton><ToolbarButton onClick={() => editor.chain().focus().increaseFirstLineIndent().run()} label={t("editor.increaseFirstLineIndent")}><WrapText className={icon} /></ToolbarButton><ToolbarButton onClick={() => editor.chain().focus().decreaseFirstLineIndent().run()} label={t("editor.decreaseFirstLineIndent")}><WrapText className={`${icon} scale-x-[-1]`} /></ToolbarButton></>;
      case "align":
        return <><ToolbarButton onClick={() => editor.chain().focus().setTextAlign("left").run()} isActive={editorState.isAlignLeft} label={t("editor.alignLeft")} shortcut="editor.alignLeft"><AlignLeft className={icon} /></ToolbarButton><ToolbarButton onClick={() => editor.chain().focus().setTextAlign("center").run()} isActive={editorState.isAlignCenter} label={t("editor.alignCenter")} shortcut="editor.alignCenter"><AlignCenter className={icon} /></ToolbarButton><ToolbarButton onClick={() => editor.chain().focus().setTextAlign("right").run()} isActive={editorState.isAlignRight} label={t("editor.alignRight")} shortcut="editor.alignRight"><AlignRight className={icon} /></ToolbarButton></>;
      case "clear-formatting":
        return <ToolbarButton onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} label={t("editor.removeFormatting")}><RemoveFormatting className={icon} /></ToolbarButton>;
      case "text-case":
        return <TextCaseMenu editor={editor} />;
      case "table":
        return <TableMenu editor={editor} wrapItems={wrapItems} />;
      case "image":
        return <ToolbarButton onClick={callbacks.openImageDialog} label={t("editor.insertImage")}><Image className={icon} /></ToolbarButton>;
      case "scene-break":
        return <SceneBreakMenu editor={editor} bookId={callbacks.bookId} />;
      case "footnote":
        return <ToolbarButton onClick={callbacks.openFootnote} label={t("editor.footnote")}><MessageSquareText className={icon} /></ToolbarButton>;
      case "horizontal-rule":
        return <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} label={t("editor.horizontalRule")} markdownHint={markdownHints("horizontalRule")}><Minus className={icon} /></ToolbarButton>;
      case "spellcheck":
        return <><ToolbarButton onClick={() => setSpellCheckEnabled(!spellCheckEnabled)} isActive={spellCheckEnabled} label={t("editor.spellCheck")}><SpellCheck className={icon} /></ToolbarButton><SpellCheckLanguageMenu value={callbacks.spellCheckLanguage} onChange={callbacks.onSpellCheckLanguageChange} label={t("editor.spellCheckLanguage")} /></>;
      case "dictionary":
        return <ToolbarButton onClick={callbacks.openDictionary} disabled={!editorState.hasSelection} label={t("editor.dictionary")}><BookOpen className={icon} /></ToolbarButton>;
      case "html-view":
        return <ToolbarButton onClick={callbacks.openHtmlPanel} label={t("editor.viewHtml")}><Code2 className={icon} /></ToolbarButton>;
      case "export":
        return <><ToolbarButton onClick={() => callbacks.onExportMarkdown?.()} disabled={!callbacks.onExportMarkdown} label={t("editor.exportMarkdown")}><FileDown className={icon} /></ToolbarButton><ToolbarButton onClick={() => callbacks.onExportPdf?.()} disabled={!callbacks.onExportPdf} label={t("editor.exportPdf")}><FileText className={icon} /></ToolbarButton><ToolbarButton onClick={() => callbacks.onExportImage?.()} disabled={!callbacks.onExportImage} label={t("editor.exportImage")}><ImageDown className={icon} /></ToolbarButton></>;
    }
  };

  return (
    <>
      {groupIds.map((id) => (
        <ToolbarGroupBoundary
          key={id}
          data-group-id={id}
          wrapItems={wrapItems}
        >
          {renderGroup(id)}
        </ToolbarGroupBoundary>
      ))}
    </>
  );
}

interface SpellCheckLanguageMenuProps {
  value: Language;
  onChange: (language: Language) => void;
  label: string;
}

function SpellCheckLanguageMenu({
  value,
  onChange,
  label,
}: SpellCheckLanguageMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected =
    LANGUAGE_OPTIONS.find((option) => option.value === value) ??
    LANGUAGE_OPTIONS[0];

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
        target instanceof HTMLElement &&
        target.closest(".spellcheck-language-menu-portal");
      if (buttonRef.current?.contains(target) || isMenuTarget) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  return (
    <>
      <Tooltip content={label}>
        <button
          ref={buttonRef}
          type="button"
          onClick={toggle}
          aria-label={label}
          className={`flex h-8 w-7 flex-col items-center justify-center gap-0 rounded text-[10px] font-medium leading-none transition-colors ${
            open ? "bg-primary text-white" : "hover:bg-muted"
          }`}
        >
          <span className="uppercase">{selected.value}</span>
          <ChevronDown className="h-2.5 w-2.5" />
        </button>
      </Tooltip>
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
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted ${
                  option.value === value ? "text-primary" : "text-foreground"
                }`}
              >
                <span>{option.label}</span>
                <span className="text-xs uppercase text-muted-foreground">
                  {option.value}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
