/**
 * Mounts one Plugin's Remote UI host side and disposes it on unmount, so a
 * stopped or navigated-away Plugin leaves no receiver or violation callback
 * behind. The receiver is created after mount (never during render), which
 * keeps the StrictMode double-mount from disposing the live one.
 */

import { useEffect, useRef, useState } from "react";
import { createPluginRemoteUi, type PluginRemoteUi } from "@/features/plugins/remote-ui/receiver";
import type { PluginUiViolation } from "@/features/plugins/remote-ui/validate";

export function usePluginRemoteUi(
  onViolation: (violation: PluginUiViolation) => void
): PluginRemoteUi | null {
  const handler = useRef(onViolation);
  handler.current = onViolation;
  const [ui, setUi] = useState<PluginRemoteUi | null>(null);

  useEffect(() => {
    const created = createPluginRemoteUi({ onViolation: (violation) => handler.current(violation) });
    setUi(created);
    return () => {
      created.dispose();
      setUi(null);
    };
  }, []);

  return ui;
}
