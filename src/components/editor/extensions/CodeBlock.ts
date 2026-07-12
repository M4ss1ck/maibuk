import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CodeBlockView } from "@/components/editor/CodeBlockView";
import { lowlight } from "@/lib/lowlight";

export { lowlight };

/**
 * Code block with syntax highlighting and a copy-to-clipboard button that
 * appears on hover/focus. Replaces StarterKit's built-in code block (which is
 * disabled where this is registered) while keeping the same `codeBlock` node
 * name and schema.
 */
export const CodeBlockWithCopy = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({ lowlight });
