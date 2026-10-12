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
  /** Injectable frame clock; the default measures real animation frames. */
  frame?: () => number;
}): PluginRemoteUi {
  const receiver = new RemoteReceiver();
  let disposed = false;
  let report: (violation: PluginUiViolation) => void = options.onViolation;
  const connection = createValidatedConnection({
    receiver,
    onViolation: (violation) => {
      if (!disposed) report(violation);
    },
    ...(options.frame === undefined ? {} : { frame: options.frame }),
  });
  const components = createPluginUiComponents();
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
