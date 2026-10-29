import { getBundleType } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  UpdateError,
  type BundleType,
  type UpdateFailureReason,
  type UpdaterAdapter,
} from "@/lib/platform/types";

const OWNED_BUNDLES: readonly BundleType[] = ["appimage", "deb", "rpm"];

/**
 * The plugin rejects with bare strings. The signature and permission wording
 * comes from the plugin's own errors; anything unrecognised is `other`, which
 * the dialog words generically.
 */
export function classifyUpdateError(error: unknown): UpdateFailureReason {
  if (error instanceof UpdateError) return error.reason;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes("signature")) return "bad-signature";
  if (
    message.includes("dismissed") ||
    message.includes("cancel") ||
    message.includes("authentication") ||
    message.includes("not authorized")
  ) {
    return "cancelled-auth";
  }
  if (message.includes("permission denied") || message.includes("read-only")) return "not-writable";
  if (message.includes("platform") && message.includes("not found")) return "no-asset";
  if (
    message.includes("error sending request") ||
    message.includes("network") ||
    message.includes("dns") ||
    message.includes("connection") ||
    message.includes("timed out")
  ) {
    return "offline";
  }
  return "other";
}

let pending: Update | null = null;

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
  async downloadAndInstall(onProgress) {
    if (!pending) throw new UpdateError("no-asset");
    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === "Started") {
          onProgress({ kind: "started", total: event.data.contentLength });
        } else if (event.event === "Progress") {
          onProgress({ kind: "progress", bytes: event.data.chunkLength });
        } else {
          onProgress({ kind: "finished" });
        }
      });
    } catch (error) {
      throw new UpdateError(classifyUpdateError(error), error);
    }
  },
  async restart() {
    await relaunch();
  },
};
