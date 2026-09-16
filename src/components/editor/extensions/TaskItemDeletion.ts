import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const taskItemDeletionKey = new PluginKey("taskItemDeletion");

// Collapsed cursor at the start of a taskItem's first paragraph: its text
// starts two positions after the taskItem start, which also proves the
// paragraph is the first child.
function isAtStartOfFirstTaskParagraph(view: EditorView): boolean {
  const { selection, schema } = view.state;
  if (!selection.empty) return false;

  const taskItemType = schema.nodes.taskItem;
  if (!taskItemType) return false;

  const $from = selection.$from;
  if ($from.parentOffset !== 0) return false;
  if ($from.parent.type.name !== "paragraph") return false;

  let taskItemDepth: number | null = null;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === taskItemType) {
      taskItemDepth = depth;
      break;
    }
  }
  if (taskItemDepth === null) return false;

  return $from.pos === $from.before(taskItemDepth) + 2;
}

// Android crosses the noneditable checkbox with beforeinput
// (deleteContentBackward) instead of a Backspace keydown, bypassing the
// ListKeymap chain. Forward that boundary case through handleKeyDown, and
// prevent the native default only when the chain handles it.
export const TaskItemDeletion = Extension.create({
  name: "taskItemDeletion",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: taskItemDeletionKey,
        props: {
          handleDOMEvents: {
            beforeinput(view, event) {
              if (!view.editable) return false;
              const inputEvent = event as InputEvent;
              if (inputEvent.inputType !== "deleteContentBackward") return false;
              if (!inputEvent.cancelable) return false;
              if (inputEvent.isComposing || view.composing) return false;
              if (!isAtStartOfFirstTaskParagraph(view)) return false;

              const synthetic = new KeyboardEvent("keydown", {
                key: "Backspace",
                code: "Backspace",
                bubbles: true,
                cancelable: true,
              });
              const handled = view.someProp("handleKeyDown", (handler) => handler(view, synthetic));
              if (handled) {
                event.preventDefault();
                return true;
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
