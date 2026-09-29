import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface InsertFootnoteDialogProps {
  mode?: "insert";
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
}

interface EditFootnoteDialogProps {
  mode: "edit";
  isOpen: boolean;
  onClose: () => void;
  /** The Footnote's number, shown in the description. */
  number: number;
  initialContent: string;
  /** Receives the trimmed new text; not called when the text did not change. */
  onSave: (content: string) => void;
  /** The Footnotes list entry the dialog was opened from. */
  restoreFocusTarget?: () => HTMLElement | null;
}

type FootnoteDialogProps = InsertFootnoteDialogProps | EditFootnoteDialogProps;

export function FootnoteDialog(props: FootnoteDialogProps) {
  const { isOpen, onClose } = props;
  const { t } = useTranslation();
  const isEdit = props.mode === "edit";
  const initialContent = isEdit ? props.initialContent : "";
  const [content, setContent] = useState(initialContent);
  const [error, setError] = useState("");
  const [wasOpen, setWasOpen] = useState(isOpen);

  // Every opening starts from the Footnote's current text, not a stale draft.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setContent(initialContent);
      setError("");
    }
  }

  const handleClose = () => {
    setContent("");
    setError("");
    onClose();
  };

  const handleSubmit = () => {
    const trimmed = content.trim();
    if (!trimmed) {
      setError(t("editor.footnoteRequired"));
      return;
    }

    if (props.mode === "edit") {
      if (trimmed !== props.initialContent) props.onSave(trimmed);
    } else {
      props.editor.commands.insertFootnote({ content: trimmed });
    }

    handleClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEdit ? t("editor.editFootnote") : t("editor.footnote")}
      restoreFocusTarget={props.mode === "edit" ? props.restoreFocusTarget : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit}>
            {isEdit ? t("common.save") : t("editor.insertFootnote")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {props.mode === "edit"
            ? t("editor.editFootnoteDescription", { number: props.number })
            : t("editor.footnoteDescription")}
        </p>

        <div>
          <label htmlFor="footnote-content" className="block text-sm font-medium mb-1">
            {t("editor.footnoteContent")}
          </label>
          <textarea
            id="footnote-content"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setError("");
            }}
            placeholder={t("editor.footnoteTextPlaceholder")}
            rows={4}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            autoFocus
            // A dialog opened from a closing Item Menu loses autoFocus to the menu's restore.
            data-autofocus=""
          />
          {error && <p className="text-sm text-destructive mt-1">{error}</p>}
        </div>
      </div>
    </Modal>
  );
}
