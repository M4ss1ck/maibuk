import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { common, createLowlight } from "lowlight";
import { CodeBlockView } from "../CodeBlockView";

/**
 * Shared lowlight (highlight.js) registry. `common` covers the ~35 most
 * popular languages — including their aliases, so the ```sh fenced shortcut
 * resolves to the shell grammar.
 */
const baseLowlight = createLowlight(common);

export const lowlight: typeof baseLowlight = {
  ...baseLowlight,
  highlightAuto(value) {
    return { type: "root", children: [{ type: "text", value }] };
  },
};

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
