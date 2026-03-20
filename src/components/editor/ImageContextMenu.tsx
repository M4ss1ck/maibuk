import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import {
  Type,
  Copy,
  Download,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
} from "lucide-react";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { toast } from "../ui";
import { IS_WEB, getDialog, getFileSystem } from "../../lib/platform";

interface ImageContextMenuProps {
  editor: Editor;
}

type MenuState = {
  pos: number;
  nodeAttrs: Record<string, unknown>;
  position: { top: number; left: number };
};

export function ImageContextMenu({ editor }: ImageContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [altModal, setAltModal] = useState<{ pos: number; alt: string } | null>(null);
  const isOpen = !!menu;

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideInteraction = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
      }
    };

    document.addEventListener("mousedown", handleOutsideInteraction);
    document.addEventListener("touchstart", handleOutsideInteraction);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleOutsideInteraction);
      document.removeEventListener("touchstart", handleOutsideInteraction);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // Adjust position if overflowing viewport
  useEffect(() => {
    if (!isOpen || !menuRef.current || !menu) return;

    const rect = menuRef.current.getBoundingClientRect();
    const adjusted = adjustPosition(menu.position, rect);

    if (adjusted.left !== menu.position.left || adjusted.top !== menu.position.top) {
      setMenu((prev) => (prev ? { ...prev, position: adjusted } : prev));
    }
  }, [isOpen, menu]);

  // Context menu handler (capture phase to run before SpellCheckPopover)
  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const figureEl = target.closest("figure[data-image]");
      if (!figureEl) {
        setMenu(null);
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const posFromCoords = editor.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      })?.pos;
      const posFromDom = editor.view.posAtDOM(figureEl, 0);
      const resolvedPos = editor.state.doc.resolve(posFromCoords ?? posFromDom);
      const imageInfo = findImageNodeAtPos(editor, resolvedPos.pos);
      if (!imageInfo) {
        setMenu(null);
        return;
      }

      setMenu({
        pos: imageInfo.pos,
        nodeAttrs: imageInfo.node.attrs,
        position: clampPosition(event.clientX, event.clientY),
      });
    };

    editor.view.dom.addEventListener("contextmenu", handleContextMenu, true);
    return () => {
      editor.view.dom.removeEventListener("contextmenu", handleContextMenu, true);
    };
  }, [editor]);

  const closeMenu = () => setMenu(null);

  const handleEditAlt = () => {
    if (!menu) return;
    setAltModal({ pos: menu.pos, alt: (menu.nodeAttrs.alt as string) || "" });
    closeMenu();
  };

  const handleSaveAlt = () => {
    if (!altModal) return;
    const { pos, alt } = altModal;
    editor
      .chain()
      .focus()
      .setNodeSelection(pos)
      .updateAttributes("image", { alt, title: alt })
      .run();
    setAltModal(null);
  };

  const handleCopyImage = async () => {
    if (!menu) return;
    const src = menu.nodeAttrs.src as string;
    try {
      const blob = await srcToBlob(src);
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      toast.success(t("common.copied"));
    } catch (err) {
      console.error("Failed to copy image:", err);
    }
    closeMenu();
  };

  const handleSaveImage = async () => {
    if (!menu) return;
    const src = menu.nodeAttrs.src as string;
    try {
      const blob = await srcToBlob(src);
      const data = new Uint8Array(await blob.arrayBuffer());
      const ext = mimeToExtension(blob.type);
      const filename = `image-${Date.now()}.${ext}`;

      if (IS_WEB) {
        const fs = await getFileSystem();
        fs.downloadFile(filename, data, blob.type);
      } else {
        const dialog = await getDialog();
        const path = await dialog.save({
          defaultPath: filename,
          filters: [{ name: "Images", extensions: [ext] }],
        });
        if (path) {
          const fs = await getFileSystem();
          await fs.writeFile(path, data);
        }
      }
    } catch (err) {
      console.error("Failed to save image:", err);
    }
    closeMenu();
  };

  const handleSetAlignment = (alignment: "left" | "center" | "right") => {
    if (!menu) return;
    editor
      .chain()
      .focus()
      .setNodeSelection(menu.pos)
      .updateAttributes("image", { alignment })
      .run();
    closeMenu();
  };

  const handleDelete = () => {
    if (!menu) return;
    editor
      .chain()
      .focus()
      .setNodeSelection(menu.pos)
      .deleteSelection()
      .run();
    closeMenu();
  };

  return (
    <>
      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 w-48 rounded-lg border border-border bg-card shadow-lg py-1"
            style={{ top: menu.position.top, left: menu.position.left }}
          >
            <MenuItem onClick={handleEditAlt} icon={<Type className="w-4 h-4" />}>
              {t("editor.imageEditAlt")}
            </MenuItem>
            <MenuItem onClick={handleCopyImage} icon={<Copy className="w-4 h-4" />}>
              {t("editor.imageCopy")}
            </MenuItem>
            <MenuItem onClick={handleSaveImage} icon={<Download className="w-4 h-4" />}>
              {t("editor.imageSave")}
            </MenuItem>

            <div className="border-t border-border my-1" />

            <div className="px-3 py-1 text-xs text-muted-foreground">
              {t("editor.imageAlignment")}
            </div>
            <MenuItem
              onClick={() => handleSetAlignment("left")}
              icon={<AlignLeft className="w-4 h-4" />}
            >
              {t("editor.alignLeft")}
            </MenuItem>
            <MenuItem
              onClick={() => handleSetAlignment("center")}
              icon={<AlignCenter className="w-4 h-4" />}
            >
              {t("editor.alignCenter")}
            </MenuItem>
            <MenuItem
              onClick={() => handleSetAlignment("right")}
              icon={<AlignRight className="w-4 h-4" />}
            >
              {t("editor.alignRight")}
            </MenuItem>

            <div className="border-t border-border my-1" />

            <MenuItem
              onClick={handleDelete}
              icon={<Trash2 className="w-4 h-4" />}
              variant="destructive"
            >
              {t("common.delete")}
            </MenuItem>
          </div>,
          document.body
        )}

      {/* Alt text edit modal */}
      {altModal && (
        <Modal
          isOpen={true}
          onClose={() => setAltModal(null)}
          title={t("editor.imageEditAlt")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAltModal(null)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSaveAlt}>{t("common.save")}</Button>
            </>
          }
        >
          <Input
            label={t("editor.imageAltText")}
            placeholder={t("editor.imageAltPlaceholder")}
            value={altModal.alt}
            onChange={(e) => setAltModal({ ...altModal, alt: e.target.value })}
            autoFocus
          />
        </Modal>
      )}
    </>
  );
}

function findImageNodeAtPos(editor: Editor, pos: number) {
  const $pos = editor.state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.name === "image") {
      return { node, pos: $pos.before(depth) };
    }
  }
  return null;
}

function MenuItem({
  onClick,
  icon,
  children,
  variant,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  variant?: "destructive";
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-muted transition-colors ${variant === "destructive" ? "text-destructive" : ""
        }`}
      type="button"
    >
      <span className="w-4 h-4 shrink-0">{icon}</span>
      {children}
    </button>
  );
}

// --- Helpers ---

function clampPosition(clientX: number, clientY: number) {
  const width = 192;
  const height = 320;
  const padding = 8;
  const maxLeft = window.innerWidth - width - padding;
  const maxTop = window.innerHeight - height - padding;
  return {
    left: Math.min(Math.max(clientX, padding), Math.max(maxLeft, padding)),
    top: Math.min(Math.max(clientY, padding), Math.max(maxTop, padding)),
  };
}

function adjustPosition(
  position: { top: number; left: number },
  rect: DOMRect
) {
  const padding = 8;
  const maxLeft = window.innerWidth - rect.width - padding;
  const maxTop = window.innerHeight - rect.height - padding;
  return {
    left: Math.min(Math.max(position.left, padding), Math.max(maxLeft, padding)),
    top: Math.min(Math.max(position.top, padding), Math.max(maxTop, padding)),
  };
}

async function srcToBlob(src: string): Promise<Blob> {
  if (src.startsWith("data:")) {
    const [header, base64] = src.split(",");
    const mimeMatch = header.match(/data:([^;]+)/);
    const mimeType = mimeMatch?.[1] || "image/png";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }
  const response = await fetch(src);
  return response.blob();
}

function mimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };
  return map[mimeType] || "png";
}
