import type { EditorState } from "@tiptap/pm/state";

/** True when the selection head sits inside a code block (or any node whose
 * schema marks its content as `code`), where pasted text is literal. */
function isInCodeBlock(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth--) {
    if ($from.node(depth).type.spec.code) return true;
  }
  return false;
}

/**
 * Whether the "Markdown detected" conversion prompt should be offered for the
 * current paste. The prompt is suppressed inside code blocks (code must paste
 * literally) and on paste-without-formatting (Ctrl/Cmd+Shift+V), where the user
 * explicitly asked for raw text.
 */
export function shouldPromptMarkdownPaste(
  state: EditorState,
  options: { plainPaste: boolean }
): boolean {
  if (options.plainPaste) return false;
  return !isInCodeBlock(state);
}
