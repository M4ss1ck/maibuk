import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { markdownToEditorHtml } from "@/features/markdown";
import { Modal, Button } from "@/components/ui";
import { plainTextToEditorHtml } from "@/components/editor/plain-text-html";

interface MarkdownPasteDialogProps {
  editor: Editor;
  markdown: string | null;
  onClose: () => void;
}

/**
 * Shared confirmation dialog shown when pasted text looks like Markdown. Offers
 * inserting the text verbatim or converting it to rich content, then refocuses
 * the editor and closes.
 */
export function MarkdownPasteDialog({ editor, markdown, onClose }: MarkdownPasteDialogProps) {
  const { t } = useTranslation();

  const insert = (html: string) => {
    editor.chain().focus().insertContent(html).run();
    onClose();
  };

  // Escape and backdrop dismissal keep the pasted text as plain content
  // instead of silently dropping the paste.
  const handleDismiss = () => {
    if (markdown !== null) {
      insert(plainTextToEditorHtml(markdown));
      return;
    }
    onClose();
  };

  return (
    <Modal
      isOpen={markdown !== null}
      onClose={handleDismiss}
      title={t("editor.markdownDetectedTitle")}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => markdown !== null && insert(plainTextToEditorHtml(markdown))}
          >
            {t("editor.pasteAsIs")}
          </Button>
          <Button
            variant="primary"
            onClick={() => markdown !== null && insert(markdownToEditorHtml(markdown))}
          >
            {t("editor.convert")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{t("editor.markdownDetectedBody")}</p>
    </Modal>
  );
}
