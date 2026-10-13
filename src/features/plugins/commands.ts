/**
 * Runs a Plugin's Command from the host side. A Command's declaration is a
 * metadata thing (see `contributions.ts`); this module is what turns an
 * invocation into either host navigation (a page's navigating Command) or one
 * `command.run` request to the ready Plugin's broker.
 *
 * The item a Command acts on is captured before the request goes out and what
 * goes out is that captured target: a Command invoked on Chapter A while
 * focus moves to Chapter B still runs against A, and an invocation whose
 * target is already invalid is cancelled rather than guessed (the Command
 * decision, #397). When the caller supplies `readTarget`, it is re-read once
 * after the broker answers, and a changed or vanished target cancels the
 * outcome instead of reporting that it ran. The Item Menu path supplies one
 * that reads whether the item still exists; the live editor and selection
 * tracking of the #397 contract arrives with the focused editor reads (#441)
 * and matters when results apply to items (#452).
 */

import {
  getPluginCommands,
  pluginPageRoute,
  type PluginTarget,
} from "@/features/plugins/contributions-registry";
import {
  EMPTY_PLUGIN_ITEM_CONTEXT,
  resolvePluginTarget,
  type PluginItemContext,
} from "@/features/plugins/target-context";
import type { PluginLifecycle } from "@/features/plugins/types";
import type { RunnableBinding } from "@/lib/command-runner";
import { PLUGIN_COMMAND_PREFIX, type CommandId } from "@/lib/shortcut-registry";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";

/** The item a Plugin Command acts on, from the Item Menu that supplied it. */
export interface PluginItemTarget {
  kind: PluginTarget;
  id: string;
}

/**
 * A Plugin Command's runnable binding. A screen binding that also declares an
 * item Context carries `deferToOtherSource`, so a focused item row's binding for
 * the same Command runs it instead (#446).
 */
export type PluginCommandBinding = RunnableBinding & { deferToOtherSource?: boolean };

export type PluginCommandOutcome = "ran" | "unavailable" | "cancelled" | "refused";

/** The full id of one of a Plugin's declared Commands. */
export function pluginCommandId(pluginId: string, localId: string): CommandId {
  return `${PLUGIN_COMMAND_PREFIX}${pluginId}.${localId}` as CommandId;
}

/**
 * Sends one `command.run` to the ready Plugin's broker and reports the
 * outcome. The target is captured before the request goes out and it is that
 * captured target the Plugin receives, even if focus moved meanwhile. With
 * `readTarget`, it is read once before sending (a null there cancels before
 * anything is sent) and re-read once after the broker answers: a change while
 * the request was pending cancels before any result is applied. Callers
 * re-reading only what the invocation already knew get a constant fixture
 * behavior; the Item Menu path re-reads live state (whether the item still
 * exists) and the toolbar path supplies no target at all (its buttons stay
 * disabled for Commands that need one, #395).
 */
export async function runPluginCommand(
  lifecycle: PluginLifecycle,
  pluginId: string,
  localId: string,
  options: { target?: PluginItemTarget; readTarget?: () => PluginItemTarget | null } = {}
): Promise<PluginCommandOutcome> {
  const runtime = lifecycle.runtime(pluginId);
  if (runtime === null) return "unavailable";
  let target: PluginItemTarget | null;
  if (options.readTarget !== undefined) {
    target = options.readTarget();
    if (target === null) return "cancelled";
  } else {
    target = options.target ?? null;
  }
  try {
    await runtime.broker.request(PLUGIN_COMMAND_RUN_REQUEST, {
      id: localId,
      ...(target !== null ? { target } : {}),
    });
  } catch {
    return "refused";
  }
  // Editor-dependent work is cancelled if its editor or selection changed: the
  // result is never applied to the new target.
  if (options.readTarget !== undefined) {
    const after = options.readTarget();
    if (after === null || after.kind !== target?.kind || after.id !== target?.id) {
      return "cancelled";
    }
  }
  return "ran";
}

const ITEM_COMMAND_CONTEXTS = new Set<string>(["chapterItem", "noteItem", "canvasNode"]);

/**
 * The Contexts whose Plugin Commands already run from their focused item:
 * `useItemCommands` binds them while the row has focus (`ChapterList`,
 * `NoteListItem`, `CanvasNodeMenu`). A Command whose Contexts are all of these
 * keeps its item-only binding, so the screen binding does not also run it —
 * that would run the same Command twice, once with the focused row's target
 * and once with the editor's current item, and could redirect it (#397).
 */
function isItemOnlyContext(contexts: readonly string[]): boolean {
  return contexts.length > 0 && contexts.every((context) => ITEM_COMMAND_CONTEXTS.has(context));
}

/**
 * One binding per registered Command of every installed Plugin: a page's
 * navigating Command navigates (host behavior, available whenever the Plugin
 * is installed); a target Command that declares a screen Context is enabled
 * when its Plugin is ready and the context-target resolver finds the item the
 * author is in, and runs against that item; every other Command is enabled
 * once its Plugin is ready. When such a Command also declares an item Context,
 * its screen binding yields to the focused item row's binding for the same
 * Command, so one key press runs it once against the row's item (#446).
 *
 * `readContext` is read at run time, so a Command that loses its item before
 * it fires does nothing: the resolver returns null and no `command.run` goes
 * out. The target is captured once, at invocation, and is the target the
 * Plugin receives even if focus moves while the request is in flight (the
 * #397 contract). The Item Menu path is unchanged: it supplies its own
 * captured target and live re-check.
 */
export function pluginCommandBindings(
  lifecycle: PluginLifecycle,
  navigate: (route: string) => void,
  readContext: () => PluginItemContext = () => EMPTY_PLUGIN_ITEM_CONTEXT
): PluginCommandBinding[] {
  const bindings: PluginCommandBinding[] = [];
  for (const installed of lifecycle.installed()) {
    const ready = lifecycle.state(installed.pluginId)?.status === "ready";
    for (const command of getPluginCommands(installed.pluginId)) {
      if (command.pageId !== undefined) {
        const route = pluginPageRoute(installed.pluginId, command.pageId);
        bindings.push({ id: command.id, enabled: true, onTrigger: () => navigate(route) });
        continue;
      }
      const targets = command.targets;
      const hasTargets = (targets?.length ?? 0) > 0;
      if (hasTargets && !isItemOnlyContext(command.contexts)) {
        // The same Command may also be bound by its focused item row
        // (`useItemCommands`). The row is the more specific Context and what the
        // author pointed at, so the screen binding yields to it for that key
        // press; with no such row it is the one that runs, #446.
        const hasItemContext = command.contexts.some((context) =>
          ITEM_COMMAND_CONTEXTS.has(context)
        );
        bindings.push({
          id: command.id,
          enabled: ready && resolvePluginTarget(targets, readContext()) !== null,
          deferToOtherSource: hasItemContext,
          onTrigger: () => {
            const target = resolvePluginTarget(targets, readContext());
            if (target === null) return;
            void runPluginCommand(lifecycle, installed.pluginId, command.localId, { target });
          },
        });
        continue;
      }
      bindings.push({
        id: command.id,
        enabled: ready && !hasTargets,
        onTrigger: () => {
          void runPluginCommand(lifecycle, installed.pluginId, command.localId);
        },
      });
    }
  }
  return bindings;
}

/** One installed Plugin's Commands whose Context is that Plugin's page. */
export function pluginPageCommands(
  pluginId: string,
  pageId: string
): { localId: string; id: CommandId }[] {
  const context = `${PLUGIN_COMMAND_PREFIX}${pluginId}.${pageId}`;
  return getPluginCommands(pluginId)
    .filter((command) => command.contexts.includes(context))
    .map((command) => ({ localId: command.localId, id: command.id }));
}

/** The bindings a Plugin page adds for the Commands in its own Context. */
export function pluginPageCommandBindings(
  lifecycle: PluginLifecycle,
  pluginId: string,
  pageId: string
): RunnableBinding[] {
  const ready = lifecycle.state(pluginId)?.status === "ready";
  return pluginPageCommands(pluginId, pageId).map((command) => ({
    id: command.id,
    enabled: ready,
    onTrigger: () => {
      void runPluginCommand(lifecycle, pluginId, command.localId);
    },
  }));
}
