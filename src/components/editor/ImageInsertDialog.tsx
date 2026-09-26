import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useTranslation } from "react-i18next";
import { ImageIcon } from "@/components/icons";
import { IS_WEB, getDialog, getFileSystem, getWebDialog } from "@/lib/platform";
import { extensionFromPath } from "@/lib/platform/uri";

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

    // Leave the new image selected: Shift+F10 reaches its menu from the keyboard.
    // Only the ranges this insertion changed are searched, so an existing image
    // next to the caret is never picked instead.
    const src = url.trim();
    let firstStep = 0;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        firstStep = tr.steps.length;
        return true;
      })
      .insertContent({
        type: "image",
        attrs: {
          src,
          alt: alt.trim() || null,
          title: alt.trim() || null,
        },
      })
      .command(({ tr }) => {
        let imagePos = -1;
        for (let i = firstStep; i < tr.steps.length; i++) {
          const later = tr.mapping.slice(i + 1);
          tr.mapping.maps[i].forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            const from = later.map(newStart, -1);
            const to = later.map(newEnd, 1);
            tr.doc.nodesBetween(from, to, (node, pos) => {
              if (pos >= from && node.type.name === "image" && node.attrs.src === src) {
                imagePos = pos;
              }
            });
          });
        }
        if (imagePos >= 0) tr.setSelection(NodeSelection.create(tr.doc, imagePos));
        return true;
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
          const extension = extensionFromPath(selected, "png");
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
