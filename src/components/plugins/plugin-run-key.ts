/**
 * A stable key per `PluginRuntime` object (#454): its first use assigns the
 * next number, so a Plugin restart — a fresh runtime — gets a different key.
 * The Remote UI boundary and the Frame surface share it, so a restarted Plugin
 * remounts either surface instead of reusing the old connection or Frame.
 */

import type { PluginRuntime } from "@/features/plugins/types";

const runKeys = new WeakMap<PluginRuntime, number>();
let nextRunKey = 0;

export function pluginRunKey(runtime: PluginRuntime): number {
  let key = runKeys.get(runtime);
  if (key === undefined) {
    nextRunKey += 1;
    key = nextRunKey;
    runKeys.set(runtime, key);
  }
  return key;
}
