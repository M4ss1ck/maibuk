import { NodeViewWrapper, useEditorState } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";

export function FootnoteView({ node, editor, getPos }: NodeViewProps) {
  // Reactively recompute the footnote number whenever the document changes
  const number = useEditorState({
    editor,
    selector: ({ editor: e }): number => {
      const startIndex: number =
        (
          e.extensionManager.extensions.find((ext) => ext.name === "footnote")?.options as
            | { startIndex?: number }
            | undefined
        )?.startIndex ?? 1;

      let count = 0;
      const pos = typeof getPos === "function" ? getPos() : undefined;
      if (typeof pos === "number") {
        e.state.doc.nodesBetween(0, pos, (n) => {
          if (n.type.name === "footnote") count++;
        });
      }
      return startIndex + count;
    },
  });

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const element = document.getElementById(`fn-content-${node.attrs.id}`);
    element?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <NodeViewWrapper as="sup" className="footnote-ref">
      <button
        type="button"
        id={`fnref-${node.attrs.id}`}
        className="footnote-ref-link"
        onClick={handleClick}
        title={node.attrs.content}
      >
        {number}
      </button>
    </NodeViewWrapper>
  );
}
