import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, Underline as UnderlineIcon, Heading2, List, Settings2 } from "lucide-react";

interface QuickNoteEditorProps {
  onChange: (html: string) => void;
  placeholder?: string;
}

export function QuickNoteEditor({ onChange, placeholder }: QuickNoteEditorProps) {
  const { t } = useTranslation();
  const [showToolbar, setShowToolbar] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ underline: false }),
      Underline,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: "",
    editorProps: {
      attributes: { class: "editor-content outline-none min-h-20" },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  const toolbarButton = (
    label: string,
    Icon: typeof Bold,
    isActive: boolean,
    action: () => void,
  ) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={isActive}
      onClick={action}
      className={`rounded p-1 transition-colors hover:bg-muted ${
        isActive ? "bg-muted text-primary" : "text-muted-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-1 px-1 pb-1">
        {showToolbar && editor ? (
          <div className="flex items-center gap-0.5">
            {toolbarButton(t("editor.bold"), Bold, editor.isActive("bold"), () =>
              editor.chain().focus().toggleBold().run(),
            )}
            {toolbarButton(t("editor.italic"), Italic, editor.isActive("italic"), () =>
              editor.chain().focus().toggleItalic().run(),
            )}
            {toolbarButton(
              t("editor.underline"),
              UnderlineIcon,
              editor.isActive("underline"),
              () => editor.chain().focus().toggleUnderline().run(),
            )}
            {toolbarButton(
              t("editor.heading2"),
              Heading2,
              editor.isActive("heading", { level: 2 }),
              () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
            )}
            {toolbarButton(
              t("editor.bulletList"),
              List,
              editor.isActive("bulletList"),
              () => editor.chain().focus().toggleBulletList().run(),
            )}
          </div>
        ) : (
          <span />
        )}
        <button
          type="button"
          aria-label={t("bookNotes.formatting")}
          title={t("bookNotes.formatting")}
          aria-pressed={showToolbar}
          onClick={() => setShowToolbar((value) => !value)}
          className={`rounded p-1 transition-colors hover:bg-muted ${
            showToolbar ? "bg-muted text-primary" : "text-muted-foreground"
          }`}
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto px-2">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
