import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { NodeResizeControl, ResizeControlVariant, type Node, type NodeProps } from "@xyflow/react";
import Placeholder from "@tiptap/extension-placeholder";
import { Selection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { CANVAS_TEXT_NODE_MIN_WIDTH } from "@/constants";
import { useCanvasStore } from "@/features/canvas/store";
import { useSettingsStore } from "@/features/settings/store";
import type { CanvasFlowNodeData } from "@/features/canvas/reactFlowAdapter";
import type { LightweightCanvasNode } from "@/features/canvas/types";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { useEditorCommandSource } from "@/components/editor/editor-command-source";
import { LinkActivationDialog, useLinkActivation } from "@/components/editor/LinkClickHandler";
import { EditorContextMenu } from "@/components/editor/EditorContextMenu";
import { MarkdownPasteDialog } from "@/components/editor/MarkdownPasteDialog";
import { FootnoteList } from "@/components/editor/FootnoteList";
import { ImageContextMenu } from "@/components/editor/ImageContextMenu";
import { CanvasNodeHandles } from "@/features/canvas/nodes/CanvasNodeHandles";
import { NodeFormatBubble } from "@/features/canvas/nodes/NodeFormatBubble";
import { useCanvasNodeMenu, type CanvasNodeLink } from "@/features/canvas/nodes/CanvasNodeMenu";
import {
  canvasLinkAnchors,
  isBlankTextNodeHtml,
  prepareStaticCanvasHtml,
} from "@/features/canvas/nodes/staticRichText";
import {
  useOpeningMarksLanguage,
  useWritingLanguageGetter,
} from "@/components/editor/opening-marks-language";
import { resolveWritingLanguage } from "@/lib/writing-language";

type LightweightFlowNode = Node<CanvasFlowNodeData, "text">;

/** An uncommitted color picker choice for this node, shown until it commits or is discarded. */
function useNodeColorPreview(nodeId: string) {
  return useCanvasStore((state) =>
    state.colorPreview?.nodeId === nodeId ? state.colorPreview : null
  );
}

function textColorStyle(color: string | undefined) {
  return color ? { color } : undefined;
}

/** The Links a Text Node shows at rest, in document order. */
function textNodeLinks(html: string | null): CanvasNodeLink[] {
  if (!html) return [];
  return canvasLinkAnchors(html).map(({ href, text }, index) => ({ href, text, index }));
}

/** ProseMirror's internal record of the view's last focus event. */
interface FocusedView {
  input?: { lastFocus: number };
}

function ActiveNodeEditor({
  node,
  onDone,
  onExit,
}: {
  node: LightweightCanvasNode;
  onDone: () => void;
  /** Leave editing and hand focus back to the node (the Escape path). */
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const updateTextNode = useCanvasStore((state) => state.updateTextNode);
  const colorPreview = useNodeColorPreview(node.id);
  const spellCheckEnabled = useSettingsStore((state) => state.spellCheckEnabled);
  const language = useSettingsStore((state) => state.language);
  const editorAutoClose = useSettingsStore((state) => state.editorAutoClose);
  // A Canvas has no language of its own; its text follows the app's, like Spell Check.
  const writingLanguage = resolveWritingLanguage({ app: language });
  const openingMarksLanguage = useOpeningMarksLanguage(writingLanguage);
  const writingLanguageGetter = useWritingLanguageGetter(writingLanguage);
  const overlayOpen = useRef(false);
  // A right-click menu that is anchored in this node, open or closing.
  const menuOpen = useRef(false);
  const menuWasOpen = useRef(false);
  // The Selection toolbar's portal, and the menus' own (hidden) elements.
  const bubbleRef = useRef<HTMLDivElement>(null);
  const menusRef = useRef<HTMLDivElement>(null);
  const [pendingMarkdownPaste, setPendingMarkdownPaste] = useState<string | null>(null);
  const hadText = useRef(false);
  const editor = useEditor({
    extensions: [
      ...createRichTextExtensions({
        onMarkdownPaste: setPendingMarkdownPaste,
        footnoteStartIndex: 1,
        spellCheck: { enabled: spellCheckEnabled, language: writingLanguage },
        autoClose: editorAutoClose,
        openingMarksLanguage,
        writingLanguage: writingLanguageGetter,
        // Leaving the node writes its HTML back, so opening must not change it.
        nameHeadingsOnOpen: false,
      }),
      Placeholder.configure({
        placeholder: t("canvas.textNodePlaceholder"),
        emptyEditorClass: "is-editor-empty",
      }),
    ],
    content: node.html,
    onUpdate: ({ editor: updated }) => {
      if (updated.getText().trim()) hadText.current = true;
    },
    editable: true,
    // No autofocus: TipTap runs it from a timeout after mount, and it resets
    // any selection the author made since (F2 then Shift+Arrow). The layout
    // effect below places the caret instead.
    autofocus: false,
    editorProps: {
      attributes: { class: "outline-none", lang: writingLanguage },
    },
  });
  useEditorCommandSource(editor);

  // Place the caret at the end and focus during the commit that opens the
  // editor. A keyboard author's next keystroke (T then typing, F2 then
  // Shift+Arrow) can arrive before a passive effect or a requestAnimationFrame
  // in WebKit, so nothing here may be deferred: TipTap's focus command focuses
  // in a later frame, and a deferred caret move would undo that selection.
  useLayoutEffect(() => {
    if (!editor?.view) return;
    const { state, view } = editor;
    view.dispatch(state.tr.setSelection(Selection.atEnd(state.doc)).scrollIntoView());
    view.focus();
    // For 200ms after a focus, ProseMirror reads a caret at the start of the
    // text as the browser resetting it and puts the old one back, so F2 then
    // Home (or Control+Home) would leave the caret at the end. This focus
    // placed the caret itself, so nothing needs restoring.
    const input = (view as FocusedView).input;
    if (input) input.lastFocus = 0;
  }, [editor]);

  if (!editor) return null;

  const commit = (leave: () => void = onDone) => {
    const html = editor.getHTML();
    // A node that has never had text stays uncommitted, and leaving drops it.
    const pristine = useCanvasStore.getState().pristineTextNode?.id === node.id;
    if (!pristine || hadText.current || !isBlankTextNodeHtml(html)) {
      updateTextNode(node.id, { html });
    }
    leave();
  };

  // An action or Escape refocuses the text a frame after the menu closes: the
  // node must stay open for both. An outside click leaves focus elsewhere, and
  // that click clears the selection, which unmounts this editor, so its text
  // has to be committed now or it is lost.
  const commitAfterMenu = () => {
    requestAnimationFrame(() => {
      if (editor.isDestroyed || editor.isFocused) return;
      if (overlayOpen.current || menuOpen.current || pendingMarkdownPaste !== null) return;
      const active = document.activeElement;
      // A close leaves focus on the page body, or restores it to the menu's
      // hidden trigger: neither is the author leaving the node's editor. The
      // trigger is portaled to the body (a Canvas node's transform would offset
      // a fixed anchor), so it is outside menusRef and matched by its marker.
      if (
        !active ||
        active === document.body ||
        menusRef.current?.contains(active) ||
        (active instanceof Element && active.closest("[data-editor-context-menu-trigger]"))
      ) {
        return;
      }
      commit();
    });
  };

  return (
    <>
      <div
        className="canvas-node-content max-w-none"
        style={textColorStyle(colorPreview?.textColor ?? node.textColor)}
        // EditorContextMenu and ImageContextMenu take focus out of the text, and
        // the blur that follows arrives before either menu reports opening. Mark
        // the gesture here, during the capture phase, so that blur does not
        // commit the node. A link right click opens the Link dialog instead, and
        // NodeFormatBubble reports that overlay on its own.
        onContextMenuCapture={(event) => {
          if (event.target instanceof Element && editor.view.dom.contains(event.target)) {
            menuOpen.current = true;
          }
        }}
        onKeyDownCapture={(event) => {
          // Shift+F10 and the ContextMenu key open the same menu from the keyboard.
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            menuOpen.current = true;
          }
        }}
      >
        <EditorContent
          editor={editor}
          className="nodrag nopan max-w-none"
          onFocus={() => {
            // A menu that closed put focus back in the text; the node is live again.
            menuOpen.current = false;
          }}
          onBlur={(event) => {
            // Focus moving into this node's Selection toolbar is not leaving
            // the text: the toolbar acts on the selection made here.
            if (
              event.relatedTarget instanceof Node &&
              bubbleRef.current?.contains(event.relatedTarget)
            ) {
              return;
            }
            // A combobox's list is portaled out of the bubble, and pressing an
            // item there still acts on this Text Node's selection.
            if (
              event.relatedTarget instanceof Element &&
              event.relatedTarget.closest('[role="listbox"]')
            ) {
              return;
            }
            if (overlayOpen.current || menuOpen.current || pendingMarkdownPaste !== null) return;
            commit();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              // Tab indents inside the editor and a pointer is the only way to
              // blur, so a keyboard-only author could never save their text.
              // Escape is the commit path: persist, then leave editing and
              // return focus to the node so the next Tab continues from there.
              commit(onExit);
            }
          }}
        />
        <FootnoteList editor={editor} startIndex={1} readOnly />
      </div>
      <NodeFormatBubble
        editor={editor}
        bubbleRef={bubbleRef}
        onOverlayOpenChange={(open) => {
          overlayOpen.current = open;
        }}
        // Focus that leaves the bubble for the canvas ends this node's edit, so
        // the text goes in now or the unmount drops it.
        onToolbarLeave={() => {
          // The bubble only reports a leave with no dialog or menu of its own open.
          if (editor.isDestroyed || menuOpen.current || pendingMarkdownPaste !== null) return;
          commit();
        }}
      />
      <ImageContextMenu editor={editor} />
      <div ref={menusRef}>
        <EditorContextMenu
          editor={editor}
          onOpenChange={(open) => {
            menuOpen.current = open;
            if (open) {
              menuWasOpen.current = true;
              return;
            }
            if (!menuWasOpen.current) return;
            menuWasOpen.current = false;
            commitAfterMenu();
          }}
        />
      </div>
      <MarkdownPasteDialog
        editor={editor}
        markdown={pendingMarkdownPaste}
        onClose={() => setPendingMarkdownPaste(null)}
      />
    </>
  );
}

export function LightweightNode({ data, selected }: NodeProps<LightweightFlowNode>) {
  const { t } = useTranslation();
  const node = data.node;
  const language = useSettingsStore((state) => state.language);
  const writingLanguage = resolveWritingLanguage({ app: language });
  const colorPreview = useNodeColorPreview(node.id);
  const editorReadOnly = useCanvasStore((state) => state.editorReadOnly);
  const interactivityLocked = useCanvasStore((state) => state.interactivityLocked);
  const beginLiveChange = useCanvasStore((state) => state.beginLiveChange);
  const resizeNodeLive = useCanvasStore((state) => state.resizeNodeLive);
  const endLiveChange = useCanvasStore((state) => state.endLiveChange);
  const editingNodeId = useCanvasStore((state) => state.editingNodeId);
  const beginNodeEdit = useCanvasStore((state) => state.beginNodeEdit);
  const endNodeEdit = useCanvasStore((state) => state.endNodeEdit);
  const updateTextNode = useCanvasStore((state) => state.updateTextNode);
  const editing = editingNodeId === node.id;
  const pristine = useCanvasStore((state) => state.pristineTextNode?.id === node.id);
  const activateLink = useLinkActivation();
  const [openLink, setOpenLink] = useState<{ href: string; index: number } | null>(null);
  // The Link under the pointer at a right click. Only a pointer gesture reads
  // it: a keyboard or long-press menu open never landed on a Link.
  const contextLinkRef = useRef<CanvasNodeLink | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const linkPointerStart = useRef<{ x: number; y: number } | null>(null);
  const html = node.kind === "text" ? node.html : null;
  const links = useMemo(() => textNodeLinks(html), [html]);
  const nodeMenu = useCanvasNodeMenu(node.id, {
    isDisabled: editorReadOnly || interactivityLocked || editing,
    // While editing, the editor's own menu owns the right click.
    links: editing ? [] : links,
    contextLinkRef,
    onOpenLink: (link) => {
      const external = activateLink(link.href);
      if (external) setOpenLink({ href: external, index: link.index });
    },
  });
  const safeHtml = useMemo(() => (html === null ? "" : prepareStaticCanvasHtml(html)), [html]);
  const blank = useMemo(() => html !== null && isBlankTextNodeHtml(html), [html]);

  if (node.kind !== "text") return null;

  const resizable = !editorReadOnly && !interactivityLocked && !editing;
  const backgroundColor = colorPreview?.backgroundColor ?? node.backgroundColor;

  const handleStaticContentClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    event.preventDefault();
    // A drag that selected the Link's text ends in a click too; keep the selection.
    if (!(document.getSelection()?.isCollapsed ?? true)) return;
    const start = linkPointerStart.current;
    linkPointerStart.current = null;
    // A press that moved dragged the node; it is not a Link activation.
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
    openStaticLink(anchor);
  };

  const openStaticLink = (anchor: Element) => {
    const href = anchor.getAttribute("href");
    if (!href) return;
    const anchors = Array.from(contentRef.current?.querySelectorAll("a[href]") ?? []);
    const external = activateLink(href);
    if (external) setOpenLink({ href: external, index: anchors.indexOf(anchor) });
  };

  const handleStaticPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    linkPointerStart.current = { x: event.clientX, y: event.clientY };
  };

  const removeOpenLink = () => {
    if (!openLink) return;
    // The index came from the Links the node shows; the same sanitizer order
    // maps it back to the stored anchor, so an href the policy rejects is
    // skipped rather than unwrapped by mistake.
    const link = canvasLinkAnchors(node.html)[openLink.index];
    if (link) {
      const { anchor } = link;
      const body = anchor.ownerDocument.body;
      anchor.replaceWith(...Array.from(anchor.childNodes));
      updateTextNode(node.id, { html: body.innerHTML });
    }
    setOpenLink(null);
  };

  return (
    <div
      ref={nodeMenu.setOwnerRef}
      {...nodeMenu.itemProps}
      className={`group relative min-h-24 ${blank ? "min-w-40" : "min-w-24"} transform-gpu ${node.width ? "w-full" : "max-w-72"} ${pristine ? "nodrag nopan" : ""} rounded-lg px-3 py-2 text-sm text-foreground ${
        editing ? "" : "pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]"
      } ${selected ? "ring-1 ring-primary/40" : ""}`}
      style={backgroundColor ? { backgroundColor } : undefined}
      onDoubleClick={() => !editorReadOnly && beginNodeEdit(node.id)}
      // The padding below a new node's first line reads as part of its text box.
      // A press there must keep the editor focused, or the blur would drop the node.
      onMouseDown={pristine ? (event) => event.preventDefault() : undefined}
      onContextMenu={(event) => {
        const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
        // Only a pointer gesture lands on a Link. Its position among the drawn
        // anchors carries its identity, so two Links with the same href and text
        // stay apart.
        const anchors = Array.from(contentRef.current?.querySelectorAll("a[href]") ?? []);
        const index = anchor ? anchors.indexOf(anchor) : -1;
        contextLinkRef.current =
          anchor && index >= 0
            ? { href: anchor.getAttribute("href") ?? "", text: anchor.textContent ?? "", index }
            : null;
        nodeMenu.itemProps.onContextMenu?.(event);
        // The browser menu never appears on a Text Node: while editing the
        // editor's own menu owns the gesture, at rest the node's menu (or, in a
        // read-only Canvas, its Link entries) is the only one.
        event.preventDefault();
      }}
    >
      <CanvasNodeHandles connectedSides={data.connectedSides} variant="text" selected={selected} />
      {nodeMenu.menu}
      {resizable &&
        (["left", "right"] as const).map((side) => (
          <NodeResizeControl
            key={side}
            position={side}
            variant={ResizeControlVariant.Line}
            resizeDirection="horizontal"
            minWidth={CANVAS_TEXT_NODE_MIN_WIDTH}
            className={`nodrag z-0! w-1! rounded-full! border-0! bg-primary! transition-opacity ${
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            onResizeStart={beginLiveChange}
            onResize={(_event, params) =>
              resizeNodeLive(node.id, {
                position: { x: params.x, y: params.y },
                width: params.width,
              })
            }
            onResizeEnd={endLiveChange}
          />
        ))}
      {editing ? (
        <ActiveNodeEditor
          node={node}
          onDone={endNodeEdit}
          onExit={() => {
            // Unmount the editor first, then focus the node it lived in, so
            // Escape leaves the keyboard author on the node rather than on the
            // document body.
            flushSync(endNodeEdit);
            nodeMenu.anchorRef.current?.focus();
          }}
        />
      ) : blank ? (
        <div className="canvas-node-content max-w-none text-muted-foreground">
          {t("canvas.textNodePlaceholder")}
        </div>
      ) : (
        // biome-ignore lint/a11y/useKeyWithClickEvents: a Link at rest follows a pointer click; its keyboard route is the node's Shift+F10 menu, which lists the Links.
        <div
          ref={contentRef}
          className="canvas-node-content max-w-none"
          lang={writingLanguage}
          style={textColorStyle(colorPreview?.textColor ?? node.textColor)}
          onClick={handleStaticContentClick}
          onPointerDown={handleStaticPointerDown}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: canvas node HTML is sanitized with DOMPurify above
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      )}
      {openLink && (
        <LinkActivationDialog
          url={openLink.href}
          onClose={() => setOpenLink(null)}
          onRemove={editorReadOnly || interactivityLocked ? undefined : removeOpenLink}
        />
      )}
    </div>
  );
}
