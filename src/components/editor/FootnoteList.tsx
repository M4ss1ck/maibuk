import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { collectFootnotes, footnoteKeys } from "@/components/editor/extensions/Footnote";
import { type FootnoteGridItem, FootnoteGrid } from "@/components/editor/FootnoteGrid";

interface FootnoteListProps {
  editor: Editor;
  startIndex?: number;
  /**
   * Read-only lists (a Canvas node, which leaves editing when focus moves out
   * of its text) show the Footnotes without an Item Menu.
   */
  readOnly?: boolean;
}

export function FootnoteList({ editor, startIndex = 1, readOnly = false }: FootnoteListProps) {
  const { t } = useTranslation();
  const footnotes = useEditorState({
    editor,
    selector: ({ editor: e }): FootnoteGridItem[] => {
      const found = collectFootnotes(e.state.doc);
      const keys = footnoteKeys(found.map((footnote) => footnote.id));
      return found.map((footnote, i) => ({
        key: keys[i],
        id: footnote.id,
        index: footnote.index,
        number: startIndex + footnote.index,
        content: footnote.content,
      }));
    },
  });

  if (footnotes.length === 0) return null;

  const goTo = (item: FootnoteGridItem) => {
    document.getElementById(`fnref-${item.id}`)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section
      className="footnote-section"
      data-footnote-list=""
      aria-label={t("bookSidePanel.footnotes")}
      // Tab stays in the text (it indents), so F6 is the keyboard way here.
      {...(readOnly
        ? {}
        : { "data-focus-pane": "footnotes", "data-focus-pane-nested": "", tabIndex: -1 })}
    >
      <hr className="footnote-divider" />
      {readOnly ? (
        <ol className="footnote-list" start={startIndex}>
          {footnotes.map((fn) => (
            <li key={fn.key} id={`fn-content-${fn.id}`} className="footnote-item">
              <span className="footnote-number">{fn.number}.</span>
              <span className="footnote-content">{fn.content}</span>
              <a
                className="footnote-backref"
                href={`#fnref-${fn.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  goTo(fn);
                }}
                aria-label={t("editor.goToReference")}
              >
                ↩
              </a>
            </li>
          ))}
        </ol>
      ) : (
        <FootnoteGrid
          label={t("bookSidePanel.footnotes")}
          sections={[{ key: "chapter", items: footnotes }]}
          onGoTo={goTo}
          onSave={(item, content) => {
            editor.commands.updateFootnote({ id: item.id, index: item.index }, content);
          }}
          onDelete={(item) => {
            editor.commands.deleteFootnote({ id: item.id, index: item.index });
          }}
          onEmptied={() => editor.commands.focus()}
          rowDomId={(item) => `fn-content-${item.id}`}
        />
      )}
    </section>
  );
}
