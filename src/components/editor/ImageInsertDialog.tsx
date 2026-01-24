import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useTranslation } from "react-i18next";
import { ImageIcon } from "../icons";
import { IS_WEB, getDialog, getFileSystem, getWebDialog } from "../../lib/platform";

interface ImageInsertDialogProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
}

export function ImageInsertDialog({ editor, isOpen, onClose }: ImageInsertDialogProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [error, setError] = useState("");

  const handleInsert = () => {
    if (!url.trim()) {
      setError(t("editor.imageUrlRequired"));
      return;
    }

    // Insert image using insertContent since setImage may not be available
    editor
      .chain()
      .focus()
      .insertContent({
        type: "image",
        attrs: {
          src: url.trim(),
          alt: alt.trim() || null,
          title: alt.trim() || null,
        },
      })
      .run();

    handleClose();
  };

  const handleClose = () => {
    setUrl("");
    setAlt("");
    setError("");
    onClose();
  };

  const handleFileSelect = async () => {
    const imageFilters = [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
      },
    ];

    try {
      if (IS_WEB) {
        // On web, use openWithData to get file contents directly
        const webDialog = await getWebDialog();
        const result = await webDialog.openWithData({
          multiple: false,
          filters: imageFilters,
        });

        if (result) {
          const extension = result.name.split(".").pop()?.toLowerCase() || "png";
          const mimeType = extension === "svg" ? "image/svg+xml" : `image/${extension}`;
          const base64 = btoa(String.fromCharCode(...result.data));
          const dataUrl = `data:${mimeType};base64,${base64}`;
          setUrl(dataUrl);
        }
      } else {
        // On Tauri, use dialog + filesystem
        const dialog = await getDialog();
        const selected = await dialog.open({
          multiple: false,
          filters: imageFilters,
        });

        if (selected) {
          const fs = await getFileSystem();
          const contents = await fs.readFile(selected);
          const extension = selected.split(".").pop()?.toLowerCase() || "png";
          const mimeType = extension === "svg" ? "image/svg+xml" : `image/${extension}`;
          const base64 = btoa(String.fromCharCode(...contents));
          const dataUrl = `data:${mimeType};base64,${base64}`;
          setUrl(dataUrl);
        }
      }
    } catch (err) {
      console.error("Failed to select file:", err);
      setError("Failed to select file. You can paste an image URL instead.");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("editor.insertImage")}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleInsert}>{t("common.insert")}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Button variant="secondary" onClick={handleFileSelect} className="w-full">
            <ImageIcon className="w-4 h-4 mr-2" />
            {t("editor.chooseFromComputer")}
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-sm text-muted-foreground">{t("editor.or")}</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <Input
          label={t("editor.imageUrl")}
          placeholder={t("editor.imageUrlPlaceholder")}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError("");
          }}
          error={error}
        />

        <Input
          label={t("editor.altTextOptional")}
          placeholder={t("editor.imageAltPlaceholder")}
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
        />

        {url && (
          <div className="mt-4">
            <p className="text-sm text-muted-foreground mb-2">{t("editor.preview")}</p>
            <div className="border border-border rounded-lg p-2 bg-muted/20">
              <img
                src={url}
                alt={alt || "Preview"}
                className="max-h-48 mx-auto object-contain"
                onError={() => setError(t("editor.failedToLoadPreview"))}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
