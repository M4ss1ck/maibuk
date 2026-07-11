import type { Editor } from "@tiptap/react";
import { FloatingFormattingGroups } from "@/components/editor/toolbar/FloatingFormattingGroups";

export function FormattingButtons({
  editor,
  onLinkClick,
}: {
  editor: Editor;
  onLinkClick: () => void;
}) {
  return <FloatingFormattingGroups editor={editor} onLinkClick={onLinkClick} />;
}
