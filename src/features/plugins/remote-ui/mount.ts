/**
 * Opens one Remote UI mount for a Plugin page (#438). The host creates a fresh
 * MessageChannel, sends a `ui.mount` request carrying one end of it, and hands
 * the Plugin the page to render over that port; `unmount()` asks the Plugin to
 * tear the mount down and closes the host's end.
 *
 * This module stays free of React, React Aria, and the host component map, so
 * it can live in the lazily loaded Plugin page chunk.
 */

import type { PluginBroker } from "@/features/plugins/types";
import {
  PLUGIN_UI_MOUNT_REQUEST,
  PLUGIN_UI_UNMOUNT_REQUEST,
} from "@/plugin-sdk/protocol";

export interface PluginUiMount {
  /** The host end of the mount's MessageChannel: the Plugin renders the page over it. */
  port: MessagePort;
  /** The host-chosen id of this one mount. */
  surface: string;
  /** Resolves once the Plugin accepts the mount; rejects with the broker's error. */
  mounted: Promise<void>;
  /** Tears the mount down; idempotent, and a no-op request once the Plugin stopped. */
  unmount(): void;
}

let nextSurface = 0;

export function openPluginUiMount(
  broker: Pick<PluginBroker, "request" | "stopped">,
  page: string
): PluginUiMount {
  const channel = new MessageChannel();
  const surface = `${page}#${++nextSurface}`;
  const mounted = broker
    .request(
      PLUGIN_UI_MOUNT_REQUEST,
      { surface, page, port: channel.port2 },
      [channel.port2]
    )
    .then(() => undefined);
  let closed = false;
  return {
    port: channel.port1,
    surface,
    mounted,
    unmount() {
      if (closed) return;
      closed = true;
      // A stopped Plugin cannot answer the request, so it is skipped; a live one
      // settles on its own reply or is abandoned when it never comes.
      if (!broker.stopped) {
        void broker.request(PLUGIN_UI_UNMOUNT_REQUEST, { surface }).catch(() => {});
      }
      channel.port1.close();
    },
  };
}
