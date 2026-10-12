/**
 * Every named type of the Plugins feature. A type derived from a runtime value
 * (a Zod schema, the method table, a const list) is declared here through a
 * type-only import, so the value stays the single source of truth.
 */
import type { z } from "zod";
import type { PLUGIN_API_EVENTS, PLUGIN_API_TABLE } from "@/features/plugins/api-table";
import type { pluginManifestSchema } from "@/features/plugins/manifest-schema";
import type { PLUGIN_PERMISSION_NAMES } from "@/features/plugins/manifest-validate";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import type { PluginUiViolation } from "@/features/plugins/remote-ui/validate";
import type { PluginMessagePort } from "@/plugin-sdk/protocol";

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
  /** The Plugin Permissions granted right now; none by default. */
  granted?: readonly PluginPermissionId[];
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

// Approvals (approvals.ts)

export interface PluginApproval {
  /** The Plugin's folder name in the Plugin Directory. */
  pluginId: string;
  /** The `h1:` hash pinned at approval; a folder that changed stays off. */
  pinnedHash: string;
  /** The Plugin Permissions granted right now. */
  granted: PluginPermissionId[];
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
}

export interface PluginScanOptions {
  /** Injected by tests; defaults to the platform's Plugin Directory. */
  directory?: PluginDirectoryAdapter;
}

export interface PluginScanResult {
  plugins: InstalledPlugin[];
  refusals: PluginLaunchRefusal[];
}

// Lifecycle (lifecycle.ts)

/**
 * Why a Plugin was activated. The first seven are the manifest decision's
 * (#400); `warmStart` and `restart` are the performance decision's (#401).
 */
export type PluginStartReason =
  | "enable"
  | "launch"
  | "update"
  | "restore"
  | "resetLibrary"
  | "databaseLoad"
  | "settingsReset"
  | "warmStart"
  | "restart";

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
  | { code: "not-installed" };

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
  /** Injected by tests: jsdom has no Worker. */
  createFrame?: (document: Document, manifest: PluginManifest) => PluginSandboxFrame;
  /** Builds the method handlers; defaults to the wired API subset. */
  handlers?: (manifest: PluginManifest) => PluginApiHandlers;
  /** False while the Library cannot be read or written (the Tutorial Library). */
  isLibraryAvailable?: () => boolean;
  /** Registers `requiresLibrary` handler work so the Tutorial switch settles it (ADR 0008, #398). */
  trackLibraryWork?: <T>(work: Promise<T>) => Promise<T>;
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
  /** UI-string overrides `renderPage` applies to the manifest before rendering. */
  locale?: PluginLocale;
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
  /** The manifest, with any `locale` overrides already applied. */
  manifest: PluginManifest;
  /** Every `notifications.show` the Plugin asked for, in order. */
  notifications: TestNotification[];
  /** Every `navigation.openEntity` the Plugin asked for, in order. */
  navigations: TestNavigation[];
  /** The app language the host serves right now. */
  language: string;
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

/** One Plugin's whole highlight set for one editor. */
export interface PluginHighlightSet {
  kind: PluginHighlightKind;
  ranges: readonly PluginHighlightRange[];
}

export type PluginEditorContentResult = PluginApiOutput<"editor.getContent">;
export type PluginEditorSelectionResult = PluginApiOutput<"editor.getSelection">;
export type PluginEditorApplied = PluginApiOutput<"editor.reveal">;


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
