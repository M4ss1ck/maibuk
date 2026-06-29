import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Highlighter,
  Link,
  Code,
  Heading1,
  Heading2,
  Heading3,
} from "lucide-react";
import { ToolbarButton, Divider } from "./ToolbarButton";

export function FormattingButtons({
  editor,
  onLinkClick,
}: {
  editor: Editor;
  onLinkClick: () => void;
}) {
  const { t } = useTranslation();
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      isBold: e.isActive("bold"),
      isItalic: e.isActive("italic"),
      isUnderline: e.isActive("underline"),
      isStrike: e.isActive("strike"),
      isHighlight: e.isActive("highlight"),
      isLink: e.isActive("link"),
      isCode: e.isActive("code"),
      isH1: e.isActive("heading", { level: 1 }),
      isH2: e.isActive("heading", { level: 2 }),
      isH3: e.isActive("heading", { level: 3 }),
    }),
  });

  return (
    <>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={s.isBold}
        title={t("editor.bold")}
      >
        <Bold className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={s.isItalic}
        title={t("editor.italic")}
      >
        <Italic className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={s.isUnderline}
        title={t("editor.underline")}
      >
        <Underline className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={s.isStrike}
        title={t("editor.strikethrough")}
      >
        <Strikethrough className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHighlight({ color: "#FFFF00" }).run()}
        isActive={s.isHighlight}
        title={t("editor.highlight")}
      >
        <Highlighter className="w-3.5 h-3.5" />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={s.isH1}
        title={t("editor.heading1")}
      >
        <Heading1 className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={s.isH2}
        title={t("editor.heading2")}
      >
        <Heading2 className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={s.isH3}
        title={t("editor.heading3")}
      >
        <Heading3 className="w-3.5 h-3.5" />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        onClick={onLinkClick}
        isActive={s.isLink}
        title={t("editor.insertLinkShortcut")}
      >
        <Link className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={s.isCode}
        title={t("editor.code")}
      >
        <Code className="w-3.5 h-3.5" />
      </ToolbarButton>
    </>
  );
}
