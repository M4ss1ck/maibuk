/**
 * The shared Plugin identity namespace both contribution registries build on.
 * A Plugin id is a lowercase slug; a local id is camelCase unique within its
 * Plugin and contribution kind. The host derives every full contribution id
 * as `plugin.<pluginId>.<localId>`, so a declaration can never name another
 * owner's contribution. Renames are local-only maps collapsed the same way
 * everywhere.
 */

export const PLUGIN_PREFIX = "plugin.";

export const PLUGIN_ID_SOURCE = "[a-z0-9-]{3,64}";
export const LOCAL_ID_SOURCE = "[a-z][a-zA-Z0-9]{0,47}";

export const PLUGIN_ID_PATTERN = new RegExp(`^${PLUGIN_ID_SOURCE}$`);
export const LOCAL_ID_PATTERN = new RegExp(`^${LOCAL_ID_SOURCE}$`);

const FULL_ID_PATTERN = new RegExp(`^plugin\\.(${PLUGIN_ID_SOURCE})\\.(${LOCAL_ID_SOURCE})$`);

/** A derived Plugin contribution id: `plugin.<pluginId>.<localId>`. */
export type PluginContributionId = `plugin.${string}.${string}`;

/** The shape of a derived Plugin contribution id, registered or not. */
export function isPluginContributionId(value: string): value is PluginContributionId {
  return FULL_ID_PATTERN.test(value);
}

export function pluginIdOfContribution(value: string): string | null {
  return FULL_ID_PATTERN.exec(value)?.[1] ?? null;
}

export function localIdOfContribution(value: string): string | null {
  return FULL_ID_PATTERN.exec(value)?.[2] ?? null;
}

/**
 * Collapses a Plugin's rename chains (a→b, b→c becomes a→c) and refuses what a
 * manifest cannot express: a target outside the Plugin, a target that is not
 * declared, a source that is, and cycles. `kind` names the contribution in
 * errors ("button", "row").
 */
export function collapseContributionRenames(
  renames: Readonly<Record<string, string>>,
  declared: ReadonlySet<string>,
  kind: string
): Readonly<Record<string, string>> {
  for (const [from, to] of Object.entries(renames)) {
    if (!LOCAL_ID_PATTERN.test(from) || !LOCAL_ID_PATTERN.test(to)) {
      throw new Error(
        `Plugin ${kind} rename "${from}" targets "${to}", which is not a Plugin-local id`
      );
    }
    if (declared.has(from)) {
      throw new Error(`Plugin ${kind} rename source "${from}" is a declared ${kind}`);
    }
    if (!declared.has(to)) {
      throw new Error(
        `Plugin ${kind} rename "${from}" targets "${to}", which is not a declared ${kind}`
      );
    }
  }
  const collapsed: Record<string, string> = {};
  for (const from of Object.keys(renames)) {
    const seen = new Set<string>([from]);
    let target = renames[from];
    while (renames[target] !== undefined) {
      if (seen.has(target)) throw new Error(`Plugin ${kind} rename for "${from}" cycles`);
      seen.add(target);
      target = renames[target];
    }
    collapsed[from] = target;
  }
  return collapsed;
}
