import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
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

  addCommands() {
    const parentCommands = this.parent?.() ?? {};
    const name = this.name;

    return {
      ...parentCommands,
      /**
       * Toggle a code block, but collapse a multi-line selection into a
       * single block. The default command runs `setBlockType` per textblock,
       * which turns N selected lines into N separate code blocks; instead we
       * join the selected blocks' text with newlines into one code block
       * (which is how a multi-line block is stored). Single-block selections
       * and toggling off keep the default behavior.
       */
      toggleCodeBlock:
        (attributes) =>
        ({ editor, state, tr, dispatch, commands }) => {
          if (editor.isActive(name)) {
            return commands.toggleNode(name, "paragraph", attributes);
          }

          const { $from, $to } = state.selection;
          const range = $from.blockRange($to);
          if (!range) return false;

          const lines: string[] = [];
          state.doc.nodesBetween(range.start, range.end, (node) => {
            if (node.isTextblock) {
              lines.push(node.textContent);
              return false;
            }
            return true;
          });

          if (lines.length <= 1) {
            return commands.toggleNode(name, "paragraph", attributes);
          }

          if (dispatch) {
            const codeBlockType = state.schema.nodes[name];
            const text = lines.join("\n");
            const node = text.length
              ? codeBlockType.create(attributes, state.schema.text(text))
              : codeBlockType.create(attributes);

            tr.replaceRangeWith(range.start, range.end, node);
            const caret = Math.min(range.start + node.nodeSize - 1, tr.doc.content.size);
            tr.setSelection(TextSelection.create(tr.doc, caret));
            tr.scrollIntoView();
          }

          return true;
        },
    };
  },
}).configure({ lowlight });
