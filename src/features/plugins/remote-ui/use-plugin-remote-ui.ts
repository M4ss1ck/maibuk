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

export function usePluginRemoteUi(
  runtime: Pick<PluginRuntime, "broker">,
  pageId: string,
  onViolation: (violation: PluginUiViolation) => void
): { ui: PluginRemoteUi | null; failed: boolean } {
  const handler = useRef(onViolation);
  handler.current = onViolation;
  const [ui, setUi] = useState<PluginRemoteUi | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const created = createPluginRemoteUi({ onViolation: (violation) => handler.current(violation) });
    const mount = openPluginUiMount(runtime.broker, pageId);
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
    mount.mounted.catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      mount.unmount();
      thread.close();
      created.dispose();
      setUi(null);
      setFailed(false);
    };
  }, [runtime, pageId]);

  return { ui, failed };
}
