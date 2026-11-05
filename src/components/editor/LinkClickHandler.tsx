import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { Editor } from "@tiptap/react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui";
import { openExternal } from "@/lib/platform";
import { isInternalLink } from "@/features/links/link-uri";
import { navigateToLinkTarget } from "@/features/links/navigate";
import { useBoundShortcutIds } from "@/lib/bound-shortcuts";
import { isModKey } from "@/lib/keyboard";

interface LinkClickDialogProps {
  editor: Editor;
}

interface LinkActivationDialogProps {
  url: string;
  onClose: () => void;
  /** Shows the Remove action; omitted when the surface cannot change the Link. */
  onRemove?: () => void;
}

/**
 * Follows an internal Link at once, or returns an external href for the caller
 * to confirm. Works without a TipTap editor, so a resting Text Node can use it
 * as the editor does.
 */
export function useLinkActivation() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return useCallback(
    (href: string): string | null => {
      if (isInternalLink(href)) {
        void navigateToLinkTarget(href, navigate, (key) => toast.error(t(key)));
        return null;
      }
      return href;
    },
    [navigate, t]
  );
}

/**
 * Confirms an external Link: Open, Copy URL, and Remove when the surface allows
 * it. Shared by the editor and the resting Text Node so both read the same.
 */
export function LinkActivationDialog({ url, onClose, onRemove }: LinkActivationDialogProps) {
  const { t } = useTranslation();

  const handleOpenLink = () => {
    openExternal(url);
    onClose();
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("common.copied"));
    } catch (e) {
      console.error("Failed to copy link:", e);
    }
    onClose();
  };

  return createPortal(
    <Modal
      isOpen
      onClose={onClose}
      title={t("editor.openLink")}
      footer={
        <div className="flex gap-2 w-full">
          {onRemove && (
            <Button variant="destructive" onClick={onRemove}>
              {t("editor.removeLink")}
            </Button>
          )}
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
        <p className="text-sm text-muted-foreground">{t("editor.externalLinkConfirm")}</p>
        <div className="p-3 bg-muted rounded-lg break-all">
          <code className="text-sm text-foreground">{url}</code>
        </div>
      </div>
    </Modal>,
    document.body
  );
}

export function LinkClickHandler({ editor }: LinkClickDialogProps) {
  const activateLink = useLinkActivation();
  const [url, setUrl] = useState<string | null>(null);
  // Mod+Enter is handled on the editor DOM, not through useShortcuts.
  useBoundShortcutIds(["editor.followLink"]);

  useEffect(() => {
    const openLink = (href: string) => {
      const external = activateLink(href);
      if (external) setUrl(external);
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const link = target.closest("a.editor-link");

      if (link) {
        event.preventDefault();
        event.stopPropagation();
        // A drag that selected the Link's text ends in a click too; keep the selection.
        if (!(document.getSelection()?.isCollapsed ?? true)) return;

        const href = link.getAttribute("href");
        if (href) {
          openLink(href);
        }
      }
    };

    // Keyboard activation of the Link the caret sits in.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isModKey(event) || event.key !== "Enter") return;
      const { from, to } = editor.state.selection;
      if (from !== to) return;
      const href = editor.getAttributes("link").href as string | undefined;
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      openLink(href);
    };

    // Attach to the editor's DOM element
    const editorElement = editor.view.dom;
    editorElement.addEventListener("click", handleClick);
    // Capture: read the Link under the caret before ProseMirror turns Enter
    // into a paragraph break and the caret leaves the mark.
    editorElement.addEventListener("keydown", handleKeyDown, true);

    return () => {
      editorElement.removeEventListener("click", handleClick);
      editorElement.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [editor, activateLink]);

  const handleRemove = () => {
    editor.chain().focus().unsetLink().run();
    setUrl(null);
  };

  if (!url) return null;

  return <LinkActivationDialog url={url} onClose={() => setUrl(null)} onRemove={handleRemove} />;
}
