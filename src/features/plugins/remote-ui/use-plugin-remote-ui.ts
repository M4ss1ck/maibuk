/**
 * Mounts one Plugin's Remote UI host side over the mount's `MessagePort` and
 * disposes it on unmount, so a stopped or navigated-away Plugin leaves no
 * receiver, thread, or violation callback behind. The receiver and thread are
 * created after mount (never during render), which keeps the StrictMode
 * double-mount from disposing the live one.
 *
 * The Worker imports `mutate` and `call` from this side of the thread, so the
 * host exports both, forwarding to the validated connection.
 */

import type { RemoteMutationRecord } from "@remote-dom/core";
import { ThreadMessagePort } from "@quilted/threads";
import { useEffect, useRef, useState } from "react";
import { openPluginUiMount } from "@/features/plugins/remote-ui/mount";
import { createPluginRemoteUi, type PluginRemoteUi } from "@/features/plugins/remote-ui/receiver";
import type { PluginUiViolation } from "@/features/plugins/remote-ui/validate";
import type { PluginRuntime } from "@/features/plugins/types";
import type { PluginUiMountKind } from "@/plugin-sdk/protocol";

export function usePluginRemoteUi(
  runtime: Pick<PluginRuntime, "broker" | "manifest" | "files" | "sendFrame">,
  pageId: string,
  onViolation: (violation: PluginUiViolation) => void,
  kind: PluginUiMountKind = "page"
): { ui: PluginRemoteUi | null; mounted: boolean; failed: boolean } {
  const handler = useRef(onViolation);
  handler.current = onViolation;
  const [ui, setUi] = useState<PluginRemoteUi | null>(null);
  const [mounted, setMounted] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const created = createPluginRemoteUi({
      onViolation: (violation) => handler.current(violation),
      // A kit `Frame` inside this tree renders the sandboxed surface from the
      // same run's verified folder and hands port B to this Worker (#454).
      frameHost: runtime,
    });
    const mount = openPluginUiMount(runtime.broker, pageId, kind);
    // The thread listens through `addEventListener`, which a MessagePort only
    // dispatches after `start()`.
    mount.port.start();
    const thread = new ThreadMessagePort(mount.port, {
      exports: {
        mutate: (records: readonly RemoteMutationRecord[]) => created.connection.mutate(records),
        call: (id: string, method: string, ...args: readonly unknown[]) =>
          created.connection.call(id, method, ...args),
      },
    });
    setUi(created);
    // A refused mount (the Plugin never installed its handler) shows the
    // could-not-display text; it does not stop the Plugin.
    mount.mounted.then(
      () => {
        if (!cancelled) setMounted(true);
      },
      () => {
        if (!cancelled) setFailed(true);
      }
    );
    return () => {
      cancelled = true;
      mount.unmount();
      thread.close();
      created.dispose();
      setUi(null);
      setMounted(false);
      setFailed(false);
    };
  }, [runtime, pageId, kind]);

  return { ui, mounted, failed };
}
