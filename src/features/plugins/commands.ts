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
import type { PluginLifecycle } from "@/features/plugins/types";
import type { RunnableBinding } from "@/lib/command-runner";
import { PLUGIN_COMMAND_PREFIX, type CommandId } from "@/lib/shortcut-registry";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";

/** The item a Plugin Command acts on, from the Item Menu that supplied it. */
export interface PluginItemTarget {
  kind: PluginTarget;
  id: string;
}

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

/**
 * One binding per registered Command of every installed Plugin: a page's
 * navigating Command navigates (host behavior, available whenever the Plugin
 * is installed); every other Command is enabled only once its Plugin is ready
 * and, when it needs a target, only through an Item Menu binding.
 */
export function pluginCommandBindings(
  lifecycle: PluginLifecycle,
  navigate: (route: string) => void
): RunnableBinding[] {
  const bindings: RunnableBinding[] = [];
  for (const installed of lifecycle.installed()) {
    const ready = lifecycle.state(installed.pluginId)?.status === "ready";
    for (const command of getPluginCommands(installed.pluginId)) {
      if (command.pageId !== undefined) {
        const route = pluginPageRoute(installed.pluginId, command.pageId);
        bindings.push({ id: command.id, enabled: true, onTrigger: () => navigate(route) });
        continue;
      }
      const hasTargets = (command.targets?.length ?? 0) > 0;
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
