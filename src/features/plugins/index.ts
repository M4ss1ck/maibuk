// The Plugins feature's public API. Three kinds of caller import leaf files
// instead. `src/lib/db/` and the Backup service import `tables.ts`, because
// this barrel reaches `storage.ts`, which imports the database: a cycle. The
// shortcut registry imports `ids.ts`, because `manifest-validate.ts` imports
// the registry: a cycle. The Settings rows and toolbar config import `ids.ts`
// so that they do not load the database through `storage.ts`.
// `api-codegen.ts` is build tooling for `pnpm generate:plugin-api`.

export {
  LOCAL_ID_PATTERN,
  PLUGIN_ID_PATTERN,
  PLUGIN_PREFIX,
  PluginRenameError,
  collapseContributionRenames,
  isPluginContributionId,
  localIdOfContribution,
  pluginIdOfContribution,
} from "@/features/plugins/ids";
export {
  compareSemver,
  isValidRange,
  parseSemver,
  rangeRelation,
  satisfiesRange,
} from "@/features/plugins/semver";
export {
  MANIFEST_LANGUAGES,
  PLUGIN_PLATFORMS,
  PLUGIN_TARGETS,
  buildPluginManifestJsonSchema,
  builtInPluginManifestSchema,
  pluginManifestSchema,
} from "@/features/plugins/manifest-schema";
export {
  CONTRIBUTION_LIMITS,
  MAX_LOCALE_BYTES,
  MAX_MANIFEST_BYTES,
  PLUGIN_PERMISSION_NAMES,
  applyPluginLocale,
  parsePluginLocale,
  parsePluginManifest,
  validateManifestValue,
} from "@/features/plugins/manifest-validate";
export { checkPluginCompatibility, diffPluginPermissions } from "@/features/plugins/manifest-compat";
export {
  PLUGIN_DATA_VERSIONS_TABLE,
  PLUGIN_STORAGE_TABLE,
  PLUGIN_TABLES,
} from "@/features/plugins/tables";
export {
  clearPluginStorage,
  deletePluginStorageValue,
  getPluginDataSize,
  getPluginDataVersion,
  getPluginStorageValue,
  listPluginStorageKeys,
  setPluginDataVersion,
  setPluginStorageValue,
} from "@/features/plugins/storage";
export {
  PLUGIN_API_EVENTS,
  PLUGIN_API_NAMESPACES,
  PLUGIN_API_RESERVED_NAMESPACES,
  PLUGIN_API_TABLE,
  PLUGIN_API_VERSION,
  projectMcpTools,
} from "@/features/plugins/api-table";
export {
  CALL_BURST,
  CALL_RATE_PER_SECOND,
  THROTTLE_GAP_MS,
  THROTTLE_STOP_MS,
  createPluginBroker,
} from "@/features/plugins/broker";
export type * from "@/features/plugins/types";
