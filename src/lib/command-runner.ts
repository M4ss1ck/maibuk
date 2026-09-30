import { useModalStore } from "@/components/ui/modal-store";
import { isTutorialStatusActive, useTutorialStore } from "@/features/tutorial/store";
import { getCommand, type CommandId } from "@/lib/shortcut-registry";

export type CommandRunSource = "voice" | "palette";
export type CommandRunOutcome =
  | "ran"
  | "unavailable"
  | "refused-dialog"
  | "refused-dialog-close"
  | "refused-tutorial";

export interface RunnableBinding {
  id: CommandId;
  enabled?: boolean;
  onTrigger: (event?: KeyboardEvent) => void;
}

const sources: Array<() => readonly RunnableBinding[]> = [];

/** Registers a source of bindings; the getter is read at run time. Returns unregister. */
export function registerCommandSource(
  getBindings: () => readonly RunnableBinding[]
): () => void {
  sources.push(getBindings);
  return () => {
    const index = sources.indexOf(getBindings);
    if (index >= 0) sources.splice(index, 1);
  };
}

/** Commands runnable while a Tutorial run is under way; focus.* keys are the browser's own. */
export function isTutorialRunnable(id: CommandId): boolean {
  return id === "tutorial.skip" || id.startsWith("focus.");
}

function findBinding(id: CommandId): RunnableBinding | undefined {
  for (let i = sources.length - 1; i >= 0; i--) {
    const binding = sources[i]().find(
      (candidate) => candidate.id === id && candidate.enabled !== false
    );
    if (binding) return binding;
  }
  return undefined;
}

/** Navigating Commands close open dialogs first; the rest run over them. */
export async function runCommand(
  id: CommandId,
  _options: { source: CommandRunSource }
): Promise<CommandRunOutcome> {
  void _options;
  if (isTutorialStatusActive(useTutorialStore.getState().status) && !isTutorialRunnable(id)) {
    return "refused-tutorial";
  }
  if (!findBinding(id)) return "unavailable";
  if (useModalStore.getState().modalIds.length > 0) {
    // Focus keys are the browser's own: they run inside the dialog.
    if (id.startsWith("focus.")) {
      findBinding(id)?.onTrigger();
      return "ran";
    }
    const command = getCommand(id);
    const isGlobal = command.contexts.includes("global");
    // A non-navigating global Command runs over the open dialog.
    if (isGlobal && !command.navigates) {
      findBinding(id)?.onTrigger();
      return "ran";
    }
    // A navigating global Command closes dialogs first, topmost first.
    if (isGlobal && command.navigates) {
      for (;;) {
        const { modalIds, closers } = useModalStore.getState();
        if (modalIds.length === 0) break;
        const topmost = modalIds[modalIds.length - 1];
        const close = closers[topmost];
        if (!close) return "refused-dialog-close";
        close();
        let closed = !useModalStore.getState().modalIds.includes(topmost);
        for (let attempt = 0; !closed && attempt < 10; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          closed = !useModalStore.getState().modalIds.includes(topmost);
        }
        if (!closed) return "refused-dialog-close";
      }
      // Re-read the live binding after closing: it may have changed.
      const binding = findBinding(id);
      if (!binding) return "unavailable";
      binding.onTrigger();
      return "ran";
    }
    return "refused-dialog";
  }
  findBinding(id)?.onTrigger();
  return "ran";
}
