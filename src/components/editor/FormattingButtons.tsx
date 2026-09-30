import type { Editor } from "@tiptap/react";
import { FloatingFormattingGroups } from "@/components/editor/toolbar/FloatingFormattingGroups";

export function FormattingButtons({
  editor,
  onLinkClick,
  shouldFocusEditor,
}: {
  editor: Editor;
  onLinkClick: () => void;
  shouldFocusEditor?: () => boolean;
}) {
  return (
    <FloatingFormattingGroups
      editor={editor}
      onLinkClick={onLinkClick}
      shouldFocusEditor={shouldFocusEditor}
    />
  );
}
