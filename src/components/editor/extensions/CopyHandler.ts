import { Extension } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Slice } from "@tiptap/pm/model";
import { DOMSerializer } from "@tiptap/pm/model";
import i18n from "../../../i18n";
import { toast } from "../../ui";

const copyHandlerKey = new PluginKey("copyHandler");
const BLOCK_SEPARATOR = "\n\n";

function serializeSlice(state: EditorState, slice: Slice): { html: string; text: string } {
  const serializer = DOMSerializer.fromSchema(state.schema);
  const fragment = serializer.serializeFragment(slice.content);
  const container = document.createElement("div");
  container.appendChild(fragment);

  const text = slice.content.textBetween(0, slice.content.size, BLOCK_SEPARATOR);
  return { html: container.innerHTML, text };
}

export const CopyHandler = Extension.create({
  name: "copyHandler",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: copyHandlerKey,
        props: {
          handleDOMEvents: {
            copy(view, event) {
              const clipboardData = (event as ClipboardEvent).clipboardData;
              if (!clipboardData) return false;

              const { state } = view;
              const { selection } = state;

              if (selection.empty) {
                const $from = selection.$from;
                if ($from.depth < 1) return false;

                const topLevelDepth = 1;
                const start = $from.before(topLevelDepth);
                const end = $from.after(topLevelDepth);
                if (start === end) return false;

                const slice = state.doc.slice(start, end);
                if (slice.content.size === 0) return false;

                const { html, text } = serializeSlice(state, slice);
                clipboardData.clearData();
                clipboardData.setData("text/plain", text);
                clipboardData.setData("text/html", html);
                event.preventDefault();

                toast.success(i18n.t("common.copied"));
                return true;
              }

              toast.success(i18n.t("common.copied"));
              return false;
            },
          },
        },
      }),
    ];
  },
});
