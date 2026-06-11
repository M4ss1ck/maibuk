import CodeBlock from "@tiptap/extension-code-block";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CodeBlockView } from "../CodeBlockView";

/**
 * Code block with a copy-to-clipboard button that appears on hover/focus.
 * Replaces StarterKit's built-in code block (which is disabled where this is
 * registered) while keeping the same `codeBlock` node name and schema.
 */
export const CodeBlockWithCopy = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
