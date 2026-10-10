/**
 * Every named type of the Plugins feature. A type derived from a runtime value
 * (a Zod schema, the method table, a const list) is declared here through a
 * type-only import, so the value stays the single source of truth.
 */
import type { z } from "zod";
import type { PLUGIN_API_EVENTS, PLUGIN_API_TABLE } from "@/features/plugins/api-table";
import type { pluginManifestSchema } from "@/features/plugins/manifest-schema";
import type { PLUGIN_PERMISSION_NAMES } from "@/features/plugins/manifest-validate";
import type { PluginMessagePort } from "@/plugin-sdk/protocol";

// Identity (ids.ts)

/** A derived Plugin contribution id: `plugin.<pluginId>.<localId>`. */
export type PluginContributionId = `plugin.${string}.${string}`;

/** Why a Plugin rename map was refused; the caller maps it to a field path. */
export type PluginRenameProblem =
  | "not-local-id"
  | "source-declared"
  | "target-undeclared"
  | "cycle";

// Versions (semver.ts, manifest-compat.ts)

export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

export type RangeRelation = "in-range" | "wants-newer" | "wants-older";

/** What the host provides: its Plugin API version and its Release number. */
export interface PluginHostVersions {
  /** The Plugin API version this app implements, e.g. `0.3.0`. */
  apiVersion: string;
  /** The app's Release, e.g. `0.11.0`. */
  appVersion: string;
}

export type PluginCompatibilityReason = "api-version" | "min-app-version";

/**
 * `ok`: the Plugin can run. `needs-newer-app`: the Plugin wants a newer API or
 * app than this one. `older-api`: the app has moved past the API the Plugin
 * was built for. `message` is plain-language diagnostic text for tooling
 * (`plugin:check`, logs); in-app copy is localized from the verdict and reason.
 */
export type PluginCompatibility =
  | { verdict: "ok" }
  | { verdict: "needs-newer-app"; reason: PluginCompatibilityReason; message: string }
  | { verdict: "older-api"; reason: "api-version"; message: string };

/** One permission in a diff, with the requirement it holds in its own version. */
export interface PluginPermissionChange {
  permission: string;
  /** Required in the manifest the entry describes (new for added, old for removed). */
  required: boolean;
}

export interface PluginPermissionDiff {
  added: PluginPermissionChange[];
  removed: PluginPermissionChange[];
  nowRequired: PluginPermissionChange[];
  nowOptional: PluginPermissionChange[];
}

// Manifest (manifest-schema.ts, manifest-validate.ts)

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginPermissions = PluginManifest["permissions"];
type Contributions = NonNullable<PluginManifest["contributes"]>;
export type PluginCommandContribution = NonNullable<Contributions["commands"]>[number];
export type PluginPageContribution = NonNullable<Contributions["pages"]>[number];
export type PluginSidebarEntryContribution = NonNullable<Contributions["sidebarEntries"]>[number];
export type PluginSettingsRowContribution = NonNullable<Contributions["settingsRows"]>[number];
export type PluginToolbarButtonContribution = NonNullable<Contributions["toolbarButtons"]>[number];
export type PluginItemMenuEntryContribution = NonNullable<
  Contributions["itemMenuEntries"]
>[number];
export type PluginLifecycle = PluginManifest["lifecycle"];

/** One of the eight exact Plugin Permission names. */
export type PluginPermissionName = (typeof PLUGIN_PERMISSION_NAMES)[number];

/** A Plugin Permission as a manifest declares it: an exact name or `network:<host>`. */
export type PluginPermissionId = PluginPermissionName | `network:${string}`;

/** One refused field: where it is, and why in plain language. */
export interface ManifestProblem {
  /** A dot/bracket path such as `contributes.commands[0].label`, or "" for the file. */
  path: string;
  message: string;
}

export type ManifestValidation =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; problems: ManifestProblem[] };

export interface ManifestValidationOptions {
  /** A Built-in Plugin may use the reserved `maibuk-` prefix; `tutorial-` stays refused. */
  builtIn?: boolean;
}

/** A Plugin's UI-string overrides for one language, by field path. */
export type PluginLocale = Readonly<Record<string, string | readonly string[]>>;

export type LocaleValidation =
  | { ok: true; locale: PluginLocale }
  | { ok: false; problems: ManifestProblem[] };

// Plugin API (api-table.ts)

/**
 * `network` means "a granted `network:<host>` matching the request URL";
 * `null` means ungated (rate-limited instead).
 */
export type PluginApiPermission = PluginPermissionName | "network" | null;

export type PluginApiEffect = "read" | "write";

export interface PluginApiRow<
  Id extends string = string,
  Input extends z.ZodType = z.ZodType,
  Output extends z.ZodType = z.ZodType,
  Chunk extends z.ZodType | undefined = z.ZodType | undefined,
> {
  id: Id;
  description: string;
  input: Input;
  output: Output;
  /**
   * A streamed body: after the call resolves with `output`, the host sends
   * chunks of this shape until the stream ends.
   */
  chunk?: Chunk;
  permission: PluginApiPermission;
  effect: PluginApiEffect;
  /** Refused with `library-unavailable` while the Library cannot be read or written. */
  requiresLibrary?: boolean;
  /** At most one accepted call per this many milliseconds, per Plugin. */
  minIntervalMs?: number;
}

/**
 * An event the host sends to subscribed Plugins. Events only invalidate: the
 * payload carries ids, never content (ADR 0022).
 */
export interface PluginApiEventRow<
  Id extends string = string,
  Payload extends z.ZodType = z.ZodType,
> {
  id: Id;
  description: string;
  payload: Payload;
  /** The read permission of the event's namespace, or `null` when ungated. */
  permission: PluginPermissionName | null;
}

export type PluginApiTable = typeof PLUGIN_API_TABLE;
export type PluginApiMethodId = PluginApiTable[number]["id"];
type RowOf<M extends PluginApiMethodId> = Extract<PluginApiTable[number], { id: M }>;
export type PluginApiInput<M extends PluginApiMethodId> = z.output<RowOf<M>["input"]>;
export type PluginApiOutput<M extends PluginApiMethodId> = z.input<RowOf<M>["output"]>;
export type PluginApiStreamingMethodId = {
  [M in PluginApiMethodId]: [NonNullable<RowOf<M>["chunk"]>] extends [never] ? never : M;
}[PluginApiMethodId];
export type PluginApiChunk<M extends PluginApiStreamingMethodId> = z.input<
  NonNullable<RowOf<M>["chunk"]>
>;

export type PluginApiEvents = typeof PLUGIN_API_EVENTS;
export type PluginApiEventId = PluginApiEvents[number]["id"];
export type PluginApiEventPayload<E extends PluginApiEventId> = z.input<
  Extract<PluginApiEvents[number], { id: E }>["payload"]
>;

export interface McpToolProjection {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean };
}

// Broker (broker.ts)

export type PluginStopReason = "throttled" | "requested";

export interface PluginHandlerContext {
  pluginId: string;
}

/** What a streaming method's handler returns: the response, then its body. */
export interface PluginStreamResult<Output, Chunk> {
  result: Output;
  body: AsyncIterable<Chunk>;
}

export type PluginApiHandlers = {
  [M in PluginApiMethodId]?: (
    params: PluginApiInput<M>,
    context: PluginHandlerContext
  ) => M extends PluginApiStreamingMethodId
    ?
        | Promise<PluginStreamResult<PluginApiOutput<M>, PluginApiChunk<M>>>
        | PluginStreamResult<PluginApiOutput<M>, PluginApiChunk<M>>
    : Promise<PluginApiOutput<M>> | PluginApiOutput<M>;
};

export interface PluginBrokerOptions {
  pluginId: string;
  port: PluginMessagePort;
  /** Every Plugin Permission the manifest declares, required and optional. */
  declared: readonly PluginPermissionId[];
  /** The Plugin Permissions granted right now; read on every call and event. */
  granted: () => Iterable<PluginPermissionId>;
  handlers?: PluginApiHandlers;
  /** False while the Library cannot be read or written (Library rows refuse). */
  isLibraryAvailable?: () => boolean;
  onStop?: (reason: PluginStopReason) => void;
  now?: () => number;
  /** The method table; tests pass an extended copy to prove a new row needs no other change. */
  table?: readonly PluginApiRow[];
  /** The event table, replaceable for the same reason. */
  events?: readonly PluginApiEventRow[];
}

export interface PluginBroker {
  /** Sends a host to Plugin request; settles on the Plugin's first reply with its id. */
  request(method: string, params: unknown): Promise<unknown>;
  /**
   * Delivers an event if the Plugin subscribed to it and still holds its
   * Plugin Permission. Returns whether it was sent. Throws when the payload
   * breaks the event's schema, so content can never leak through an event.
   */
  emit<E extends PluginApiEventId>(event: E, payload: PluginApiEventPayload<E>): boolean;
  stop(reason: PluginStopReason): void;
  readonly stopped: boolean;
}
