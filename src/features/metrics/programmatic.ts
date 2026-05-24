import { createDocument, type Editor } from "@tiptap/core";

export function setContentSilently(editor: Editor, content: string): boolean {
  return editor.commands.command(({ tr, dispatch }) => {
    const document = createDocument(content, editor.schema, {}, {
      errorOnInvalidContent: editor.options.enableContentCheck,
    });

    if (dispatch) {
      tr.replaceWith(0, tr.doc.content.size, document)
        .setMeta("metrics:programmatic", true)
        .setMeta("preventUpdate", true);
      dispatch(tr);
    }

    return true;
  });
}
