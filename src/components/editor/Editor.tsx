import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { useEffect, useCallback } from "react";
import { EditorToolbar } from "./EditorToolbar";
import { SceneBreak } from "./extensions/SceneBreak";

interface EditorProps {
  content: string | null;
  onUpdate: (content: string) => void;
  onWordCountChange?: (count: number) => void;
  placeholder?: string;
  editable?: boolean;
  focusMode?: boolean;
}

export function Editor({
  content,
  onUpdate,
  onWordCountChange,
  placeholder = "Start writing your chapter...",
  editable = true,
  focusMode = false,
}: EditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
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
      Highlight.configure({
        multicolor: false,
      }),
      Typography,
      // Phase 3 extensions
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: "editor-table",
        },
      }),
      TableRow,
      TableCell,
      TableHeader,
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: "editor-image",
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "editor-link",
        },
      }),
      SceneBreak,
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
      onUpdate(html);

      if (onWordCountChange) {
        const words = editor.storage.characterCount.words();
        onWordCountChange(words);
      }
    },
  });

  // Update content when it changes externally (e.g., switching chapters)
  useEffect(() => {
    if (editor && content !== null && editor.getHTML() !== content) {
      editor.commands.setContent(content);
    }
  }, [editor, content]);

  // Update word count on initial load
  useEffect(() => {
    if (editor && onWordCountChange) {
      const words = editor.storage.characterCount.words();
      onWordCountChange(words);
    }
  }, [editor, onWordCountChange]);

  const handleFocus = useCallback(() => {
    editor?.chain().focus().run();
  }, [editor]);

  if (!editor) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading editor...</div>
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col min-h-0 ${focusMode ? "focus-mode" : ""}`}>
      {!focusMode && <EditorToolbar editor={editor} />}

      <div className="flex-1 overflow-auto min-h-0" onClick={handleFocus}>
        <div className="max-w-editor-max mx-auto p-8">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
