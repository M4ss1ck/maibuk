import { getBundleType } from "@tauri-apps/api/app";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import {
  UpdateError,
  type BundleType,
  type UpdateFailureReason,
  type UpdateProgressEvent,
  type UpdaterAdapter,
} from "@/lib/platform/types";

const OWNED_BUNDLES: readonly BundleType[] = ["appimage", "deb", "rpm", "nsis"];

/**
 * The plugin rejects with its error's Display string. Each pattern matches a
 * message tauri-plugin-updater 2.10.1 (or a crate it wraps) really produces;
 * the table test cites the source line of every one. First match wins, so the
 * 404 rule sits before the generic download-status rule.
 */
const ERROR_RULES: readonly [RegExp, UpdateFailureReason][] = [
  // Signature: minisign-verify, base64 decoding of the key or `.sig`, SignatureUtf8.
  [/signature|minisign|^invalid (symbol|padding|last symbol|input length)/i, "bad-signature"],
  // No file for this install, no latest.json, or a malformed feed entry.
  [/platforms? .*(was not found|were found)|could not fetch a valid release json/i, "no-asset"],
  [
    /download request failed with status: (404|410)|updater response|invalid updater binary/i,
    "no-asset",
  ],
  // deb/rpm: pkexec dismissed falls through to a sudo with no terminal.
  [/^failed to install package$|authentication failed or was cancelled/i, "cancelled-auth"],
  // AppImage: renaming the running file out of its folder.
  [
    /permission denied \(os error 13\)|read-only file system|not on the same mount point/i,
    "not-writable",
  ],
  [/error sending request|response body|operation timed out|download request failed/i, "offline"],
];

export function classifyUpdateError(error: unknown): UpdateFailureReason {
  if (error instanceof UpdateError) return error.reason;
  const message = (error instanceof Error ? error.message : String(error)).replace(/^`|`$/g, "");
  return ERROR_RULES.find(([pattern]) => pattern.test(message))?.[1] ?? "other";
}

// What `check()` found. On Windows it also holds the downloaded installer
// bytes (in Rust) between `download()` and `install()`; `close()` drops them.
let pending: Update | null = null;

function toProgress(onProgress: (event: UpdateProgressEvent) => void) {
  return (event: DownloadEvent) => {
    if (event.event === "Started") {
      onProgress({ kind: "started", total: event.data.contentLength });
    } else if (event.event === "Progress") {
      onProgress({ kind: "progress", bytes: event.data.chunkLength });
    } else {
      onProgress({ kind: "finished" });
    }
  };
}

async function run(work: (update: Update) => Promise<void>): Promise<void> {
  if (!pending) throw new UpdateError("no-asset");
  try {
    await work(pending);
  } catch (error) {
    throw new UpdateError(classifyUpdateError(error), error);
  }
}

export const tauriUpdater: UpdaterAdapter = {
  async bundleType() {
    try {
      const type = (await getBundleType()) as string;
      return OWNED_BUNDLES.includes(type as BundleType) ? (type as BundleType) : "unknown";
    } catch {
      // The Arch build clears the marker the plugin reads (ADR 0037).
      return "unknown";
    }
  },
  async check() {
    try {
      await pending?.close();
      pending = await check();
      return pending ? { version: pending.version } : null;
    } catch (error) {
      throw new UpdateError(classifyUpdateError(error), error);
    }
  },
  downloadAndInstall: (onProgress) =>
    run((update) => update.downloadAndInstall(toProgress(onProgress))),
  download: (onProgress) => run((update) => update.download(toProgress(onProgress))),
  // On success the NSIS installer quits this process, so this never resolves.
  install: () => run((update) => update.install()),
  async close() {
    const update = pending;
    pending = null;
    await update?.close();
  },
};
