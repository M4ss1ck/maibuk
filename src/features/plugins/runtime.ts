/**
 * Starting one Plugin (ADR 0019): the host reads the folder, verifies the
 * pinned `h1:` hash before anything else exists, validates the manifest,
 * plans the module graph, then creates the sandbox frame. The frame turns the
 * verified module sources into `blob:` URLs and starts the Worker, whose fixed
 * prelude imports the entry; the Plugin is ready when its setup finished and
 * it answers the host's first health check over the one MessagePort. Only then
 * is its broker live.
 *
 * A refusal never leaves a frame or a Worker behind: every failing path stops
 * the frame it created. The pinned-hash check runs before the frame factory is
 * called, so a folder changed after approval never reaches a Worker.
 */

import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";
import { planPluginModules, rewritePluginImports } from "@/features/plugins/modules";
import { createPluginFrame } from "@/features/plugins/sandbox";
import type {
  ManifestProblem,
  PluginBroker,
  PluginFolder,
  PluginManifest,
  PluginModulePlanEntry,
  PluginPermissionId,
  PluginSandboxFrame,
  PluginStartOptions,
  PluginStartRefusal,
  PluginStartResult,
} from "@/features/plugins/types";
import { PLUGIN_READY_MESSAGE } from "@/plugin-sdk/protocol";
import { createPluginBroker } from "@/features/plugins/broker";

/** The folder's manifest file name (ADR 0020). */
export const MANIFEST_FILE = "manifest.json";

/**
 * The startup limit from the performance budget (#401): frame creation to
 * ready. The lifecycle slice (#436) owns the state machine around it.
 */
export const STARTUP_TIMEOUT_MS = 10_000;

type StartupOutcome = { ok: true } | { ok: false; refusal: PluginStartRefusal };

function readManifest(folder: PluginFolder): { ok: true; manifest: PluginManifest } | { ok: false; problems: ManifestProblem[] } {
  const file = folder.files.find((entry) => entry.path === MANIFEST_FILE);
  if (!file) {
    return {
      ok: false,
      problems: [{ path: MANIFEST_FILE, message: `The Plugin folder has no ${MANIFEST_FILE}` }],
    };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  } catch {
    return {
      ok: false,
      problems: [{ path: MANIFEST_FILE, message: `${MANIFEST_FILE} is not valid UTF-8` }],
    };
  }
  return parsePluginManifest(text);
}

async function runStartup(
  frame: PluginSandboxFrame,
  port: MessagePort,
  modules: readonly PluginModulePlanEntry[],
  broker: PluginBroker
): Promise<StartupOutcome> {
  const ready = new Promise<"ready" | { error: string }>((resolve) => {
    frame.onWorkerMessage((data) => {
      if (typeof data === "object" && data !== null && (data as { kind?: unknown }).kind === PLUGIN_READY_MESSAGE.kind) {
        resolve("ready");
      }
    });
    frame.onWorkerError((message) => resolve({ error: message }));
  });

  await frame.ready;

  const urls = new Map<string, string>();
  for (const module of modules) {
    const source = rewritePluginImports(module.source, module.imports, (path) => {
      const url = urls.get(path);
      if (!url) throw new Error(`The module ${path} was not loaded before ${module.path}`);
      return url;
    });
    urls.set(module.path, await frame.createModule(source));
  }
  const entry = modules[modules.length - 1];
  const entryUrl = urls.get(entry.path);
  if (!entryUrl) {
    return { ok: false, refusal: { code: "worker-error", message: "The entry module was not loaded" } };
  }

  await frame.startWorker(entryUrl, port);
  const readyOutcome = await ready;
  if (readyOutcome !== "ready") {
    return { ok: false, refusal: { code: "worker-error", message: readyOutcome.error } };
  }

  try {
    await broker.request("health.check", {});
  } catch (error) {
    return {
      ok: false,
      refusal: {
        code: "health-check-failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  return { ok: true };
}

async function withTimeout(work: Promise<StartupOutcome>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function startPlugin(options: PluginStartOptions): Promise<PluginStartResult> {
  const { folder, pinnedHash } = options;

  const actual = await hashPluginDirectory(folder.files);
  if (actual !== pinnedHash) {
    return { ok: false, refusal: { code: "hash-mismatch", expected: pinnedHash, actual } };
  }

  const manifestResult = readManifest(folder);
  if (!manifestResult.ok) {
    return { ok: false, refusal: { code: "manifest-invalid", problems: manifestResult.problems } };
  }
  const manifest = manifestResult.manifest;

  const plan = await planPluginModules(folder.files, manifest.entry);
  if (!plan.ok) {
    return { ok: false, refusal: { code: "module-refused", problems: plan.problems } };
  }

  const frame = (options.createFrame ?? createPluginFrame)(document);
  const channel = new MessageChannel();
  const broker = createPluginBroker({
    pluginId: manifest.id,
    port: channel.port1,
    // The manifest validator proved every permission is an exact name or a
    // `network:<host>`; the schema types them as strings.
    declared: [
      ...manifest.permissions.required,
      ...manifest.permissions.optional,
    ] as PluginPermissionId[],
    granted: () => options.granted ?? [],
    handlers: options.handlers?.(manifest),
    isLibraryAvailable: options.isLibraryAvailable,
  });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    broker.stop("requested");
    frame.stop();
  };

  let outcome: StartupOutcome | "timeout";
  try {
    outcome = await withTimeout(
      runStartup(frame, channel.port2, plan.modules, broker),
      options.timeoutMs ?? STARTUP_TIMEOUT_MS
    );
  } catch (error) {
    stop();
    return {
      ok: false,
      refusal: {
        code: "worker-error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  if (outcome === "timeout") {
    stop();
    return { ok: false, refusal: { code: "startup-timeout" } };
  }
  if (!outcome.ok) {
    stop();
    return { ok: false, refusal: outcome.refusal };
  }
  return { ok: true, plugin: { manifest, broker, stop } };
}
