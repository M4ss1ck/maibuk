import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

interface ImageInsertDialogProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
}

export function ImageInsertDialog({ editor, isOpen, onClose }: ImageInsertDialogProps) {
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [error, setError] = useState("");

  const handleInsert = () => {
    if (!url.trim()) {
      setError("Image URL is required");
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
    try {
      // Use Tauri's file dialog
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
          },
        ],
      });

      if (selected) {
        // For local files, we need to convert to a data URL or use a local protocol
        const { readFile } = await import("@tauri-apps/plugin-fs");
        const contents = await readFile(selected);
        const extension = selected.split(".").pop()?.toLowerCase() || "png";
        const mimeType = extension === "svg" ? "image/svg+xml" : `image/${extension}`;
        const base64 = btoa(String.fromCharCode(...contents));
        const dataUrl = `data:${mimeType};base64,${base64}`;
        setUrl(dataUrl);
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
      title="Insert Image"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleInsert}>Insert</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Button variant="secondary" onClick={handleFileSelect} className="w-full">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Choose from Computer
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-sm text-muted-foreground">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <Input
          label="Image URL"
          placeholder="https://example.com/image.jpg"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError("");
          }}
          error={error}
        />

        <Input
          label="Alt Text (optional)"
          placeholder="Description of the image"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
        />

        {url && (
          <div className="mt-4">
            <p className="text-sm text-muted-foreground mb-2">Preview:</p>
            <div className="border border-border rounded-lg p-2 bg-muted/20">
              <img
                src={url}
                alt={alt || "Preview"}
                className="max-h-48 mx-auto object-contain"
                onError={() => setError("Failed to load image preview")}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
