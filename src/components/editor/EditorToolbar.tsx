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
import { Select, Combobox } from "../ui";
import { useTranslation } from "react-i18next";

interface EditorToolbarProps {
  editor: Editor;
}

type FontFamilyValue = "Literata, serif" | "Inter, sans-serif" | "monospace";

const FONT_SIZE_OPTIONS = ["12", "14", "16", "18", "20", "24", "28", "32", "36", "48", "72"];

const FONT_OPTIONS: { value: FontFamilyValue; label: string }[] = [
  { value: "Literata, serif", label: "Serif" },
  { value: "Inter, sans-serif", label: "Sans" },
  { value: "monospace", label: "Mono" },
];

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}

function ToolbarButton({ onClick, isActive, disabled, title, children }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-2 rounded transition-colors ${isActive
        ? "bg-primary text-white"
        : "hover:bg-muted"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-6 bg-border mx-1" />;
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const { t } = useTranslation();
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [showFootnoteDialog, setShowFootnoteDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showHtmlDialog, setShowHtmlDialog] = useState(false);
  const [fontFamily, setFontFamily] = useState<FontFamilyValue>("Literata, serif");

  // Subscribe to editor state changes for proper toolbar updates
  const editorState = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      // Get the current font size from marks
      const attrs = e.getAttributes("textStyle");
      const currentFontSize = attrs.fontSize
        ? attrs.fontSize.replace("px", "")
        : "18"; // default size
      const currentColor = attrs.color || "";

      // Get highlight color from the highlight mark
      const highlightAttrs = e.getAttributes("highlight");
      const currentHighlightColor = highlightAttrs.color || "";

      return {
        fontSize: currentFontSize,
        color: currentColor,
        highlightColor: currentHighlightColor,
        isBold: e.isActive("bold"),
        isItalic: e.isActive("italic"),
        isUnderline: e.isActive("underline"),
        isStrike: e.isActive("strike"),
        isHighlight: e.isActive("highlight"),
        isSubscript: e.isActive("subscript"),
        isSuperscript: e.isActive("superscript"),
        isLink: e.isActive("link"),
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

  const handleFontSizeChange = (size: string) => {
    const sizeValue = size.replace(/[^0-9]/g, "");
    if (sizeValue) {
      editor.chain().focus().setFontSize(`${sizeValue}px`).run();
    }
  };

  const handleFontFamilyChange = (family: FontFamilyValue) => {
    setFontFamily(family);
    editor.chain().focus().setFontFamily(family).run();
  };

  return (
    <div className="border-b border-border bg-background sticky top-0 z-10">
      <div className="flex flex-wrap items-center px-4 py-2 gap-1 overflow-x-auto">
        {/* Font controls */}
        <Combobox
          value={editorState.fontSize}
          onChange={handleFontSizeChange}
          options={FONT_SIZE_OPTIONS}
          placeholder={t("editor.size")}
        />
        <Select<FontFamilyValue>
          value={fontFamily}
          onChange={handleFontFamilyChange}
          options={FONT_OPTIONS}
        />

        <Divider />

        {/* Text formatting */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editorState.isBold}
          title={t("editor.bold")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editorState.isItalic}
          title={t("editor.italic")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 4h4M14 20h-4M15 4L9 20" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editorState.isUnderline}
          title={t("editor.underline")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v7a5 5 0 0010 0V4M5 20h14" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editorState.isStrike}
          title={t("editor.strikethrough")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 4H9a3 3 0 00-3 3v1a3 3 0 003 3h6a3 3 0 013 3v1a3 3 0 01-3 3H8M4 12h16" />
          </svg>
        </ToolbarButton>


        <ColorPicker
          value={editorState.highlightColor}
          onChange={(color) => editor.chain().focus().setHighlight({ color }).run()}
          onClear={() => editor.chain().focus().unsetHighlight().run()}
          onToggle={() => editor.chain().focus().toggleHighlight({ color: editorState.highlightColor || "#FFFF00" }).run()}
          isActive={editorState.isHighlight}
          title={t("editor.highlight")}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          }
        />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleSubscript().run()}
          isActive={editorState.isSubscript}
          title={t("editor.subscript")}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path fill-rule="evenodd" clip-rule="evenodd" d="M4.7433 5.33104C4.37384 4.92053 3.74155 4.88726 3.33104 5.25671C2.92053 5.62617 2.88726 6.25846 3.25671 6.66897L7.15465 11L3.25671 15.331C2.88726 15.7416 2.92053 16.3738 3.33104 16.7433C3.74155 17.1128 4.37384 17.0795 4.7433 16.669L8.50001 12.4949L12.2567 16.669C12.6262 17.0795 13.2585 17.1128 13.669 16.7433C14.0795 16.3738 14.1128 15.7416 13.7433 15.331L9.84537 11L13.7433 6.66897C14.1128 6.25846 14.0795 5.62617 13.669 5.25671C13.2585 4.88726 12.6262 4.92053 12.2567 5.33104L8.50001 9.50516L4.7433 5.33104ZM17.3181 14.0484C17.6174 13.7595 18.1021 13.7977 18.3524 14.13C18.5536 14.3971 18.5353 14.7698 18.3088 15.0158L15.2643 18.3227C14.9955 18.6147 14.9248 19.0382 15.0842 19.4017C15.2437 19.7652 15.6031 20 16 20H20C20.5523 20 21 19.5523 21 19C21 18.4477 20.5523 18 20 18H18.2799L19.7802 16.3704C20.6607 15.414 20.7321 13.965 19.95 12.9267C18.9769 11.6348 17.0925 11.4862 15.929 12.6096L15.3054 13.2116C14.9081 13.5953 14.897 14.2283 15.2806 14.6256C15.6642 15.023 16.2973 15.0341 16.6946 14.6505L17.3181 14.0484Z" fill="currentColor"></path> </g>
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
          isActive={editorState.isSuperscript}
          title={t("editor.superscript")}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path fill-rule="evenodd" clip-rule="evenodd" d="M17.3181 6.04842C17.6174 5.75945 18.1021 5.79767 18.3524 6.12997C18.5536 6.39707 18.5353 6.76978 18.3088 7.01579L15.2643 10.3227C14.9955 10.6147 14.9248 11.0382 15.0842 11.4017C15.2437 11.7652 15.6031 12 16 12H20C20.5523 12 21 11.5523 21 11C21 10.4477 20.5523 10 20 10H18.2799L19.7802 8.37041C20.6607 7.41399 20.7321 5.96504 19.95 4.92665C18.9769 3.63478 17.0925 3.48621 15.929 4.60962L15.3054 5.21165C14.9081 5.59526 14.897 6.22833 15.2806 6.62564C15.6642 7.02296 16.2973 7.03406 16.6946 6.65045L17.3181 6.04842ZM4.7433 8.33104C4.37384 7.92053 3.74155 7.88725 3.33104 8.25671C2.92053 8.62616 2.88726 9.25845 3.25671 9.66896L7.15465 14L3.25671 18.331C2.88726 18.7415 2.92053 19.3738 3.33104 19.7433C3.74155 20.1128 4.37384 20.0795 4.7433 19.669L8.50001 15.4948L12.2567 19.669C12.6262 20.0795 13.2585 20.1128 13.669 19.7433C14.0795 19.3738 14.1128 18.7415 13.7433 18.331L9.84537 14L13.7433 9.66896C14.1128 9.25845 14.0795 8.62616 13.669 8.25671C13.2585 7.88725 12.6262 7.92053 12.2567 8.33104L8.50001 12.5052L4.7433 8.33104Z" fill="currentColor"></path> </g>
          </svg>
        </ToolbarButton>

        <ColorPicker
          value={editorState.color}
          onChange={(color) => editor.chain().focus().setColor(color).run()}
          onClear={() => editor.chain().focus().unsetColor().run()}
          onToggle={() => {
            if (editorState.color) {
              editor.chain().focus().unsetColor().run();
            } else {
              editor.chain().focus().setColor("#000000").run();
            }
          }}
          isActive={!!editorState.color}
          title={t("editor.textColor")}
          icon={
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 1920 1920">
              <g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M1846.308 1476.923V1920H74v-443.077h1772.308Zm-147.693 147.692H221.692v147.693h1476.923v-147.693ZM1109.751.06l509.391 1227.028-136.468 56.566-164.972-397.588H602.576l-164.972 397.588-136.468-56.566L810.526.059h299.225Zm-98.658 147.692h-101.76L663.868 738.373h592.542L1011.093 147.75Z" fillRule="evenodd"></path> </g>
            </svg>
          }
        />

        <ToolbarButton
          onClick={() => setShowLinkDialog(true)}
          isActive={editorState.isLink}
          title={t("editor.insertLinkShortcut")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </ToolbarButton>

        <Divider />

        {/* Headings */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          isActive={editorState.isH1}
          title={t("editor.heading1")}
        >
          <span className="text-sm font-bold">H1</span>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editorState.isH2}
          title={t("editor.heading2")}
        >
          <span className="text-sm font-bold">H2</span>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          isActive={editorState.isH3}
          title={t("editor.heading3")}
        >
          <span className="text-sm font-bold">H3</span>
        </ToolbarButton>

        <Divider />

        {/* Lists */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editorState.isBulletList}
          title={t("editor.bulletList")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h.01M8 6h12M4 12h.01M8 12h12M4 18h.01M8 18h12" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editorState.isOrderedList}
          title={t("editor.numberedList")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h.01M8 6h12M4 12h.01M8 12h12M4 18h.01M8 18h12" />
            <text x="2" y="8" fontSize="6" fill="currentColor">1</text>
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editorState.isBlockquote}
          title={t("editor.quote")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </ToolbarButton>

        <Divider />

        {/* Block/Paragraph indent - in lists: sink/lift, otherwise: margin-left */}
        <ToolbarButton
          onClick={() => {
            if (editorState.canSinkListItem) {
              editor.chain().focus().sinkListItem("listItem").run();
            } else {
              editor.chain().focus().increaseIndent().run();
            }
          }}
          title={t("editor.increaseIndent")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18M3 8h18M9 12h12M9 16h12M9 20h12M3 12l3 2-3 2" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => {
            if (editorState.canLiftListItem) {
              editor.chain().focus().liftListItem("listItem").run();
            } else {
              editor.chain().focus().decreaseIndent().run();
            }
          }}
          title={t("editor.decreaseIndent")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18M3 8h18M9 12h12M9 16h12M9 20h12M6 12l-3 2 3 2" />
          </svg>
        </ToolbarButton>

        {/* First-line indent (text-indent) */}
        <ToolbarButton
          onClick={() => editor.chain().focus().increaseFirstLineIndent().run()}
          title={t("editor.increaseFirstLineIndent")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6h18M9 10h12M3 14h18M3 18h18" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l3 2-3 2" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().decreaseFirstLineIndent().run()}
          title={t("editor.decreaseFirstLineIndent")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6h18M9 10h12M3 14h18M3 18h18" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 8l-3 2 3 2" />
          </svg>
        </ToolbarButton>

        <Divider />

        {/* Text alignment */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          isActive={editorState.isAlignLeft}
          title={t("editor.alignLeft")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h14" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          isActive={editorState.isAlignCenter}
          title={t("editor.alignCenter")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M7 12h10M5 18h14" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          isActive={editorState.isAlignRight}
          title={t("editor.alignRight")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M10 12h10M6 18h14" />
          </svg>
        </ToolbarButton>

        <Divider />

        {/* Formatting utilities */}
        <ToolbarButton
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
          title={t("editor.removeFormatting")}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path d="m5.03 2.49.19-1.25h3.06L7.7 5.16l1.09 1.09.75-5.01h3.07l-.18 1.15 1.23.19.39-2.58h-9.9l-.21 1.4 1.09 1.09zm3.53 5.29-1.09-1.1-4.64-4.63-.88.87 5.29 5.29-.97 6.45H4.05v1.25h2.66l.62.09.01-.09h2.23v-1.25H7.53l.8-5.36 4.56 4.56.88-.88-5.21-5.2z"></path></g>
          </svg>
        </ToolbarButton>

        <Divider />

        {/* Phase 3: Advanced features */}
        <TableMenu editor={editor} />

        <ToolbarButton
          onClick={() => setShowImageDialog(true)}
          title={t("editor.insertImage")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => (editor.commands as any).setSceneBreak?.()}
          title={t("editor.sceneBreak")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="6" cy="12" r="1.5" fill="currentColor" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            <circle cx="18" cy="12" r="1.5" fill="currentColor" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => setShowFootnoteDialog(true)}
          title={t("editor.footnote")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
        </ToolbarButton>

        <Divider />

        {/* Misc */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title={t("editor.horizontalRule")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editorState.canUndo}
          title={t("editor.undo")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a4 4 0 014 4v2M3 10l4-4M3 10l4 4" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editorState.canRedo}
          title={t("editor.redo")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a4 4 0 00-4 4v2M21 10l-4-4M21 10l-4 4" />
          </svg>
        </ToolbarButton>

        <Divider />

        {/* New Phase 4: Extended features */}
        <ToolbarButton
          onClick={() => setShowFindReplace(!showFindReplace)}
          isActive={showFindReplace}
          title={t("editor.findReplaceShortcut")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => setShowHtmlDialog(true)}
          title={t("editor.viewHtml")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        </ToolbarButton>
      </div>

      {/* Inline panels */}
      <HtmlViewPanel
        editor={editor}
        isOpen={showHtmlDialog}
        onClose={() => setShowHtmlDialog(false)}
      />

      {/* Dialogs - outside scrollable area */}
      <FindReplace
        editor={editor}
        isOpen={showFindReplace}
        onClose={() => setShowFindReplace(false)}
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
      />
    </div>
  );
}
