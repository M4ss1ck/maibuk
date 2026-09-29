import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { FootnoteView } from "@/components/editor/FootnoteView";

export interface FootnoteOptions {
  HTMLAttributes: Record<string, unknown>;
  startIndex: number;
}

/**
 * Names one Footnote. Ids are meant to be unique, but a pasted copy keeps its
 * id, so `index` (its place among the document's Footnotes) picks the right
 * one; a stale index falls back to the first Footnote with the id.
 */
export interface FootnoteTarget {
  id: string;
  index?: number;
}

export interface FootnoteEntry {
  id: string;
  content: string;
  /** Place among the document's Footnotes, from 0. */
  index: number;
  pos: number;
}

export function collectFootnotes(doc: ProseMirrorNode): FootnoteEntry[] {
  const footnotes: FootnoteEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "footnote") return;
    footnotes.push({
      id: node.attrs.id,
      content: node.attrs.content,
      index: footnotes.length,
      pos,
    });
  });
  return footnotes;
}

/** Keys that tell apart Footnotes sharing an id (a pasted copy keeps its id). */
export function footnoteKeys(ids: readonly string[], prefix = ""): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    return `${prefix}${id}${count > 1 ? `#${count}` : ""}`;
  });
}

export function findFootnote(doc: ProseMirrorNode, target: FootnoteTarget): FootnoteEntry | null {
  const footnotes = collectFootnotes(doc);
  const atIndex = target.index === undefined ? undefined : footnotes[target.index];
  if (atIndex?.id === target.id) return atIndex;
  return footnotes.find((footnote) => footnote.id === target.id) ?? null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: {
      insertFootnote: (attributes: { content: string }) => ReturnType;
      updateFootnote: (target: FootnoteTarget, content: string) => ReturnType;
      deleteFootnote: (target: FootnoteTarget) => ReturnType;
    };
  }
}

export const Footnote = Node.create<FootnoteOptions>({
  name: "footnote",

  group: "inline",

  inline: true,

  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      startIndex: 1,
    };
  },

  addAttributes() {
    return {
      content: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-footnote-content") || "",
        renderHTML: (attributes: { content: string }) => ({
          "data-footnote-content": attributes.content,
        }),
      },
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-footnote-id"),
        renderHTML: (attributes: { id: string }) => ({
          "data-footnote-id": attributes.id,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "sup[data-footnote]", priority: 51 }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      "sup",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-footnote": "",
      }),
      "*",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteView);
  },

  addCommands() {
    return {
      insertFootnote:
        (attributes: { content: string }) =>
        ({ commands }: { commands: any }) => {
          const id = `fn-${Date.now()}`;
          return commands.insertContent({
            type: this.name,
            attrs: { ...attributes, id },
          });
        },
      updateFootnote:
        (target, content) =>
        ({ tr, dispatch }) => {
          const footnote = findFootnote(tr.doc, target);
          if (!footnote) return false;
          if (dispatch) tr.setNodeAttribute(footnote.pos, "content", content);
          return true;
        },
      deleteFootnote:
        (target) =>
        ({ tr, dispatch }) => {
          const footnote = findFootnote(tr.doc, target);
          if (!footnote) return false;
          if (dispatch)
            tr.delete(footnote.pos, footnote.pos + tr.doc.nodeAt(footnote.pos)!.nodeSize);
          return true;
        },
    };
  },
});
