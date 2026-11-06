import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TaskListOrder } from "@/components/editor/extensions/TaskListOrder";
import { TaskListMenus } from "@/components/editor/TaskListMenus";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { SearchReplace } from "@/components/editor/extensions/SearchReplace";
import { useEditorCommandSource } from "@/components/editor/editor-command-source";
import { useEditorSurface } from "@/components/editor/EditorSurface";
import {
  useOpeningMarksLanguage,
  useWritingLanguageGetter,
} from "@/components/editor/opening-marks-language";
import { MarkdownPasteDialog } from "@/components/editor/MarkdownPasteDialog";
import { editorKeymapShortcutIds } from "@/components/editor/keymap-shortcuts";
import { useBoundShortcutIds } from "@/lib/bound-shortcuts";
import { resolveWritingLanguage } from "@/lib/writing-language";
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
  /**
   * Called when Escape is pressed in the editor. The contenteditable keeps Tab
   * for indentation, so this is the keyboard path out of it to the controls
   * that follow (the Add note button).
   */
  onEscape?: () => void;
  /** The language of the Book the Note is for; the app language when absent. */
  bookLanguage?: string;
}

export function QuickNoteEditor({
  onChange,
  placeholder,
  onEscape,
  bookLanguage,
}: QuickNoteEditorProps) {
  const { t } = useTranslation();
  const [showToolbar, setShowToolbar] = useState(false);
  const [pendingMarkdownPaste, setPendingMarkdownPaste] = useState<string | null>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  // The editor's keymap is created once, so the Find bar's state reaches it
  // through refs.
  const isFindReplaceOpenRef = useRef(false);
  const closeFindReplaceRef = useRef<() => void>(() => {});
  const spellCheckEnabled = useSettingsStore((state) => state.spellCheckEnabled);
  const language = useSettingsStore((state) => state.language);
  const editorAutoClose = useSettingsStore((state) => state.editorAutoClose);
  const writingLanguage = resolveWritingLanguage({ book: bookLanguage, app: language });
  const openingMarksLanguage = useOpeningMarksLanguage(writingLanguage);
  const writingLanguageGetter = useWritingLanguageGetter(writingLanguage);

  const editor = useEditor({
    extensions: [
      ...createRichTextExtensions({
        onMarkdownPaste: setPendingMarkdownPaste,
        spellCheck: { enabled: spellCheckEnabled, language: writingLanguage },
        autoClose: editorAutoClose,
        openingMarksLanguage,
        writingLanguage: writingLanguageGetter,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TaskListOrder,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      // The shared Find bar searches this Note's document and marks the matches.
      SearchReplace,
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "editor-content outline-none min-h-20",
        // A bare contenteditable has no role or name for assistive tech.
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": t("bookNotes.quickNoteLabel"),
        lang: writingLanguage,
      },
      handleKeyDown: (_view, event) => {
        if (event.key !== "Escape") return false;
        // The Find bar owns the first Escape: close it and keep writing.
        if (isFindReplaceOpenRef.current) {
          event.stopPropagation();
          closeFindReplaceRef.current();
          return true;
        }
        const handler = onEscapeRef.current;
        if (!handler) return false;
        // Escape is the editor's own key: stop it here so an enclosing panel
        // does not also treat it as a dismissal.
        event.stopPropagation();
        handler();
        return true;
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });
  const keymapShortcutIds = useMemo(
    () => (editor ? editorKeymapShortcutIds(editor) : []),
    [editor]
  );
  useBoundShortcutIds(keymapShortcutIds);
  useEditorCommandSource(editor);

  const { surface, isFindReplaceOpen, closeFindReplace } = useEditorSurface(editor, {
    spellCheckLanguage: writingLanguage,
  });
  isFindReplaceOpenRef.current = isFindReplaceOpen;
  closeFindReplaceRef.current = closeFindReplace;

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
      {/* The Find bar docks at the top of this wrapper, outside the scrolling
          area, so it stays visible while the Note scrolls. */}
      <div className="relative">
        <div className="max-h-64 overflow-y-auto px-2">
          <EditorContent editor={editor} />
          <TaskListMenus editor={editor} />
        </div>
        {surface}
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
