// src/components/editor/extensions/HeadingId.ts
import { combineTransactionSteps, Extension, getChangedRanges } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { deriveHeadingIds, newHeadingId } from "@/features/links/heading-ids";

interface HeadingEntry {
  pos: number;
  node: ProseMirrorNode;
}

function collectHeadings(doc: ProseMirrorNode, from = 0, to = doc.content.size): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "heading") headings.push({ pos, node });
    return !node.isTextblock;
  });
  return headings;
}

/** Stored ids stay; a heading without one gets its derived id (`deriveHeadingIds`). */
function derivedIds(doc: ProseMirrorNode): Map<number, string> {
  const headings = collectHeadings(doc);
  const ids = deriveHeadingIds(
    headings.map(({ node }) => ({ id: node.attrs.id as string | null, text: node.textContent }))
  );
  return new Map(headings.map(({ pos }, index) => [pos, ids[index]]));
}

function setHeadingIds(tr: Transaction, ids: Map<number, string>): boolean {
  let changed = false;
  for (const [pos, id] of ids) {
    const node = tr.doc.nodeAt(pos);
    if (!node || node.attrs.id === id) continue;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
    changed = true;
  }
  return changed;
}

const headingIdPluginKey = new PluginKey("headingId");

interface HeadingIdOptions {
  /** Name id-less headings when content opens. Off where leaving unedited text writes it back. */
  nameOnOpen: boolean;
}

/**
 * Gives every heading a persisted `id` so it can be linked to and doubles as an
 * export anchor. Opening content names its id-less headings with the same
 * derived ids the link picker and resolver compute from the stored HTML, without
 * counting as an edit; the next save stores them. Headings an edit creates get
 * an id at once, and a split or pasted copy never keeps its original's id.
 */
export const HeadingId = Extension.create<HeadingIdOptions>({
  name: "headingId",

  addOptions() {
    return { nameOnOpen: true };
  },

  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          id: {
            default: null,
            parseHTML: (element) => element.getAttribute("id"),
            renderHTML: (attributes) => (attributes.id ? { id: attributes.id } : {}),
          },
        },
      },
    ];
  },

  onCreate() {
    if (!this.options.nameOnOpen) return;
    const { state, view } = this.editor;
    const tr = state.tr;
    if (!setHeadingIds(tr, derivedIds(state.doc))) return;
    view.dispatch(
      tr
        .setMeta("preventUpdate", true)
        .setMeta("addToHistory", false)
        .setMeta("metrics:programmatic", true)
    );
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: headingIdPluginKey,
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          // Only the changed ranges are read per keystroke; the whole document
          // is walked only when a heading needs an id or a paste may copy one.
          const touched = new Map<number, ProseMirrorNode>();
          const transform = combineTransactionSteps(oldState.doc, [...transactions]);
          for (const { newRange } of getChangedRanges(transform)) {
            for (const { pos, node } of collectHeadings(newState.doc, newRange.from, newRange.to)) {
              touched.set(pos, node);
            }
          }
          if (touched.size === 0) return null;

          const ids = new Map<number, string>();
          for (const [pos, node] of touched) ids.set(pos, node.attrs.id as string);
          if ([...touched.values()].some((node) => !node.attrs.id)) {
            for (const [pos, id] of derivedIds(newState.doc)) {
              if (touched.has(pos)) ids.set(pos, id);
            }
          }

          const copied = transactions.some((tr) =>
            ["paste", "drop"].includes(tr.getMeta("uiEvent") as string)
          );
          const taken = new Set<string>();
          if (copied) {
            for (const { pos, node } of collectHeadings(newState.doc)) {
              if (!touched.has(pos) && node.attrs.id) taken.add(node.attrs.id as string);
            }
          }
          for (const pos of [...ids.keys()].sort((a, b) => a - b)) {
            let id = ids.get(pos) as string;
            while (taken.has(id)) id = newHeadingId();
            taken.add(id);
            ids.set(pos, id);
          }

          const tr = newState.tr;
          return setHeadingIds(tr, ids) ? tr : null;
        },
      }),
    ];
  },
});
