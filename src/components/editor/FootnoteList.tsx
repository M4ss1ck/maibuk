import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";

interface FootnoteItem {
  id: string;
  content: string;
  number: number;
}

interface FootnoteListProps {
  editor: Editor;
  startIndex?: number;
}

export function FootnoteList({ editor, startIndex = 1 }: FootnoteListProps) {
  const footnotes = useEditorState({
    editor,
    selector: ({ editor: e }): FootnoteItem[] => {
      const items: FootnoteItem[] = [];
      let count = 0;
      e.state.doc.descendants((node) => {
        if (node.type.name === "footnote") {
          items.push({
            id: node.attrs.id,
            content: node.attrs.content,
            number: startIndex + count,
          });
          count++;
        }
      });
      return items;
    },
  });

  if (footnotes.length === 0) return null;

  const handleBackClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const element = document.getElementById(`fnref-${id}`);
    element?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="footnote-section">
      <hr className="footnote-divider" />
      <ol className="footnote-list" start={startIndex}>
        {footnotes.map((fn) => (
          <li key={fn.id} id={`fn-content-${fn.id}`} className="footnote-item">
            <span className="footnote-content">{fn.content}</span>
            <a
              className="footnote-backref"
              href={`#fnref-${fn.id}`}
              onClick={(e) => handleBackClick(e, fn.id)}
              title="↩"
            >
              ↩
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
