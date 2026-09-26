import { Extension } from "@tiptap/core";
import type { MarkType, Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

export const DEFAULT_LINE_HEIGHT = "1.75";

// Canonical unitless ratio from a stored CSS value. Quotes are stripped so a
// value that was serialized into a style attribute round-trips. Percentages
// become ratios, and anything that is not a positive finite number (px, the
// `normal` keyword, zero, negatives, junk) has no block line height.
export function normalizeLineHeight(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim().replace(/['"]+/g, "");
  if (trimmed === "") {
    return null;
  }
  if (trimmed.endsWith("%")) {
    const percent = Number(trimmed.slice(0, -1));
    if (!Number.isFinite(percent) || percent <= 0) {
      return null;
    }
    return String(percent / 100);
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return String(numeric);
}

export type LineHeightOptions = {
  types: string[];
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lineHeight: {
      setLineHeight: (lineHeight: string) => ReturnType;
      unsetLineHeight: () => ReturnType;
    };
  }
}

// Paragraph, heading, and list items carry the block value. The value on a
// list item wins over its paragraphs, which is why the commands clear the
// direct-child paragraphs of a targeted list item.
const BLOCK_TYPES = ["paragraph", "heading", "listItem", "taskItem"];

type LineHeightTarget = {
  pos: number;
  node: ProseMirrorNode;
};

function isListItem(node: ProseMirrorNode | null | undefined): boolean {
  return node?.type.name === "listItem" || node?.type.name === "taskItem";
}

// Every textblock in the selection becomes a target. When the textblock's
// direct parent is a list item the target is that closest list item, never an
// outer one; otherwise the textblock must be a paragraph or heading.
function collectTargets(state: EditorState): LineHeightTarget[] {
  const targets = new Map<number, ProseMirrorNode>();

  const addTextblock = (pos: number) => {
    const $pos = state.doc.resolve(pos + 1);
    const textblock = $pos.parent;
    const parent = $pos.depth > 0 ? $pos.node($pos.depth - 1) : null;
    if (isListItem(parent)) {
      targets.set($pos.before($pos.depth - 1), parent as ProseMirrorNode);
      return;
    }
    if (textblock.type.name === "paragraph" || textblock.type.name === "heading") {
      targets.set(pos, textblock);
    }
  };

  if (state.selection.empty) {
    const { $from } = state.selection;
    if ($from.parent.isTextblock) {
      addTextblock($from.before($from.depth));
    }
  } else {
    state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
      if (node.isTextblock) {
        addTextblock(pos);
      }
    });
  }

  return Array.from(targets, ([pos, node]) => ({ pos, node }));
}

// Remove the LEGACY inline textStyle line height inside a target's content.
// A span that carries other text style attributes keeps them.
function clearLegacyLineHeight(
  tr: Transaction,
  targetPos: number,
  node: ProseMirrorNode,
  textStyleType: MarkType
): void {
  node.descendants((child, offset) => {
    if (!child.isText) {
      return;
    }
    const mark = child.marks.find((candidate) => candidate.type === textStyleType);
    if (!mark || !mark.attrs.lineHeight) {
      return;
    }
    const from = targetPos + 1 + offset;
    const to = from + child.nodeSize;
    const keepsOtherAttributes = Object.entries(mark.attrs).some(
      ([name, attrValue]) => name !== "lineHeight" && attrValue != null && attrValue !== ""
    );
    if (keepsOtherAttributes) {
      tr.addMark(from, to, textStyleType.create({ ...mark.attrs, lineHeight: null }));
    } else {
      tr.removeMark(from, to, textStyleType);
    }
  });
}

function applyLineHeight(state: EditorState, tr: Transaction, value: string | null): boolean {
  const targets = collectTargets(state);
  if (targets.length === 0) {
    return false;
  }

  for (const target of targets) {
    tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, lineHeight: value });

    if (isListItem(target.node)) {
      target.node.forEach((child, offset) => {
        if (child.type.name === "paragraph" && child.attrs.lineHeight != null) {
          tr.setNodeMarkup(target.pos + 1 + offset, undefined, {
            ...child.attrs,
            lineHeight: null,
          });
        }
      });
    }
  }

  const textStyleType = state.schema.marks.textStyle;
  if (textStyleType) {
    for (const target of targets) {
      clearLegacyLineHeight(tr, target.pos, target.node, textStyleType);
    }
  }

  return true;
}

export const LineHeight = Extension.create<LineHeightOptions>({
  name: "lineHeight",

  addOptions() {
    return {
      types: ["textStyle"],
    };
  },

  addGlobalAttributes() {
    return [
      {
        // LEGACY: existing documents store the value on an inline textStyle
        // span. It is parsed and re-rendered byte-for-byte, and nothing new
        // writes it.
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => element.style.lineHeight?.replace(/['"]+/g, ""),
            renderHTML: (attributes) => {
              if (!attributes.lineHeight) {
                return {};
              }
              return {
                style: `line-height: ${attributes.lineHeight}`,
              };
            },
          },
        },
      },
      {
        // BLOCK: the block node carries the value. A dedicated CSS custom
        // property drives list item spacing.
        types: BLOCK_TYPES,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => normalizeLineHeight(element.style.lineHeight),
            renderHTML: (attributes) => {
              if (attributes.lineHeight == null) {
                return {};
              }
              return {
                style: `line-height: ${attributes.lineHeight}; --line-height: ${attributes.lineHeight}`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight:
        (lineHeight: string) =>
        ({ state, tr, dispatch }) => {
          const value = normalizeLineHeight(lineHeight);
          if (value === null) {
            return false;
          }
          if (!applyLineHeight(state, tr, value)) {
            return false;
          }
          if (dispatch) {
            dispatch(tr);
          }
          return true;
        },
      unsetLineHeight:
        () =>
        ({ state, tr, dispatch }) => {
          if (!applyLineHeight(state, tr, null)) {
            return false;
          }
          if (dispatch) {
            dispatch(tr);
          }
          return true;
        },
    };
  },
});
