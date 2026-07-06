import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { MarkdownPasteDialog } from "@/components/editor/MarkdownPasteDialog";
import { useSettingsStore } from "@/features/settings/store";
import { Tooltip } from "@/components/ui";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  Settings2,
} from "lucide-react";

interface QuickNoteEditorProps {
  onChange: (html: string) => void;
  placeholder?: string;
}

export function QuickNoteEditor({ onChange, placeholder }: QuickNoteEditorProps) {
  const { t } = useTranslation();
  const [showToolbar, setShowToolbar] = useState(false);
  const [pendingMarkdownPaste, setPendingMarkdownPaste] = useState<string | null>(null);
  const spellCheckEnabled = useSettingsStore((state) => state.spellCheckEnabled);
  const language = useSettingsStore((state) => state.language);

  const editor = useEditor({
    extensions: [
      ...createRichTextExtensions({
        onMarkdownPaste: setPendingMarkdownPaste,
        spellCheck: { enabled: spellCheckEnabled, language },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
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
    action: () => void
  ) => (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={isActive}
        onClick={action}
        className={`rounded p-1 transition-colors hover:bg-muted ${
          isActive ? "bg-muted text-primary" : "text-muted-foreground"
        }`}
      >
        <Icon className="h-4 w-4" />
      </button>
    </Tooltip>
  );

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-1 px-1 pb-1">
        {showToolbar && editor ? (
          <div className="flex items-center gap-0.5">
            {toolbarButton(t("editor.bold"), Bold, editor.isActive("bold"), () =>
              editor.chain().focus().toggleBold().run()
            )}
            {toolbarButton(t("editor.italic"), Italic, editor.isActive("italic"), () =>
              editor.chain().focus().toggleItalic().run()
            )}
            {toolbarButton(t("editor.underline"), UnderlineIcon, editor.isActive("underline"), () =>
              editor.chain().focus().toggleUnderline().run()
            )}
            {toolbarButton(
              t("editor.heading1"),
              Heading1,
              editor.isActive("heading", { level: 1 }),
              () => editor.chain().focus().toggleHeading({ level: 1 }).run()
            )}
            {toolbarButton(
              t("editor.heading2"),
              Heading2,
              editor.isActive("heading", { level: 2 }),
              () => editor.chain().focus().toggleHeading({ level: 2 }).run()
            )}
            {toolbarButton(
              t("editor.heading3"),
              Heading3,
              editor.isActive("heading", { level: 3 }),
              () => editor.chain().focus().toggleHeading({ level: 3 }).run()
            )}
            {toolbarButton(t("editor.bulletList"), List, editor.isActive("bulletList"), () =>
              editor.chain().focus().toggleBulletList().run()
            )}
            {toolbarButton(t("editor.taskList"), ListChecks, editor.isActive("taskList"), () =>
              editor.chain().focus().toggleTaskList().run()
            )}
          </div>
        ) : (
          <span />
        )}
        <Tooltip content={t("bookNotes.formatting")}>
          <button
            type="button"
            aria-label={t("bookNotes.formatting")}
            aria-pressed={showToolbar}
            onClick={() => setShowToolbar((value) => !value)}
            className={`rounded p-1 transition-colors hover:bg-muted ${
              showToolbar ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>
      <div className="max-h-64 overflow-y-auto px-2">
        <EditorContent editor={editor} />
      </div>
      {editor && (
        <MarkdownPasteDialog
          editor={editor}
          markdown={pendingMarkdownPaste}
          onClose={() => setPendingMarkdownPaste(null)}
        />
      )}
    </div>
  );
}
