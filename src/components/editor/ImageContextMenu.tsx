import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { Type, Copy, Download, AlignLeft, AlignCenter, AlignRight, Trash2 } from "lucide-react";
import {
  Header,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover,
  Separator,
} from "react-aria-components";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui";
import { IS_WEB, getDialog, getFileSystem } from "@/lib/platform";
import { findImageNodeAtPos } from "@/components/editor/editor-context-menu-utils";

interface ImageContextMenuProps {
  editor: Editor;
}

type MenuState = {
  pos: number;
  nodeAttrs: Record<string, unknown>;
  /** Viewport point the popover anchors to. */
  anchor: { top: number; left: number };
};

export function ImageContextMenu({ editor }: ImageContextMenuProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [altModal, setAltModal] = useState<{ pos: number; alt: string } | null>(null);
  const isOpen = !!menu;
  // Choosing Edit Alt Text closes the menu and opens a dialog in the same
  // interaction. Returning focus to the editor here would pull it out of the
  // dialog before the dialog's fields settle, so the dialog's focus containment
  // would land on its Close button instead of the Alt Text field.
  const keepFocusInDialogRef = useRef(false);

  const openMenu = (
    pos: number,
    nodeAttrs: Record<string, unknown>,
    anchor: { top: number; left: number }
  ) => setMenu({ pos, nodeAttrs, anchor });

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
      const imageInfo = findImageNodeAtPos(editor.state.doc, resolvedPos.pos);
      if (!imageInfo) {
        setMenu(null);
        return;
      }

      const rect = figureEl.getBoundingClientRect();
      openMenu(imageInfo.pos, imageInfo.node.attrs, {
        top: rect.bottom + 4,
        left: rect.left,
      });
    };

    const dom = editor.view.dom;
    dom.addEventListener("contextmenu", handleContextMenu, true);
    return () => dom.removeEventListener("contextmenu", handleContextMenu, true);
  }, [editor]);

  // Keyboard context menu: Shift+F10 / the ContextMenu key opens the same menu
  // when the selection sits on an image.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isContextMenuKey = event.key === "ContextMenu";
      const isShiftF10 = event.shiftKey && event.key === "F10";
      if (!isContextMenuKey && !isShiftF10) return;

      const selection = editor.state.selection;
      let imageInfo: { node: { attrs: Record<string, unknown> }; pos: number } | null = null;
      if (selection instanceof NodeSelection && selection.node.type.name === "image") {
        imageInfo = findImageNodeAtPos(editor.state.doc, selection.from + 1);
      } else {
        imageInfo = findImageNodeAtPos(editor.state.doc, selection.from);
      }
      if (!imageInfo) return;

      event.preventDefault();

      const dom = editor.view.nodeDOM(imageInfo.pos);
      const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
      const rect = el?.getBoundingClientRect();
      let anchor = { top: 0, left: 0 };
      if (rect && (rect.width > 0 || rect.height > 0 || rect.top !== 0 || rect.left !== 0)) {
        anchor = { top: rect.bottom + 4, left: rect.left };
      } else {
        try {
          const coords = editor.view.coordsAtPos(imageInfo.pos);
          anchor = { top: coords.bottom + 4, left: coords.left };
        } catch {
          // jsdom has no layout; the popover still opens for the keyboard.
        }
      }
      openMenu(imageInfo.pos, imageInfo.node.attrs as Record<string, unknown>, anchor);
    };

    const dom = editor.view.dom;
    dom.addEventListener("keydown", handleKeyDown);
    return () => dom.removeEventListener("keydown", handleKeyDown);
  }, [editor]);

  const closeMenu = () => setMenu(null);

  const handleEditAlt = () => {
    if (!menu) return;
    keepFocusInDialogRef.current = true;
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
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
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
    editor.chain().focus().setNodeSelection(menu.pos).deleteSelection().run();
    closeMenu();
  };

  const handleAction = (key: React.Key) => {
    switch (key) {
      case "edit-alt":
        handleEditAlt();
        break;
      case "copy":
        void handleCopyImage();
        break;
      case "save":
        void handleSaveImage();
        break;
      case "align-left":
        handleSetAlignment("left");
        break;
      case "align-center":
        handleSetAlignment("center");
        break;
      case "align-right":
        handleSetAlignment("right");
        break;
      case "delete":
        handleDelete();
        break;
    }
  };

  return (
    <>
      {/* A zero-size anchor at the caret/image: MenuTrigger positions the menu
          from it, and focus returns to the editor from onOpenChange below. */}
      <MenuTrigger
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeMenu();
            // The dialog owns focus now; restoring it to the editor would
            // strand the dialog's own autofocus.
            if (keepFocusInDialogRef.current) {
              keepFocusInDialogRef.current = false;
            } else {
              editor.commands.focus();
            }
          }
        }}
      >
        <button
          ref={anchorRef}
          type="button"
          tabIndex={-1}
          aria-label={t("editor.imageOptions")}
          className="pointer-events-none fixed h-px w-px opacity-0"
          style={{ top: menu?.anchor.top ?? 0, left: menu?.anchor.left ?? 0 }}
        />
        <Popover placement="bottom start" className="z-50">
          <Menu
            aria-label={t("editor.imageOptions")}
            onAction={handleAction}
            className="w-48 rounded-lg border border-border bg-card py-1 shadow-lg outline-none"
          >
          <MenuItem
            id="edit-alt"
            textValue={t("editor.imageEditAlt")}
            className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-foreground outline-none data-focused:bg-muted"
          >
            <Type className="w-4 h-4 shrink-0" />
            {t("editor.imageEditAlt")}
          </MenuItem>
          <MenuItem
            id="copy"
            textValue={t("editor.imageCopy")}
            className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-foreground outline-none data-focused:bg-muted"
          >
            <Copy className="w-4 h-4 shrink-0" />
            {t("editor.imageCopy")}
          </MenuItem>
          <MenuItem
            id="save"
            textValue={t("editor.imageSave")}
            className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-foreground outline-none data-focused:bg-muted"
          >
            <Download className="w-4 h-4 shrink-0" />
            {t("editor.imageSave")}
          </MenuItem>

          <Separator className="my-1 border-t border-border" />

          <MenuSection className="outline-none">
            <Header className="px-3 py-1 text-xs text-muted-foreground">
              {t("editor.imageAlignment")}
            </Header>
            <MenuItem
              id="align-left"
              textValue={t("editor.alignLeft")}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              <AlignLeft className="w-4 h-4 shrink-0" />
              {t("editor.alignLeft")}
            </MenuItem>
            <MenuItem
              id="align-center"
              textValue={t("editor.alignCenter")}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              <AlignCenter className="w-4 h-4 shrink-0" />
              {t("editor.alignCenter")}
            </MenuItem>
            <MenuItem
              id="align-right"
              textValue={t("editor.alignRight")}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-foreground outline-none data-focused:bg-muted"
            >
              <AlignRight className="w-4 h-4 shrink-0" />
              {t("editor.alignRight")}
            </MenuItem>
          </MenuSection>

          <Separator className="my-1 border-t border-border" />

          <MenuItem
            id="delete"
            textValue={t("common.delete")}
            className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-destructive outline-none data-focused:bg-muted"
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            {t("common.delete")}
          </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>

      {/* Alt text edit modal */}
      {altModal && (
        <Modal
          isOpen={true}
          onClose={() => {
            setAltModal(null);
            editor.commands.focus();
          }}
          title={t("editor.imageEditAlt")}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setAltModal(null);
                  editor.commands.focus();
                }}
              >
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

// --- Helpers ---

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
