import { useEffect, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/core";
import { COMMANDS, COMMAND_IDS, type CommandDef } from "@/lib/shortcut-registry";
import { registerCommandSource, type RunnableBinding } from "@/lib/command-runner";
import {
  EDITOR_COMMANDS,
  canRunEditorCommand,
  runEditorCommand,
} from "@/components/editor/editor-commands";
import { setSelectionKept } from "@/components/editor/extensions/SelectionKept";
import { useCommandPaletteStore } from "@/features/command-palette/store";

let lastFocused: Editor | null = null;
const listeners = new Set<() => void>();

function setLastFocused(editor: Editor | null): void {
  if (lastFocused === editor) return;
  lastFocused = editor;
  for (const listener of listeners) listener();
}

function subscribeToLastFocused(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Remembers the editor that most recently held focus. */
export function noteEditorFocused(editor: Editor): void {
  setLastFocused(editor);
}

/** Forgets the editor when it unmounts. */
export function forgetEditor(editor: Editor): void {
  if (lastFocused === editor) setLastFocused(null);
}

/**
 * True for an editor no surface has focused yet, and for the one focused last,
 * so a second mounted editor does not take the first one's keys.
 */
export function useIsActiveEditor(editor: Editor | null): boolean {
  const getSnapshot = () => editor !== null && (lastFocused === editor || lastFocused === null);
  return useSyncExternalStore(subscribeToLastFocused, getSnapshot, getSnapshot);
}

/** The last focused editor, for tests. */
export function lastFocusedEditor(): Editor | null {
  return lastFocused;
}

export function editorCommandBindings(editor: Editor): RunnableBinding[] {
  if (lastFocused !== editor || editor.isDestroyed) return [];
  const bindings: RunnableBinding[] = [];
  for (const id of COMMAND_IDS) {
    if (id === "dictation.stop") continue;
    const definition: CommandDef = COMMANDS[id];
    if (definition.source !== "editor-keymap") continue;
    if (!EDITOR_COMMANDS[id]) continue;
    bindings.push({
      id,
      enabled: canRunEditorCommand(editor, id),
      onTrigger: () => {
        editor.commands.focus();
        runEditorCommand(editor, id);
      },
    });
  }
  return bindings;
}

export function useEditorCommandSource(editor: Editor | null): void {
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const getBindings = () => editorCommandBindings(editor);
    const unregister = registerCommandSource(getBindings);
    const onFocus = () => noteEditorFocused(editor);
    editor.on("focus", onFocus);
    // A host that focused the editor in a layout effect (a Text Node) did so
    // before this subscription, so no focus event will follow.
    if (editor.isFocused) noteEditorFocused(editor);
    const unsubscribePalette = useCommandPaletteStore.subscribe((state, previous) => {
      if (state.isOpen && !previous.isOpen && lastFocused === editor) {
        setSelectionKept(editor, true);
      }
    });
    return () => {
      editor.off("focus", onFocus);
      forgetEditor(editor);
      unregister();
      unsubscribePalette();
    };
  }, [editor]);
}
