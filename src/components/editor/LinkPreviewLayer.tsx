import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react";
import type { Editor } from "@tiptap/react";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";
import { LinkPreviewCard, describeLinkPreview } from "@/components/editor/LinkPreviewCard";
import { LINK_PREVIEW_DELAY_MS } from "@/constants";
import { loadLinkPreview } from "@/features/links/link-preview";
import type { LinkPreviewData } from "@/features/links/types";

type Source = "pointer" | "caret";

interface Shown {
  anchor: HTMLElement;
  href: string;
  source: Source;
  data: LinkPreviewData;
}

// A Link mark, or a wikilink node just inserted through [[ (an unresolved
// wikilink has no target to preview).
const LINK_SELECTOR = "a.editor-link, a.wikilink[href]";

/**
 * Shows a Link Preview for the Link under a resting mouse or a resting caret.
 * Typing or Escape hides a caret preview until the caret moves again; a touch
 * never opens one (a long press edits the Link instead).
 */
export function LinkPreviewLayer({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const tooltipId = useId();
  const [shown, setShown] = useState<Shown | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const shownRef = useRef<Shown | null>(null);
  shownRef.current = shown;

  const { refs, floatingStyles } = useFloating({
    open: shown !== null,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    elements: { reference: shown?.anchor ?? null },
  });

  useEffect(() => {
    const dom = editor.view.dom;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: { anchor: HTMLElement; source: Source } | null = null;
    // Set by typing and Escape; cleared once the caret moves on its own.
    let caretSuppressed = false;
    let request = 0;

    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      request++;
    };

    const hide = (source?: Source) => {
      const current = shownRef.current;
      if (source && pending?.source !== source && current?.source !== source) return;
      cancel();
      if (current) setShown(null);
      setAnnouncement("");
    };

    const schedule = (anchor: HTMLElement, source: Source) => {
      const href = anchor.getAttribute("href");
      if (!href) return;
      const current = shownRef.current;
      if (current?.anchor === anchor && current.source === source) return;
      if (pending?.anchor === anchor && pending.source === source) return;
      cancel();
      if (current) setShown(null);
      pending = { anchor, source };
      const id = request;
      timer = setTimeout(() => {
        timer = null;
        void loadLinkPreview(href).then((data) => {
          if (id !== request) return;
          pending = null;
          setShown({ anchor, href, source, data });
          setAnnouncement(source === "caret" ? describeLinkPreview(data, t) : "");
        });
      }, LINK_PREVIEW_DELAY_MS);
    };

    const linkAtCaret = (): HTMLElement | null => {
      const { selection } = editor.state;
      // Arrows select a wikilink node whole instead of entering it.
      if (selection instanceof NodeSelection) {
        if (selection.node.type.name !== "wikilink") return null;
        const dom = editor.view.nodeDOM(selection.from);
        return dom instanceof Element ? dom.closest<HTMLElement>(LINK_SELECTOR) : null;
      }
      if (!selection.empty || !editor.isActive("link")) return null;
      const { node } = editor.view.domAtPos(selection.from);
      const element = node instanceof Element ? node : node.parentElement;
      return element?.closest<HTMLElement>(LINK_SELECTOR) ?? null;
    };

    const followCaret = () => {
      const anchor = editor.isFocused && !caretSuppressed ? linkAtCaret() : null;
      if (anchor) schedule(anchor, "caret");
      else hide("caret");
    };

    const handleTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) {
        caretSuppressed = true;
        hide("caret");
        return;
      }
      if (!transaction.selectionSet) return;
      caretSuppressed = false;
      followCaret();
    };

    const handleBlur = () => hide("caret");

    const handlePointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const anchor = (event.target as Element).closest<HTMLElement>(LINK_SELECTOR);
      if (anchor) schedule(anchor, "pointer");
    };

    const handlePointerOut = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const anchor = (event.target as Element).closest<HTMLElement>(LINK_SELECTOR);
      if (!anchor || anchor.contains(event.relatedTarget as Node | null)) return;
      hide("pointer");
    };

    // Following or editing the Link takes over from its preview.
    const handlePointerDown = () => hide();

    // Escape takes a visible preview away and nothing else; before the preview
    // shows, it only cancels it and keeps its usual meaning.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (!shownRef.current && !pending)) return;
      if (shownRef.current) {
        event.preventDefault();
        event.stopPropagation();
      }
      caretSuppressed = true;
      hide();
    };

    editor.on("transaction", handleTransaction);
    editor.on("blur", handleBlur);
    dom.addEventListener("pointerover", handlePointerOver);
    dom.addEventListener("pointerout", handlePointerOut);
    dom.addEventListener("pointerdown", handlePointerDown);
    dom.addEventListener("keydown", handleKeyDown, true);
    return () => {
      cancel();
      editor.off("transaction", handleTransaction);
      editor.off("blur", handleBlur);
      dom.removeEventListener("pointerover", handlePointerOver);
      dom.removeEventListener("pointerout", handlePointerOut);
      dom.removeEventListener("pointerdown", handlePointerDown);
      dom.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [editor, t]);

  return (
    <>
      <div data-testid="link-preview-announcer" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {shown && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            id={tooltipId}
            role="tooltip"
            aria-label={t("linkPreview.label")}
            className="z-60"
            style={floatingStyles}
          >
            <LinkPreviewCard data={shown.data} />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
