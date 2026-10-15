/**
 * Every named type of the Plugins feature. A type derived from a runtime value
 * (a Zod schema, the method table, a const list) is declared here through a
 * type-only import, so the value stays the single source of truth.
 */
import type { z } from "zod";
import type { PLUGIN_API_EVENTS, PLUGIN_API_TABLE } from "@/features/plugins/api-table";
import type { pluginManifestSchema } from "@/features/plugins/manifest-schema";
import type { PLUGIN_PERMISSION_NAMES } from "@/features/plugins/manifest-validate";
import type { PluginDirectoryAdapter, PluginFetchAdapter } from "@/lib/platform/types";
import type { PluginUiViolation } from "@/features/plugins/remote-ui/validate";
import type { PluginMessagePort, PluginStartReason } from "@/plugin-sdk/protocol";

// Identity (ids.ts)

/** A derived Plugin contribution id: `plugin.<pluginId>.<localId>`. */
export type PluginContributionId = `plugin.${string}.${string}`;

// Plugin Directory (directory-hash.ts, the platform adapters)

/** One file in a Plugin folder, keyed by its POSIX-relative path. */
export interface PluginFolderFile {
  path: string;
  bytes: Uint8Array;
}

/** A Plugin folder as the Plugin Directory listed it. */
export interface PluginFolder {
  /** The folder's name in the Plugin Directory. */
  name: string;
  files: PluginFolderFile[];
  /**
   * The `h1:` hash the Platform computed while reading, when it computes one
   * (Rust on desktop and Android, ADR 0020). The runtime recomputes it over
   * the same bytes; the shared fixture keeps both implementations equal.
   */
  hash?: string;
}

// Entry loading (modules.ts)

/** One import site in a module's source, resolved to a target module path. */
export interface PluginImportSite {
  /** Start of the replaceable range in the module source. */
  start: number;
  /** End of the replaceable range: a static specifier excludes its quotes, a dynamic literal includes them. */
  end: number;
  /** `static` replaces with a bare URL, `dynamic` with a quoted one. */
  kind: "static" | "dynamic";
  /** The target module's POSIX-relative path within the Plugin folder. */
  target: string;
}

export interface PluginModulePlanEntry {
  path: string;
  source: string;
  imports: PluginImportSite[];
}

export type PluginModuleProblemCode =
  | "entry-missing"
  | "entry-not-module"
  | "not-a-module"
  | "missing-import"
  | "bare-import"
  | "url-import"
  | "dynamic-import"
  | "cyclic-import"
  | "invalid-source";

export interface PluginModuleProblem {
  code: PluginModuleProblemCode;
  /** The module the problem was found in. */
  path: string;
  /** The specifier as written, when the problem is about one. */
  specifier?: string;
  message: string;
}

/**
 * `modules` is in dependency order: every module appears before its importers,
 * and the entry is last.
 */
export type PluginModulePlan =
  | { ok: true; modules: PluginModulePlanEntry[] }
  | { ok: false; problems: PluginModuleProblem[] };

// Sandbox (sandbox.ts)

export interface PluginSandboxFrame {
  /** The hidden iframe, appended to the host document. */
  readonly element: HTMLIFrameElement;
  /** Resolves once the bootstrap is listening. */
  readonly ready: Promise<void>;
  /** Creates a `blob:` URL inside the frame for one module source. */
  createModule(source: string): Promise<string>;
  /** Starts the Worker from a frame-created URL and hands it the port. */
  startWorker(entryUrl: string, port: MessagePort): Promise<void>;
  /** Worker messages posted to the frame (readiness and heartbeats). */
  onWorkerMessage(handler: (data: unknown) => void): void;
  /** A Worker `error` event: the Plugin crashed or was killed. */
  onWorkerError(handler: (message: string) => void): void;
  /** Terminates the Worker and removes the frame. */
  stop(): void;
}

// Runtime (runtime.ts)

export type PluginStartRefusal =
  | { code: "hash-mismatch"; expected: string; actual: string }
  | { code: "hash-refused"; reason: "filename-newline"; path: string; message: string }
  | { code: "manifest-invalid"; problems: ManifestProblem[] }
  | { code: "module-refused"; problems: PluginModuleProblem[] }
  | { code: "startup-timeout" }
  | { code: "worker-error"; message: string }
  | { code: "health-check-failed"; message: string };

export interface PluginRuntime {
  manifest: PluginManifest;
  /** The host end of the Plugin's port: requests, events, and stop. */
  broker: PluginBroker;
  /** Stops the broker and removes the sandbox frame (terminating its Worker). */
  stop(): void;
}

export interface PluginStartOptions {
  folder: PluginFolder;
  /** The `h1:` value the author pinned when approving the Plugin. */
  pinnedHash: string;
  /**
   * Why this activation happened (#400, #445); the host announces it on the
   * Plugin's port as the init message. Omitted when a test starts a Plugin
   * directly.
   */
  startReason?: PluginStartReason;
  /** A Built-in Plugin may use the reserved `maibuk-` prefix (manifest validation). */
  builtIn?: boolean;
  /**
   * The Plugin Permissions granted right now; none by default. A provider is
   * read on every broker call, so revoking an optional grant refuses the next
   * call without restarting the Plugin (#442).
   */
  granted?: readonly PluginPermissionId[] | (() => Iterable<PluginPermissionId>);
  /** Builds the method handlers for this Plugin; a row without one refuses `not-implemented`. */
  handlers?: (manifest: PluginManifest) => PluginApiHandlers;
  /** False while the Library cannot be read or written (the Tutorial Library). */
  isLibraryAvailable?: () => boolean;
  /** Registers a `requiresLibrary` handler's work so the Tutorial switch settles it (ADR 0008, #398). */
  trackLibraryWork?: <T>(work: Promise<T>) => Promise<T>;
  /** The current payload of a replaying event, delivered on subscription. */
  eventSnapshot?: (event: string) => unknown;
  /** Injected by tests: jsdom has no Worker, and a fake frame proves the refusal order. */
  createFrame?: (document: Document, manifest: PluginManifest) => PluginSandboxFrame;
  /** The startup limit; tests pass a small one. */
  timeoutMs?: number;
  /**
   * A Worker error after readiness: the Plugin crashed or was killed. Startup
   * errors are refusals instead; this watcher exists only while it runs.
   */
  onWorkerError?: (message: string) => void;
  /** The broker stopped the Plugin itself (sustained throttling). */
  onBrokerStop?: (reason: PluginStopReason) => void;
  /** Observes calls arriving from the Plugin (the on-demand idle window resets on activity). */
  onCall?: (method: string) => void;
}

export type PluginStartResult =
  | { ok: true; plugin: PluginRuntime }
  | { ok: false; refusal: PluginStartRefusal };

// Built-in Plugins (builtin.ts)

/**
 * One Built-in Plugin the app ships: its manifest and the copy Maibuk bundles.
 * `files` carries the shipped bytes, so a replace can write them (the store
 * takes their digests for the review diff); `hash` is the `h1:` value over
 * exactly those bytes.
 */
export interface BuiltInPlugin {
  /** The Plugin id, which is also its folder name in the Plugin Directory. */
  id: string;
  manifest: PluginManifest;
  /** The `h1:` hash of the shipped copy. */
  hash: string;
  /** The shipped copy's files, with the bytes a replace writes. */
  files: PluginFolderFile[];
}

/** The Built-in Plugins this platform ships, read from the built-in source. */
export interface BuiltInPluginSource {
  list(): Promise<BuiltInPlugin[]>;
}

/**
 * One Built-in in the shipped `index.json` the build writes (script writer) and
 * the app reads: its manifest, shipped hash, and file paths.
 */
export interface BuiltInPluginIndexEntry {
  id: string;
  manifest: PluginManifest;
  /** The `h1:` directory hash over the built folder, as the app pins it. */
  hash: string;
  /** The built folder's POSIX-relative paths, sorted. */
  files: string[];
}

/** The shipped list the app installs from (`<outRoot>/index.json`). */
export interface BuiltInPluginIndex {
  plugins: BuiltInPluginIndexEntry[];
}

// Approvals (approvals.ts)

/** A Built-in Plugin's shipped copy, and a modified copy kept on purpose. */
export interface PluginApprovalBuiltIn {
  /** The hash of the copy Maibuk ships. */
  shippedHash: string;
  /** The shipped hash the author chose to keep their modified copy at. */
  keptModifiedHash?: string;
}

/**
 * The v2 approval record: the pinned copy, its Plugin Permissions, whether the
 * Plugin is enabled, and what the author reviewed. A v1 record (`granted` only)
 * migrates on read. Device-local: never synced, never in a Backup.
 */
export interface PluginApproval {
  /** The Plugin's folder name in the Plugin Directory. */
  pluginId: string;
  /** The `h1:` hash pinned at approval; a folder that changed stays off. */
  pinnedHash: string;
  /** The Plugin Permissions granted right now. */
  granted: PluginPermissionId[];
  /** Whether the Plugin starts; a disabled Plugin stays installed but off. */
  enabled: boolean;
  /** The manifest `version` the author approved; compared for "Older version". */
  approvedVersion: string;
  /** The manifest permissions as declared when this copy was approved. */
  approvedPermissions: { required: string[]; optional: string[] };
  /** The per-file lowercase hex SHA-256 the author approved, keyed by path. */
  approvedFiles: Record<string, string>;
  /** Present for a Built-in Plugin; absent for a third-party one. */
  builtIn?: PluginApprovalBuiltIn;
  /** The last startup failure, shown until the next successful start clears it. */
  startupError?: string;
  /**
   * The `h1:` hash of the last changed-files notification shown, so the same
   * change never notifies twice (#442).
   */
  notifiedHash?: string;
  /**
   * The shipped hash of the last Built-in update prompt shown, so the same
   * shipped hash never prompts twice (#442). Cleared when the copy is replaced.
   */
  notifiedBuiltInHash?: string;
}

/** What `enablePlugin` returns: the enabled record, or why it refused. */
export type PluginEnableResult =
  | { ok: true; approval: PluginApproval }
  | {
      ok: false;
      reason: "required-permissions-missing";
      /** The required Plugin Permissions the record does not grant. */
      missing: string[];
      /** The record, unchanged. */
      approval: PluginApproval;
    };

/**
 * What `approve` returns. A copy whose files changed (`review-required`) is
 * refused: it must go through the changed-files review (`markReviewed`), so an
 * inline permission toggle never re-pins and starts an unreviewed copy (#442).
 */
export type PluginApproveResult =
  | { ok: true }
  | { ok: false; reason: "review-required" }
  | { ok: false; reason: "copy-unavailable" };

// Review (review.ts)

/** Whether a copy needs the author's review before it may start again. */
export type PluginReviewStatus = "approved" | "review-required" | "not-approved";

/** The per-file diff a re-review shows, by POSIX-relative path. */
export interface PluginFileDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

/** The pure review of an installed copy against its approval record. */
export interface PluginReview {
  status: PluginReviewStatus;
  files: PluginFileDiff;
  /** The permission diff since approval, including `nowRequired`. */
  permissions: PluginPermissionDiff;
  /** True when the installed copy's version is older than the approved one. */
  olderVersion: boolean;
}

/** What a review reads: the record, the folder's current digests and pin, and the manifest. */
export interface PluginReviewInput {
  /** The stored approval, or null when the Plugin was never approved. */
  approval: PluginApproval | null;
  /** The folder's current per-file digests (`pluginFileDigests` output). */
  digests: ReadonlyMap<string, string>;
  /** The folder's current `h1:` hash. */
  hash: string;
  /** The manifest parsed from the folder now. */
  manifest: PluginManifest;
}

// Management (management.ts)

/** One non-blocking notification the store shows, at most one per Plugin (#442). */
export interface PluginNotification {
  pluginId: string;
  /** The Plugin's display name at the time of the change. */
  name: string;
  /**
   * The `h1:` hash the copy changed to, for a changed copy, or the shipped
   * hash that became available, for a Built-in update.
   */
  hash: string;
  /**
   * `changed`: the copy's files changed and it stays off until reviewed;
   * `available`: a Built-in update is offered (Keep my copy / Replace);
   * `size`: the Plugin's stored data passed the 50 MB warning (#401, #443).
   */
  kind: "changed" | "available" | "size";
}

/** One known Plugin as the management store lists it. */
export interface PluginManagementEntry {
  pluginId: string;
  manifest: PluginManifest;
  /** The approval record, or null for a copy never approved. */
  approval: PluginApproval | null;
  review: PluginReview;
  /** True while the lifecycle has a runtime for it. */
  running: boolean;
  /** True for a Built-in Plugin the app ships. */
  builtIn: boolean;
  /** True when a Built-in's installed copy differs from the shipped copy. */
  modified: boolean;
  /**
   * True when a modified Built-in's shipped copy changed since it was
   * installed or kept: an update is offered (never repeats per shipped hash).
   */
  updateAvailable: boolean;
  /** True while the Plugin's files are present in the Plugin Directory. */
  installed: boolean;
  /**
   * True when the author explicitly removed the Plugin and it has not come
   * back. The row stays, offering the retained state (#443).
   */
  removed: boolean;
  /**
   * True for a Built-in whose shipped copy is in the BuiltInPluginSource, whose
   * folder is absent, and whose manifest supports this device, so it can be
   * installed again (#443).
   */
  available: boolean;
  /**
   * True when the manifest's declared `platforms` exclude this device; the
   * Plugin is listed and explained but can never be enabled (#443).
   */
  unsupported: boolean;
  /**
   * The folder names in the Plugin Directory that declare this Plugin's id.
   * Two or more means neither is enableable, and Settings names them both
   * (#443).
   */
  duplicateFolders: string[];
  /**
   * The last limit or crash stop, shown as Stopped with its reason and a
   * Restart action; null while the Plugin has not been stopped this way (#443).
   */
  stopped: { reason: PluginLifecycleStopReason } | null;
}

/** The management store's dependencies; injected in tests. */
export interface PluginManagementOptions {
  /** Injected by tests; defaults to the platform's Plugin Directory. */
  directory?: PluginDirectoryAdapter;
  /** The app's one lifecycle; defaults to `getPluginLifecycle`. */
  lifecycle?: () => PluginLifecycle | null;
  /** The shipped Built-in Plugins; defaults to the production source (`[]`). */
  builtInSource?: BuiltInPluginSource;
  /** Shows the non-blocking notification; defaults to a no-op. The app renders the store's `notifications` through `PluginChangeNotices`. Injected by tests. */
  notify?: (notification: PluginNotification) => void;
  /**
   * Reports whether Plugin development mode is on; defaults to the device
   * setting (`useSettingsStore`). Injected by tests.
   */
  isDevelopmentMode?: () => boolean;
  /** The change debounce before a watched folder is read; defaults to 300 ms. */
  debounceMs?: number;
}

/** The Plugin management store: the orchestrator the Settings UI talks to (#442). */
export interface PluginManagement {
  /** Every known Plugin the Plugin Directory holds, by id. */
  plugins: Record<string, PluginManagementEntry>;
  /** The changed-files notifications shown now, at most one per Plugin. */
  notifications: PluginNotification[];
  /** Each Plugin's stored data size in bytes, as `refreshDataSize` last read it. */
  dataSizes: Record<string, number>;
  /** Re-reads the Plugin Directory and each copy's review state. */
  refresh(): Promise<void>;
  /**
   * Installs the Plugin a `.zip` the author picks carries, then refreshes.
   * Resolves the installed Plugin id (the folder name), or null when the
   * picker is cancelled or the adapter cannot install. An id whose known
   * record was removed comes back installed and still removed until the
   * author approves the new copy, so the #442 approval flow runs again and an
   * app update never silently reinstalls it. An adapter error rejects, for the
   * UI to toast (#443).
   */
  addFromZip(): Promise<string | null>;
  /**
   * Installs a Plugin from a folder the author picks (where the adapter offers
   * one), then refreshes, exactly like `addFromZip` (#443).
   */
  addFromFolder(): Promise<string | null>;
  /** Approves the current copy with the chosen optional grants and starts it. */
  approve(pluginId: string, optionalGranted?: readonly PluginPermissionId[]): Promise<PluginApproveResult>;
  /** Revokes one Plugin Permission; a required revoke disables and stops it. */
  revoke(pluginId: string, permission: PluginPermissionId): Promise<void>;
  /** Enables the copy when every required Plugin Permission is still granted. */
  enable(pluginId: string): Promise<void>;
  /** Disables the Plugin without removing it; it stops if running. */
  disable(pluginId: string): void;
  /** Restarts a stopped Plugin through the lifecycle, clearing the shown stop reason on success. */
  restart(pluginId: string): Promise<void>;
  /**
   * Approves the current copy: re-pins its hash, digests, version, and
   * permissions. `optionalGranted` replaces the optional grants kept from the
   * previous approval; omitted keeps the ones the copy still declares.
   */
  markReviewed(pluginId: string, optionalGranted?: readonly PluginPermissionId[]): Promise<void>;
  /**
   * Keeps a modified Built-in copy: sets `keptModifiedHash` to the shipped
   * hash, so that shipped hash never prompts again. Files and grants stay; the
   * "Update available" state is still reported (#442).
   */
  keepMyCopy(pluginId: string): Promise<void>;
  /**
   * Replaces a modified Built-in copy with the shipped copy. Requires an
   * explicit `confirmed` flag (the dialog is a later slice); without it it
   * refuses. Library data, credentials, and revoked grants stay as they are,
   * and the author's pin is re-pinned to the shipped copy (#442).
   */
  replaceBuiltIn(pluginId: string, confirmed: boolean): Promise<boolean>;
  /**
   * Removes a Plugin: stops it, deletes its folder(s), its approval, and its
   * startup error, marks its row removed, and — when `deleteData` — clears its
   * stored data. A Built-in's or third-party Plugin's files go; Library data
   * stays unless `deleteData`; Custom Shortcuts and Voice Commands are never
   * touched. The known row stays, `removed` true and not installed (#443).
   */
  remove(pluginId: string, options: { deleteData: boolean }): Promise<void>;
  /**
   * Deletes a removed Plugin's retained data, keeping its known row and
   * Command preferences, and refreshes the shown data size (#443).
   */
  deleteData(pluginId: string): Promise<void>;
  /**
   * Reinstalls a Built-in from the bundled copy: writes the shipped files,
   * clears the removed mark, and refreshes, so the untouched copy is
   * pre-granted again through the existing Built-in path. It never restores a
   * previous approval. Returns false for a third-party Plugin or a replace the
   * adapter refuses (#443).
   */
  reinstallBuiltIn(pluginId: string): Promise<boolean>;
  /** The Plugin's stored data size in bytes (#443). */
  dataSize(pluginId: string): Promise<number>;
  /**
   * Re-reads a Plugin's stored data size into `dataSizes` and, the first time
   * it passes 50 MB, shows one notification and records the warning on the
   * known row so it never repeats (#401, #443).
   */
  refreshDataSize(pluginId: string): Promise<void>;
  /** Shows one notification per (Plugin, changed hash); the same hash never repeats. */
  notifyChanged(pluginId: string, hash: string): void;
  /** Removes one Plugin's notification. */
  dismissNotification(pluginId: string): void;
}

// Launch (launch.ts)

export interface PluginLaunchRefusal {
  pluginId: string;
  refusal: PluginStartRefusal;
}

/** An approved Plugin the launch scan found, with its manifest parsed. */
export interface InstalledPlugin {
  /** The Plugin's id, which is also its folder name in the Plugin Directory. */
  pluginId: string;
  approval: PluginApproval;
  folder: PluginFolder;
  manifest: PluginManifest;
  /** True for a Built-in Plugin the shipped source lists (reserved `maibuk-` id). */
  builtIn?: boolean;
}

export interface PluginScanOptions {
  /** Injected by tests; defaults to the platform's Plugin Directory. */
  directory?: PluginDirectoryAdapter;
  /**
   * The shipped Built-in Plugins. A reserved `maibuk-` id it lists parses
   * under the Built-in schema; defaults to the production source (`[]`).
   */
  builtInSource?: BuiltInPluginSource;
}

export interface PluginScanResult {
  plugins: InstalledPlugin[];
  refusals: PluginLaunchRefusal[];
}

// Lifecycle (lifecycle.ts)

/**
 * Why a Plugin was activated: the manifest decision's reasons (#400) plus
 * `warmStart` and `restart` from the performance decision (#401). It lives in
 * the Plugin SDK (`src/plugin-sdk/protocol.ts`) because the host hands it to
 * the Worker on the init message; it is re-exported here so feature code keeps
 * one import.
 */
export type { PluginStartReason };

/**
 * Why a Plugin stopped. `requested` and `throttled` are the broker's own
 * reasons; the rest are the lifecycle's: the idle window, the startup limit,
 * the heartbeat, the Remote UI budget, a Worker out-of-memory, and a crash.
 */
export type PluginLifecycleStopReason =
  | PluginStopReason
  | "idle"
  | "startup-timeout"
  | "unresponsive"
  | "remote-ui-limit"
  | "out-of-memory"
  | "crashed";

/** The dataVersion gate's refusal: data preserved, activation refused (ADR 0023). */
export type PluginDataRefusal =
  | { code: "data-newer"; stored: number; manifest: number }
  | { code: "migration-failed"; from: number; message: string }
  /** The namespace's version record could not be read or written; nothing ran. */
  | { code: "data-version-unavailable"; message: string };

/** Why an activation did not happen. */
export type PluginActivationRefusal =
  | PluginStartRefusal
  | PluginDataRefusal
  /** The manifest cannot run on this app's Plugin API or Release (ADR 0022). */
  | { code: "incompatible"; compatibility: PluginCompatibility }
  | { code: "not-installed" }
  /**
   * The copy is not the one the author approved (#442): its files changed, or
   * it was never approved. Only `approved` copies start.
   */
  | { code: "review-required"; status: Exclude<PluginReviewStatus, "approved"> };

export type PluginActivationResult =
  | { ok: true; startReason: PluginStartReason }
  | { ok: false; refusal: PluginActivationRefusal };

export type PluginLifecycleState =
  | {
      status: "stopped";
      /** The stop reason; null when it never ran or activation was refused. */
      reason: PluginLifecycleStopReason | null;
      /** The activation refusal; null after a run that reached readiness. */
      refusal: PluginActivationRefusal | null;
    }
  | { status: "starting"; startReason: PluginStartReason }
  | { status: "ready"; startReason: PluginStartReason }
  | { status: "unavailable"; startReason: PluginStartReason; heartbeatMisses: number };

export interface PluginLifecycleChange {
  pluginId: string;
  /** The Plugin's display name, so a listener needs no manifest lookup. */
  name: string;
  state: PluginLifecycleState;
}

/** The dataVersion gate's storage; injectable for tests. */
export interface PluginDataVersions {
  get(pluginId: string): Promise<number | null>;
  set(pluginId: string, dataVersion: number): Promise<void>;
}

export interface PluginLifecycleOptions {
  /** Injected by tests; defaults to the platform's Plugin Directory. */
  directory?: PluginDirectoryAdapter;
  /**
   * The shipped Built-in Plugins. A reserved `maibuk-` id it lists parses
   * under the Built-in schema; defaults to the production source (`[]`).
   */
  builtInSource?: BuiltInPluginSource;
  /** Injected by tests: jsdom has no Worker. */
  createFrame?: (document: Document, manifest: PluginManifest) => PluginSandboxFrame;
  /** Builds the method handlers; defaults to the wired API subset. */
  handlers?: (manifest: PluginManifest) => PluginApiHandlers;
  /** False while the Library cannot be read or written (the Tutorial Library). */
  isLibraryAvailable?: () => boolean;
  /** Registers `requiresLibrary` handler work so the Tutorial switch settles it (ADR 0008, #398). */
  trackLibraryWork?: <T>(work: Promise<T>) => Promise<T>;
  /** Waits for accepted `requiresLibrary` handler work before a bulk Library replacement (ADR 0008, #398); defaults to the Tutorial switch's settle. */
  settleLibraryWork?: () => Promise<void>;
  /** The dataVersion gate's storage; defaults to the Plugin storage rows. */
  dataVersions?: PluginDataVersions;
  /**
   * Waits before the first persistent start: the Library open, the launch Auto
   * Sync, and the launch Backup. Injected by tests.
   */
  whenLaunchSettled?: () => Promise<void>;
  /** Schedules one start in idle time; defaults to `requestIdleCallback` with a timeout fallback. */
  scheduleIdle?: (work: () => void) => void;
  /** The stop toast text, or null for a silent stop. Defaults to the localized copy. */
  stopMessage?: (name: string, reason: PluginLifecycleStopReason) => string | null;
}

export interface PluginLifecycle {
  /** Waits for the launch gates, scans once, and starts persistent Plugins one at a time in idle time. */
  launch(): Promise<void>;
  /** Every approved Plugin the scan found, in scan order. */
  installed(): readonly InstalledPlugin[];
  /** True once launch has finished its one scan (or gave up trying): its registries hold every approved Plugin's contributions, so a page stops showing loading then. */
  launchScanned(): boolean;
  /** Runs when the launch scan settles, whether it registered Plugins or nothing. Returns unsubscribe. */
  onLaunchScanned(listener: () => void): () => void;
  /** A surface became reachable: an on-demand Plugin warm-starts. */
  surfaceReached(pluginId: string, surface: string): void;
  /** A surface is gone; the idle window starts when the last one goes. */
  surfaceLeft(pluginId: string, surface: string): void;
  /** Starts an installed Plugin now (enable, Restart, or a bulk reason). */
  start(pluginId: string, reason: PluginStartReason): Promise<PluginActivationResult>;
  /**
   * Registers one Plugin now, after the launch scan: reads its folder, parses
   * its manifest, registers its contributions, and starts it by the normal
   * warm-start rules (a persistent Plugin starts; an on-demand one waits for a
   * surface). Used when a Plugin is approved or enabled mid-session (#442).
   */
  install(pluginId: string, reason: PluginStartReason): Promise<PluginActivationResult>;
  /** Removes one Plugin's entry and contributions: disabling it (#442). */
  uninstall(pluginId: string): void;
  /** Stops a running Plugin; the broker's `requested` and the lifecycle's `idle` are silent. */
  stop(pluginId: string, reason?: PluginLifecycleStopReason): void;
  /** The Plugin's state, or null for an id the lifecycle has not seen. */
  state(pluginId: string): PluginLifecycleState | null;
  /** The running runtime; contributions and Command runs use its broker (#437). */
  runtime(pluginId: string): PluginRuntime | null;
  /** State changes, for contributions and Settings. */
  subscribe(listener: (change: PluginLifecycleChange) => void): () => void;
  /** Stops everything and drops every timer and listener. */
  dispose(): void;
}

// Test kit (test-kit.ts)

/** The in-memory Library the read handlers serve. */
export interface TestLibrary {
  books?: ReadonlyArray<PluginApiOutput<"library.books.list">[number]>;
  chapters?: ReadonlyArray<TestChapter>;
  notes?: ReadonlyArray<TestNote>;
  canvases?: ReadonlyArray<PluginApiOutput<"library.canvases.list">[number]>;
}

/** A Chapter the test host serves, with the content a `get` returns. */
export type TestChapter = PluginApiOutput<"library.chapters.list">[number] & {
  content?: PluginContent;
};

/** A Note the test host serves, with the content a `get` returns. */
export type TestNote = PluginApiOutput<"library.notes.list">[number] & {
  content?: PluginContent;
};

/** One `navigation.openEntity` a Plugin asked for, in order. */
export interface TestNavigation {
  entity: PluginEntityTarget;
  reveal?: PluginRevealRange;
}

/** One `navigation.openPage` a Plugin asked for, in order. */
export interface TestPageNavigation {
  pluginId: string;
  pageId: string;
}

export interface TestNotification {
  variant: string;
  message: string;
}

export interface TestHostOptions {
  manifest: PluginManifest;
  /** Granted Plugin Permissions; defaults to every declared one. */
  permissions?: readonly PluginPermissionId[];
  /** In-memory Library the read handlers serve. */
  library?: TestLibrary;
  /** The app language the host serves; defaults to `en`. */
  language?: string;
  /**
   * The storage the `storage.*` handlers serve, `Map<key, value>`. Share one
   * Map across two hosts to simulate a reload over the same device storage.
   */
  storage?: Map<string, unknown>;
  /**
   * The secrets the `secrets.*` handlers serve, `Map<name, value>`. Share one
   * Map across two hosts to simulate a reload over the same device storage. The
   * Plugin API stays write-only: no handler ever returns a value.
   */
  secrets?: Map<string, string>;
  /** The clipboard text `clipboard.readText` serves; defaults to empty. */
  clipboard?: string;
  /**
   * The fetch `network.fetch` uses. Give one to test a Plugin against a fake
   * server; without it the row refuses `not-implemented`, like any unwired row.
   * The host still injects a `secretHeaders` value from `secrets` and never
   * hands a value back to the Plugin.
   */
  fetch?: PluginFetchAdapter;
  /** UI-string overrides `renderPage` applies to the manifest before rendering. */
  locale?: PluginLocale;
  /**
   * Why this activation happened (#400, #445); the host delivers it to the
   * Plugin. Defaults to `enable`.
   */
  startReason?: PluginStartReason;
}

/**
 * One Plugin page `renderPage` opened: the host container it renders into, every
 * declaration the validator refused, and how to tear it back down.
 */
export interface TestPage {
  /** The host `div` the page's tree renders into, appended to `document.body`. */
  container: HTMLElement;
  /** Every declaration the validator refused while this page was open. */
  violations: PluginUiViolation[];
  /** Unmounts the host renderer and closes the mount; idempotent. */
  unmount(): void;
}

export interface TestHost {
  /** The Plugin-side port: hand it to the Plugin's setup. */
  port: MessagePort;
  /** The real broker over the in-process channel. */
  broker: PluginBroker;
  /** The activation start reason the host delivers to the Plugin. */
  startReason: PluginStartReason;
  /** The manifest, with any `locale` overrides already applied. */
  manifest: PluginManifest;
  /** Every `notifications.show` the Plugin asked for, in order. */
  notifications: TestNotification[];
  /** Every `navigation.openEntity` the Plugin asked for, in order. */
  navigations: TestNavigation[];
  /** Every `navigation.openPage` the Plugin asked for, in order. */
  pageNavigations: TestPageNavigation[];
  /** The app language the host serves right now. */
  language: string;
  /** The clipboard text the host holds; `clipboard.writeText` replaces it. */
  readonly clipboard: string;
  /** Replaces the clipboard text `clipboard.readText` serves. */
  setClipboard(text: string): void;
  /** The UI-string overrides this host carries, before they are applied. */
  locale: PluginLocale | null;
  /** Changes the granted Plugin Permissions; the next call reads them again. */
  setGranted(permissions: readonly PluginPermissionId[]): void;
  /** Publishes a language change to every subscribed Plugin. */
  setLanguage(language: string): void;
  /** Makes the Library available or unavailable, as the Tutorial does. */
  setLibraryAvailable(available: boolean): void;
  /**
   * Renders one of the Plugin's pages through the real host renderer, over a
   * fresh Remote UI mount, and resolves once the Plugin accepts it. Rejects when
   * the Plugin has no such page. Every page opened this way is unmounted by
   * `stop()` too.
   */
  renderPage(page: string): Promise<TestPage>;
  /**
   * Renders one Settings row body the Plugin serves, the way the host mounts it
   * inside Settings, and resolves once the Plugin accepts it. Rejects when the
   * Plugin serves no body for that row. Unmounted by `stop()` too.
   */
  renderSettingsRow(rowId: string): Promise<TestPage>;
  /**
   * Stops the Worker: stops the broker and severs every open Remote UI mount,
   * while leaving the host renderer mounted. This is what a stopped Worker
   * leaves behind — a host tree that can no longer receive a mutation or an
   * echo — and is how the overlay dismissal tests prove Escape does not wait
   * for the Worker.
   */
  stopWorker(): void;
  stop(): void;
}

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
export type PluginItemMenuEntryContribution = NonNullable<Contributions["itemMenuEntries"]>[number];
export type PluginDeclaredLifecycle = PluginManifest["lifecycle"];

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
  /**
   * The Plugin folder's POSIX-relative file paths, when the caller has them
   * (the runtime reads the folder before validating). A page's `frame` must
   * name a file in this set; omitted, the existence check is skipped and only
   * the path's shape is validated.
   */
  files?: readonly string[];
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
  /**
   * True when the host delivers the event's current value the moment a Plugin
   * subscribes, so a Plugin that starts after a change still learns it and no
   * change is missed between startup and subscription.
   */
  replays?: boolean;
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

// Plugin Library reads and navigation (library.ts, navigation.ts)

/** The plain text and sanitized HTML a content read returns. */
export interface PluginContent {
  text: string;
  html: string;
}

/** A Book as the Library read returns it; timestamps are milliseconds since the epoch. */
export interface PluginBook {
  id: string;
  title: string;
  subtitle: string | null;
  authorName: string;
  language: string;
  wordCount: number;
  updatedAt: number;
}

export interface PluginChapterSummary {
  id: string;
  bookId: string;
  title: string;
  order: number;
  parentId: string | null;
  wordCount: number;
  updatedAt: number;
}

export interface PluginNoteSummary {
  id: string;
  bookId: string | null;
  title: string;
  /** The Note's own language; null when the Note has none. */
  language: string | null;
  tags: string[];
  wordCount: number;
  updatedAt: number;
}

export interface PluginCanvasSummary {
  id: string;
  bookId: string | null;
  title: string;
  updatedAt: number;
}

export type PluginEntityKind = "book" | "chapter" | "note" | "canvas";

export interface PluginEntityTarget {
  kind: PluginEntityKind;
  id: string;
}

export interface PluginRevealRange {
  from: number;
  to: number;
}

/** The route an entity opens, with the editor state that opens it there. */
export interface PluginRoute {
  to: string;
  state?: { openChapterId?: string; reveal?: PluginRevealRange };
}

/** The app shell's `navigate`, without importing the router into the handlers. */
export type PluginNavigator = (to: string, options?: { state?: unknown }) => void;

// Plugin editor host (editor-host.ts, #441)

/** The highlight kinds the host renders with theme-safe tokens. */
export type PluginHighlightKind = PluginApiInput<"editor.setHighlights">["kind"];

/** One highlight range in plain-text offsets, with an optional accessible label. */
export type PluginHighlightRange = PluginApiInput<"editor.setHighlights">["ranges"][number];

/** One Plugin's highlight set of one kind for one editor. */
export interface PluginHighlightSet {
  kind: PluginHighlightKind;
  ranges: readonly PluginHighlightRange[];
}

export type PluginEditorContentResult = PluginApiOutput<"editor.getContent">;
export type PluginEditorSelectionResult = PluginApiOutput<"editor.getSelection">;
export type PluginEditorApplied = PluginApiOutput<"editor.reveal">;

/** What `navigation.openPage` reports: the page was opened, or it does not exist. */
export type PluginPageOpenResult = PluginApiOutput<"navigation.openPage">;

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
  /**
   * Registers a `requiresLibrary` handler's in-flight work so the Tutorial
   * switch can settle it before switching Libraries (ADR 0008, #398). Injected
   * by the lifecycle so the broker stays Tutorial-agnostic; defaults to running
   * the work untracked.
   */
  trackLibraryWork?: <T>(work: Promise<T>) => Promise<T>;
  /**
   * The current payload of a replaying event (`replays: true`), delivered to a
   * Plugin the moment it subscribes. Returns `undefined` when the event has no
   * current value to send.
   */
  eventSnapshot?: (event: string) => unknown;
  onStop?: (reason: PluginStopReason) => void;
  /** Observes a call arriving from the Plugin (the on-demand idle window resets on activity). */
  onCall?: (method: string) => void;
  now?: () => number;
  /** The method table; tests pass an extended copy to prove a new row needs no other change. */
  table?: readonly PluginApiRow[];
  /** The event table, replaceable for the same reason. */
  events?: readonly PluginApiEventRow[];
}

export interface PluginBroker {
  /**
   * Sends a host to Plugin request; settles on the Plugin's first reply with
   * its id. `transfer` lists the transferables handed to the Plugin with the
   * message, such as the MessagePort of a Remote UI mount.
   */
  request(method: string, params: unknown, transfer?: Transferable[]): Promise<unknown>;
  /**
   * Delivers an event if the Plugin subscribed to it and still holds its
   * Plugin Permission. Returns whether it was sent. Throws when the payload
   * breaks the event's schema, so content can never leak through an event.
   */
  emit<E extends PluginApiEventId>(event: E, payload: PluginApiEventPayload<E>): boolean;
  stop(reason: PluginStopReason): void;
  readonly stopped: boolean;
}
