import type { Editor } from "@tiptap/react";
import type { EditorState } from "@tiptap/pm/state";
import {
  DEFAULT_LINE_HEIGHT,
  normalizeLineHeight,
} from "@/components/editor/extensions/LineHeight";

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

// CSS line-height inherits, so the effective value is the closest ancestor
// block (paragraph, heading, list item) that carries one. A legacy inline span
// can only make a line taller, so it wins only when it is larger.
function effectiveLineHeight(editor: Editor): string {
  const { selection, doc } = editor.state;
  let $from = selection.$from;
  // Select all (and node selections) start above any textblock, so read the
  // first textblock the selection covers instead.
  if ($from && !$from.parent.isTextblock) {
    let firstTextblock: number | null = null;
    doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (firstTextblock !== null) return false;
      if (node.isTextblock) {
        firstTextblock = pos + 1;
        return false;
      }
      return true;
    });
    if (firstTextblock !== null) $from = doc.resolve(firstTextblock);
  }
  let blockValue: string | null = null;
  if ($from) {
    for (let depth = $from.depth; depth >= 0; depth -= 1) {
      const node = $from.node(depth);
      const isBlock =
        node.isTextblock || node.type.name === "listItem" || node.type.name === "taskItem";
      if (isBlock && node.attrs.lineHeight != null) {
        blockValue = String(node.attrs.lineHeight);
        break;
      }
    }
  }
  const fallback = blockValue ?? DEFAULT_LINE_HEIGHT;
  const legacy = normalizeLineHeight(editor.getAttributes("textStyle").lineHeight);
  if (legacy !== null && Number(legacy) > Number(fallback)) {
    return legacy;
  }
  return fallback;
}

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
    lineHeight: effectiveLineHeight(editor),
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
