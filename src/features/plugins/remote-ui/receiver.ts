/**
 * One Plugin's Remote UI host side (ADR 0021): the receiver that stores the
 * Plugin's tree, the validated connection the Plugin sends it over, and the
 * host components that render it.
 *
 * `dispose()` releases the host map and stops reporting violations, so a
 * stopped or unmounted Plugin leaves no callbacks behind; the Plugin terminal
 * drops the receiver with the runtime.
 */

import type { RemoteConnection } from "@remote-dom/core";
import { RemoteReceiver } from "@remote-dom/core/receivers";
import type { RemoteComponentRendererMap } from "@remote-dom/react/host";
import { release, retain } from "@quilted/threads";
import type { PluginFrameHost } from "@/components/plugins/PluginFrame";
import { createPluginUiComponents } from "@/features/plugins/remote-ui/components";
import {
  createValidatedConnection,
  type PluginUiViolation,
} from "@/features/plugins/remote-ui/validate";

export interface PluginRemoteUi {
  /** Stores the Plugin's tree for the host renderer. */
  receiver: RemoteReceiver;
  /** The connection the Plugin sends mutations and calls over. */
  connection: RemoteConnection;
  /** The tag → host component map. */
  components: RemoteComponentRendererMap;
  readonly disposed: boolean;
  /** Releases the host map and the violation callback. */
  dispose(): void;
}

export function createPluginRemoteUi(options: {
  onViolation: (violation: PluginUiViolation) => void;
  /** The manifest's `customUi`; a tree with a `Frame` is refused without it. */
  customUi?: boolean;
  /**
   * The owning run's Frame host (#454): the kit `Frame` renders its sandboxed
   * iframe from it. Omitted by tests that mount a tree without a runtime, where
   * a `Frame` renders nothing.
   */
  frameHost?: PluginFrameHost;
  /** Injectable clock in milliseconds; the default reads the real time. */
  now?: () => number;
}): PluginRemoteUi {
  // `retain`/`release` keep a function prop proxied over the mount's thread
  // alive while the receiver holds it, and free it when the node leaves.
  const receiver = new RemoteReceiver({ retain, release });
  let disposed = false;
  let report: (violation: PluginUiViolation) => void = options.onViolation;
  const connection = createValidatedConnection({
    receiver,
    onViolation: (violation) => {
      if (!disposed) report(violation);
    },
    ...(options.customUi === undefined ? {} : { customUi: options.customUi }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const components = createPluginUiComponents(options.frameHost);
  return {
    receiver,
    connection,
    components,
    get disposed() {
      return disposed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      components.clear();
      report = () => {};
    },
  };
}
