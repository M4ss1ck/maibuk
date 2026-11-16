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
  /** The Chapter editor the picture is inserted into; not used when `onSubmit` is set. */
  editor?: Editor;
  isOpen: boolean;
  onClose: () => void;
  /** Takes the picture instead of the editor. The dialog stays open when it rejects. */
  onSubmit?: (image: { src: string; alt: string; fileName?: string }) => Promise<void>;
  title?: string;
}

const BASE64_CHUNK_BYTES = 0x8000;

/** btoa over a whole photo in one spread overflows the call stack: chunk the bytes. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}

/** The picked file's name, whichever separator the platform's path used. */
function fileNameFromPath(path: string): string | undefined {
  return path.split(/[\\/]/).pop() || undefined;
}

export function ImageInsertDialog({
  editor,
  isOpen,
  onClose,
  onSubmit,
  title,
}: ImageInsertDialogProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const handleInsert = async () => {
    if (!url.trim()) {
      setError(t("editor.imageUrlRequired"));
      return;
    }

    const src = url.trim();

    if (onSubmit) {
      setSubmitting(true);
      try {
        await onSubmit({ src, alt: alt.trim(), fileName });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      handleClose();
      return;
    }

    if (!editor) return;

    // Leave the new image selected: Shift+F10 reaches its menu from the keyboard.
    // Only the ranges this insertion changed are searched, so an existing image
    // next to the caret is never picked instead.
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
    setFileName(undefined);
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
          const base64 = toBase64(result.data);
          const dataUrl = `data:${mimeType};base64,${base64}`;
          setUrl(dataUrl);
          setFileName(result.name);
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
          const base64 = toBase64(contents);
          const dataUrl = `data:${mimeType};base64,${base64}`;
          setUrl(dataUrl);
          setFileName(fileNameFromPath(selected));
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
      title={title ?? t("editor.insertImage")}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleInsert} disabled={submitting}>
            {t("common.insert")}
          </Button>
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
            setFileName(undefined);
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
