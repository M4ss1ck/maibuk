import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useTranslation } from "react-i18next";

interface FootnoteDialogProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
}

export function FootnoteDialog({ editor, isOpen, onClose }: FootnoteDialogProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [error, setError] = useState("");

  const handleInsert = () => {
    if (!content.trim()) {
      setError(t("editor.footnoteRequired"));
      return;
    }

    // Get selected text or use a default marker
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to);

    if (!selectedText) {
      setError(t("editor.selectTextForFootnote"));
      return;
    }

    // Apply footnote mark to selected text
    (editor.commands as any).setFootnote?.({ content: content.trim() });

    handleClose();
  };

  const handleClose = () => {
    setContent("");
    setError("");
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("editor.footnote")}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleInsert}>{t("editor.footnote")}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("editor.footnoteDescription")}
        </p>

        <div>
          <label className="block text-sm font-medium mb-1">{t("editor.footnoteContent")}</label>
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setError("");
            }}
            placeholder={t("editor.footnoteTextPlaceholder")}
            rows={4}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            autoFocus
          />
          {error && <p className="text-sm text-destructive mt-1">{error}</p>}
        </div>
      </div>
    </Modal>
  );
}
