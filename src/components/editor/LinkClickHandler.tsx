import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

interface LinkClickDialogProps {
  editor: Editor;
}

interface LinkInfo {
  url: string;
  position: { x: number; y: number };
}

export function LinkClickHandler({ editor }: LinkClickDialogProps) {
  const { t } = useTranslation();
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const link = target.closest("a.editor-link");

      if (link) {
        event.preventDefault();
        event.stopPropagation();

        const href = link.getAttribute("href");
        if (href) {
          setLinkInfo({
            url: href,
            position: { x: event.clientX, y: event.clientY }
          });
          setShowConfirmDialog(true);
        }
      }
    };

    // Attach to the editor's DOM element
    const editorElement = editor.view.dom;
    editorElement.addEventListener("click", handleClick);

    return () => {
      editorElement.removeEventListener("click", handleClick);
    };
  }, [editor]);

  const handleOpenLink = () => {
    if (linkInfo?.url) {
      window.open(linkInfo.url, "_blank", "noopener,noreferrer");
    }
    handleClose();
  };

  const handleCopyLink = async () => {
    if (linkInfo?.url) {
      try {
        await navigator.clipboard.writeText(linkInfo.url);
      } catch (e) {
        console.error("Failed to copy link:", e);
      }
    }
    handleClose();
  };

  const handleClose = () => {
    setShowConfirmDialog(false);
    setLinkInfo(null);
  };

  const handleRemove = () => {
    editor.chain().focus().unsetLink().run();
    handleClose();
  };

  if (!showConfirmDialog || !linkInfo) return null;

  return createPortal(
    <Modal
      isOpen={showConfirmDialog}
      onClose={handleClose}
      title={t("editor.openLink")}
      footer={
        <div className="flex gap-2 w-full">
          <Button variant="destructive" onClick={handleRemove}>
            {t("editor.removeLink")}
          </Button>
          <Button variant="secondary" onClick={handleCopyLink} className="flex-1">
            {t("editor.copyUrl")}
          </Button>
          <Button onClick={handleOpenLink} className="flex-1">
            {t("editor.openLink")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("editor.externalLinkConfirm")}
        </p>
        <div className="p-3 bg-muted rounded-lg break-all">
          <code className="text-sm text-foreground">{linkInfo.url}</code>
        </div>
      </div>
    </Modal>,
    document.body
  );
}
