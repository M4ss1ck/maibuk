import { useState, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useTranslation } from "react-i18next";

interface LinkDialogProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
}

export function LinkDialog({ editor, isOpen, onClose }: LinkDialogProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  // Get current link and selection when dialog opens
  useEffect(() => {
    if (isOpen) {
      const { from, to } = editor.state.selection;
      const selectedText = editor.state.doc.textBetween(from, to);
      const currentLink = editor.getAttributes("link").href || "";

      setText(selectedText);
      setUrl(currentLink);
      setError("");
    }
  }, [isOpen, editor]);

  const handleInsert = () => {
    if (!url.trim()) {
      setError(t("errors.URLRequired"));
      return;
    }

    // Validate URL format
    let finalUrl = url.trim();
    if (!/^https?:\/\//i.test(finalUrl) && !finalUrl.startsWith("mailto:")) {
      finalUrl = "https://" + finalUrl;
    }

    if (text.trim()) {
      // If we have custom text, insert it with the link
      const { from, to } = editor.state.selection;
      if (from === to) {
        // No selection, insert text with link
        editor
          .chain()
          .focus()
          .insertContent(`<a href="${finalUrl}">${text.trim()}</a>`)
          .run();
      } else {
        // Has selection, set link on selection
        editor.chain().focus().setLink({ href: finalUrl }).run();
      }
    } else {
      // Just set link on current selection
      editor.chain().focus().setLink({ href: finalUrl }).run();
    }

    handleClose();
  };

  const handleRemove = () => {
    editor.chain().focus().unsetLink().run();
    handleClose();
  };

  const handleClose = () => {
    setUrl("");
    setText("");
    setError("");
    onClose();
  };

  const isEditing = !!editor.getAttributes("link").href;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditing ? t("editor.editLink") : t("editor.insertLink")}
      footer={
        <>
          {isEditing && (
            <Button variant="secondary" onClick={handleRemove} className="text-destructive hover:bg-destructive hover:text-white">
              {t("editor.removeLink")}
            </Button>
          )}
          <Button variant="secondary" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleInsert}>
            {isEditing ? t("common.update") : t("common.insert")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">URL</label>
          <Input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError("");
            }}
            placeholder="https://example.com"
            autoFocus
          />
          {error && <p className="text-sm text-destructive mt-1">{error}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            {t("editor.displayText")} <span className="text-muted-foreground">{t("editor.optional")}</span>
          </label>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("editor.linkText")}
          />
          <p className="text-xs text-muted-foreground mt-1">
            {t("editor.leaveEmpty")}
          </p>
        </div>
      </div>
    </Modal>
  );
}
