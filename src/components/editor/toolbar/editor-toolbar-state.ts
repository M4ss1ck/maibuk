import type { Editor } from "@tiptap/react";
import type { EditorState } from "@tiptap/pm/state";

export interface EditorToolbarState {
  fontSize: string;
  lineHeight: string;
  fontFamily: string;
  color: string;
  highlightColor: string;
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  isStrike: boolean;
  isHighlight: boolean;
  isSubscript: boolean;
  isSuperscript: boolean;
  isLink: boolean;
  isCode: boolean;
  isCodeBlock: boolean;
  isH1: boolean;
  isH2: boolean;
  isH3: boolean;
  isBulletList: boolean;
  isOrderedList: boolean;
  isTaskList: boolean;
  isBlockquote: boolean;
  isAlignLeft: boolean;
  isAlignCenter: boolean;
  isAlignRight: boolean;
  isAlignJustify: boolean;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canSinkListItem: boolean;
  canLiftListItem: boolean;
}

const DEFAULT_FONT_SIZE = "18";

// Visible, floating, and width-measurement groups share one calculation. Keep
// only the latest immutable ProseMirror state, without retaining edit history.
const snapshotCache = new WeakMap<Editor, { state: EditorState; snapshot: EditorToolbarState }>();

export function getEditorToolbarState(editor: Editor): EditorToolbarState {
  const cached = snapshotCache.get(editor);
  if (cached && cached.state === editor.state) {
    return cached.snapshot;
  }
  const attrs = editor.getAttributes("textStyle");
  const highlightAttrs = editor.getAttributes("highlight");
  const can = editor.can();
  const snapshot: EditorToolbarState = {
    fontSize: attrs.fontSize ? attrs.fontSize.replace("px", "") : DEFAULT_FONT_SIZE,
    lineHeight: attrs.lineHeight || "1.5",
    fontFamily: attrs.fontFamily || "Literata, serif",
    color: attrs.color || "",
    highlightColor: highlightAttrs.color || "",
    isBold: editor.isActive("bold"),
    isItalic: editor.isActive("italic"),
    isUnderline: editor.isActive("underline"),
    isStrike: editor.isActive("strike"),
    isHighlight: editor.isActive("highlight"),
    isSubscript: editor.isActive("subscript"),
    isSuperscript: editor.isActive("superscript"),
    isLink: editor.isActive("link"),
    isCode: editor.isActive("code"),
    isCodeBlock: editor.isActive("codeBlock"),
    isH1: editor.isActive("heading", { level: 1 }),
    isH2: editor.isActive("heading", { level: 2 }),
    isH3: editor.isActive("heading", { level: 3 }),
    isBulletList: editor.isActive("bulletList"),
    isOrderedList: editor.isActive("orderedList"),
    isTaskList: editor.isActive("taskList"),
    isBlockquote: editor.isActive("blockquote"),
    isAlignLeft: editor.isActive({ textAlign: "left" }),
    isAlignCenter: editor.isActive({ textAlign: "center" }),
    isAlignRight: editor.isActive({ textAlign: "right" }),
    isAlignJustify: editor.isActive({ textAlign: "justify" }),
    hasSelection: !editor.state.selection.empty,
    canUndo: can.undo(),
    canRedo: can.redo(),
    canSinkListItem: can.sinkListItem("listItem"),
    canLiftListItem: can.liftListItem("listItem"),
  };
  snapshotCache.set(editor, { state: editor.state, snapshot });
  return snapshot;
}
