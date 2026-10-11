/**
 * Runs a Plugin's Command from the host side. A Command's declaration is a
 * metadata thing (see `contributions.ts`); this module is what turns an
 * invocation into either host navigation (a page's navigating Command) or one
 * `command.run` request to the ready Plugin's broker.
 *
 * The intended target is captured before the request goes out and never
 * re-read: a Command invoked on Chapter A while focus moves to Chapter B runs
 * against A, and an invocation with no valid target is cancelled rather than
 * guessed (the Command decision, #397).
 */

import type { PluginTarget } from "@/features/plugins/contributions";
import { pluginPageRoute } from "@/features/plugins/contributions";
import type { InstalledPlugin, PluginLifecycle, PluginManifest } from "@/features/plugins/types";
import type { RunnableBinding } from "@/lib/command-runner";
import {
  PLUGIN_COMMAND_PREFIX,
  isCommandId,
  type CommandId,
} from "@/lib/shortcut-registry";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";

/** The item a Plugin Command acts on, from the Item Menu that supplied it. */
export interface PluginItemTarget {
  kind: PluginTarget;
  id: string;
}

export type PluginCommandOutcome = "ran" | "unavailable" | "cancelled" | "refused";

interface CommandMeta {
  /** The page this Command opens, when it is a page's navigating Command. */
  pageId?: string;
  /** The item kinds the Command acts on; absent means targetless. */
  targets?: readonly PluginTarget[];
}

function commandMeta(manifest: PluginManifest): Map<string, CommandMeta> {
  const meta = new Map<string, CommandMeta>();
  for (const page of manifest.contributes?.pages ?? []) {
    meta.set(page.command, { ...(meta.get(page.command) ?? {}), pageId: page.id });
  }
  for (const command of manifest.contributes?.commands ?? []) {
    if (command.targets === undefined) continue;
    meta.set(command.id, { ...(meta.get(command.id) ?? {}), targets: command.targets });
  }
  return meta;
}

/** The full id of one of a Plugin's declared Commands. */
export function pluginCommandId(pluginId: string, localId: string): CommandId {
  return `${PLUGIN_COMMAND_PREFIX}${pluginId}.${localId}` as CommandId;
}

/**
 * Sends one `command.run` to the ready Plugin's broker and reports the
 * outcome. `readTarget` (used by Item Menus) captures the target once; a null
 * there cancels before anything is sent, and the captured target is what the
 * Plugin receives even if focus moved meanwhile.
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
    return "ran";
  } catch {
    return "refused";
  }
}

/**
 * One binding per declared Command of every installed Plugin: a page's
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
    const meta = commandMeta(installed.manifest);
    for (const command of installed.manifest.contributes?.commands ?? []) {
      const id = pluginCommandId(installed.pluginId, command.id);
      // A Plugin whose contributions are not registered here (a platform it
      // does not run on) contributes no binding.
      if (!isCommandId(id)) continue;
      const info = meta.get(command.id);
      if (info?.pageId !== undefined) {
        const route = pluginPageRoute(installed.pluginId, info.pageId);
        bindings.push({ id, enabled: true, onTrigger: () => navigate(route) });
        continue;
      }
      const hasTargets = (info?.targets?.length ?? 0) > 0;
      bindings.push({
        id,
        enabled: ready && !hasTargets,
        onTrigger: () => {
          void runPluginCommand(lifecycle, installed.pluginId, command.id);
        },
      });
    }
  }
  return bindings;
}

/** One installed Plugin's Commands whose Context is that Plugin's page. */
export function pluginPageCommands(
  installed: InstalledPlugin,
  pageId: string
): { localId: string; id: CommandId }[] {
  const context = `${PLUGIN_COMMAND_PREFIX}${installed.pluginId}.${pageId}`;
  return (installed.manifest.contributes?.commands ?? [])
    .filter((command) => command.contexts.includes(context))
    .map((command) => ({
      localId: command.id,
      id: pluginCommandId(installed.pluginId, command.id),
    }));
}

/** The bindings a Plugin page adds for the Commands in its own Context. */
export function pluginPageCommandBindings(
  lifecycle: PluginLifecycle,
  installed: InstalledPlugin,
  pageId: string
): RunnableBinding[] {
  const ready = lifecycle.state(installed.pluginId)?.status === "ready";
  return pluginPageCommands(installed, pageId).map((command) => ({
    id: command.id,
    enabled: ready,
    onTrigger: () => {
      void runPluginCommand(lifecycle, installed.pluginId, command.localId);
    },
  }));
}
