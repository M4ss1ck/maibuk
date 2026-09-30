import { useModalStore } from "@/components/ui/modal-store";
import { isTutorialStatusActive, useTutorialStore } from "@/features/tutorial/store";
import { getCommand, type CommandId } from "@/lib/shortcut-registry";

export type CommandRunSource = "voice" | "palette";
export type CommandRunOutcome = "ran" | "unavailable" | "refused-dialog" | "refused-tutorial";

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

/** Commands runnable while a Tutorial run is under way; later tickets may add focus.* ones. */
export function isTutorialRunnable(id: CommandId): boolean {
  return id === "tutorial.skip";
}

export function runCommand(
  id: CommandId,
  _options: { source: CommandRunSource }
): CommandRunOutcome {
  void _options;
  if (isTutorialStatusActive(useTutorialStore.getState().status) && !isTutorialRunnable(id)) {
    return "refused-tutorial";
  }
  let binding: RunnableBinding | undefined;
  for (let i = sources.length - 1; i >= 0; i--) {
    binding = sources[i]().find(
      (candidate) => candidate.id === id && candidate.enabled !== false
    );
    if (binding) break;
  }
  if (!binding) return "unavailable";
  if (
    useModalStore.getState().modalIds.length > 0 &&
    !getCommand(id).contexts.includes("global")
  ) {
    return "refused-dialog";
  }
  binding.onTrigger();
  return "ran";
}
