import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { ReplaceStep, type Step } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

declare module "@tiptap/core" {
  interface Storage {
    taskListOrder: TaskListOrderStorage;
  }

  interface Commands<ReturnType> {
    taskListOrder: {
      /** Moves checked items up at every level of the list at `pos` (default: where the selection starts). */
      moveCheckedToTop: (pos?: number) => ReturnType;
      /** Moves checked items down at every level of the list at `pos` (default: where the selection starts). */
      moveCheckedToBottom: (pos?: number) => ReturnType;
    };
  }
}

export type CheckedOrder = "top" | "bottom";

const TASK_LIST = "taskList";
const TASK_ITEM = "taskItem";

/**
 * The Task List an action on `pos` reorders: climbs through directly nested
 * lists, and stops at anything else, so a Task List inside a bullet list is its
 * own list.
 */
export function outermostTaskListAt(
  doc: ProseMirrorNode,
  pos: number
): { node: ProseMirrorNode; from: number } | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  let depth = $pos.depth;
  while (depth > 0 && $pos.node(depth).type.name !== TASK_LIST) depth -= 1;
  if (depth === 0) return null;
  while (
    depth >= 2 &&
    $pos.node(depth - 1).type.name === TASK_ITEM &&
    $pos.node(depth - 2).type.name === TASK_LIST
  ) {
    depth -= 2;
  }
  return { node: $pos.node(depth), from: $pos.before(depth) };
}

/** The list in this order at every level; the same node when nothing would move. */
function ordered(list: ProseMirrorNode, order: CheckedOrder): ProseMirrorNode {
  const leading: ProseMirrorNode[] = [];
  const trailing: ProseMirrorNode[] = [];
  list.forEach((item) => {
    const group = (item.attrs.checked === true) === (order === "top") ? leading : trailing;
    group.push(orderedItem(item, order));
  });
  const items = [...leading, ...trailing];
  if (items.every((item, index) => item === list.child(index))) return list;
  return list.copy(Fragment.fromArray(items));
}

function orderedItem(item: ProseMirrorNode, order: CheckedOrder): ProseMirrorNode {
  const children: ProseMirrorNode[] = [];
  item.forEach((child) => {
    children.push(child.type.name === TASK_LIST ? ordered(child, order) : child);
  });
  if (children.every((child, index) => child === item.child(index))) return item;
  return item.copy(Fragment.fromArray(children));
}

export function canMoveChecked(doc: ProseMirrorNode, pos: number, order: CheckedOrder): boolean {
  const list = outermostTaskListAt(doc, pos);
  return list !== null && ordered(list.node, order) !== list.node;
}

/** An item's identity across a reorder: its content, whatever order its nested lists are in. */
function itemKey(item: ProseMirrorNode): string {
  const children: string[] = [];
  item.forEach((child) => {
    if (child.type.name !== TASK_LIST) {
      children.push(JSON.stringify(child));
      return;
    }
    const nested: string[] = [];
    child.forEach((nestedItem) => {
      nested.push(itemKey(nestedItem));
    });
    children.push(`[${nested.sort().join(",")}]`);
  });
  return `${JSON.stringify(item.attrs)}${children.join("")}`;
}

interface MovedRange {
  from: number;
  to: number;
  delta: number;
}

/**
 * Pairs each item with where it landed. Identical items pair in document order,
 * which a stable reorder keeps. False when `after` is not `before` reordered.
 */
function collectMoves(
  before: ProseMirrorNode,
  beforeStart: number,
  after: ProseMirrorNode,
  afterStart: number,
  moves: MovedRange[]
): boolean {
  if (before.childCount !== after.childCount) return false;
  const waiting = new Map<string, { item: ProseMirrorNode; pos: number }[]>();
  before.forEach((item, offset) => {
    const key = itemKey(item);
    const queue = waiting.get(key) ?? [];
    queue.push({ item, pos: beforeStart + offset });
    waiting.set(key, queue);
  });

  let matched = true;
  after.forEach((item, offset) => {
    const origin = matched ? waiting.get(itemKey(item))?.shift() : undefined;
    if (!origin) {
      matched = false;
      return;
    }
    const pos = afterStart + offset;
    moves.push({
      from: origin.pos,
      to: origin.pos + origin.item.nodeSize,
      delta: pos - origin.pos,
    });
    // Children line up by index: the key holds them in order and at equal sizes.
    item.forEach((child, childOffset, childIndex) => {
      if (child.type.name !== TASK_LIST) return;
      matched &&= collectMoves(
        origin.item.child(childIndex),
        origin.pos + 2 + childOffset,
        child,
        pos + 2 + childOffset,
        moves
      );
    });
  });
  return matched;
}

/** Where a reorder step sends a position, or null when the step is not a reorder of one list. */
function moveMapForStep(doc: ProseMirrorNode, step: Step): ((pos: number) => number) | null {
  if (!(step instanceof ReplaceStep)) return null;
  const { from, to, slice } = step;
  const after = slice.content.firstChild;
  if (
    !after ||
    after.type.name !== TASK_LIST ||
    slice.content.childCount !== 1 ||
    slice.openStart !== 0 ||
    slice.openEnd !== 0 ||
    after.nodeSize !== to - from
  ) {
    return null;
  }
  const before = doc.nodeAt(from);
  if (!before || before.type !== after.type || before.nodeSize !== to - from) return null;

  const moves: MovedRange[] = [];
  if (!collectMoves(before, from + 1, after, from + 1, moves)) return null;
  return (pos) => {
    if (pos <= from || pos >= to) return pos;
    // A nested item's range is listed after its parent's, and wins.
    let delta = 0;
    for (const move of moves) {
      if (pos >= move.from && pos < move.to) delta = move.delta;
    }
    return pos + delta;
  };
}

/**
 * Where this transaction sends a position when it only reorders a Task List:
 * the move itself, its undo, or its redo. A reorder replaces the whole list, so
 * `tr.mapping` collapses every position inside it.
 */
export function taskListMoveMap(tr: Transaction): ((pos: number) => number) | null {
  return tr.steps.length === 1 ? moveMapForStep(tr.docs[0], tr.steps[0]) : null;
}

function moveChecked(tr: Transaction, pos: number | undefined, order: CheckedOrder): boolean {
  const list = outermostTaskListAt(tr.doc, pos ?? tr.selection.from);
  if (!list) return false;
  const next = ordered(list.node, order);
  if (next === list.node) return false;

  const { selection, doc } = tr;
  const step = new ReplaceStep(
    list.from,
    list.from + list.node.nodeSize,
    new Slice(Fragment.from(next), 0, 0)
  );
  const moved = moveMapForStep(doc, step);
  tr.step(step);
  if (moved) {
    if (selection instanceof TextSelection) {
      tr.setSelection(TextSelection.create(tr.doc, moved(selection.anchor), moved(selection.head)));
    } else if (selection instanceof NodeSelection) {
      tr.setSelection(NodeSelection.create(tr.doc, moved(selection.from)));
    }
  }
  // One undo step, even right after typing.
  closeHistory(tr);
  return true;
}

interface TaskListDecorations {
  lists: { from: number; to: number }[];
  active: number;
  decorations: DecorationSet;
}

const taskListOrderKey = new PluginKey<TaskListDecorations>("taskListOrder");

let slotCounter = 0;

/** The elements the ⋯ buttons portal into (`TaskListMenus`); never part of the document. */
export interface TaskListOrderStorage {
  slots: Set<HTMLElement>;
  onSlotsChange: Set<() => void>;
}

function createMenuSlot(): HTMLElement {
  const slot = document.createElement("div");
  slot.className = "task-list-menu";
  slot.contentEditable = "false";
  slotCounter += 1;
  slot.dataset.taskListMenu = String(slotCounter);
  return slot;
}

function findOutermostLists(doc: ProseMirrorNode): TaskListDecorations["lists"] {
  const lists: TaskListDecorations["lists"] = [];
  doc.descendants((node, pos, parent) => {
    if (node.isTextblock) return false;
    if (node.type.name === TASK_LIST && parent?.type.name !== TASK_ITEM) {
      lists.push({ from: pos, to: pos + node.nodeSize });
    }
    return true;
  });
  return lists;
}

/** The list the action at the caret would reorder; a later match is the one nested deeper. */
function activeList(lists: TaskListDecorations["lists"], state: EditorState | Transaction): number {
  const { from } = state.selection;
  let active = -1;
  lists.forEach((list, index) => {
    if (list.from < from && from < list.to) active = index;
  });
  return active;
}

function decorate(
  doc: ProseMirrorNode,
  lists: TaskListDecorations["lists"],
  active: number,
  storage: TaskListOrderStorage
): DecorationSet {
  const changed = () => {
    for (const listener of storage.onSlotsChange) listener();
  };
  const decorations: Decoration[] = [];
  lists.forEach((list, index) => {
    decorations.push(
      Decoration.node(list.from, list.to, {
        class: index === active ? "task-list-root task-list-caret" : "task-list-root",
      }),
      // One key for all: ProseMirror keeps the slot's element across edits, so
      // React's portal and an open menu survive them.
      Decoration.widget(
        list.from + 1,
        () => {
          // ProseMirror can rebuild its DOM with no transaction, so the slots
          // report themselves rather than being looked for after an update.
          const slot = createMenuSlot();
          storage.slots.add(slot);
          changed();
          return slot;
        },
        {
          side: -1,
          key: "task-list-menu",
          ignoreSelection: true,
          stopEvent: () => true,
          destroy: (slot) => {
            storage.slots.delete(slot as HTMLElement);
            changed();
          },
        }
      )
    );
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Moves the checked items of a Task List (a one-off rewrite of the document,
 * not a held Sort), and marks each outermost list with a slot for its ⋯ button.
 */
export const TaskListOrder = Extension.create<Record<string, never>, TaskListOrderStorage>({
  name: "taskListOrder",

  addStorage() {
    return { slots: new Set(), onSlotsChange: new Set() };
  },

  addCommands() {
    const command =
      (order: CheckedOrder) =>
      (pos?: number) =>
      ({ tr, dispatch }: { tr: Transaction; dispatch?: unknown }) => {
        if (!this.editor.isEditable) return false;
        if (dispatch) return moveChecked(tr, pos, order);
        return canMoveChecked(tr.doc, pos ?? tr.selection.from, order);
      };
    return {
      moveCheckedToTop: command("top"),
      moveCheckedToBottom: command("bottom"),
    };
  },

  addProseMirrorPlugins() {
    const { editor, storage } = this;
    return [
      new Plugin<TaskListDecorations>({
        key: taskListOrderKey,
        state: {
          init: (_config, state) => {
            const lists = findOutermostLists(state.doc);
            const active = activeList(lists, state);
            return { lists, active, decorations: decorate(state.doc, lists, active, storage) };
          },
          apply: (tr, prev) => {
            const lists = tr.docChanged ? findOutermostLists(tr.doc) : prev.lists;
            const active = activeList(lists, tr);
            if (!tr.docChanged && active === prev.active) return prev;
            return { lists, active, decorations: decorate(tr.doc, lists, active, storage) };
          },
        },
        props: {
          decorations(state) {
            if (!editor.isEditable) return DecorationSet.empty;
            return taskListOrderKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
