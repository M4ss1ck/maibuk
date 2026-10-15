/**
 * The Remote UI test harness: the real remote renderer in jsdom. It wires the
 * SDK's custom elements (the Plugin's React tree) through a
 * `RemoteMutationObserver` and the validated connection into a real
 * `RemoteReceiver`, then renders the host components with `RemoteRootRenderer`.
 *
 * Nothing here is simulated: a test mounts the Plugin's tree with `mount()`,
 * drives the host with `user-event`, and asserts the Plugin's handlers fired
 * and the host's own state changed. `violations` records what the validator
 * refused.
 */

import { act, render } from "@testing-library/react";
import { RemoteMutationObserver } from "@remote-dom/core/elements";
import { RemoteRootRenderer } from "@remote-dom/react/host";
import { createRoot, type Root } from "react-dom/client";
import type { ComponentType, ReactNode } from "react";
import { createPluginRemoteUi } from "@/features/plugins/remote-ui/receiver";
import type { PluginRemoteUi } from "@/features/plugins/remote-ui/receiver";
import type { PluginUiViolation } from "@/features/plugins/remote-ui/validate";

export interface RemoteUiHarness {
  ui: PluginRemoteUi;
  /** Every declaration the validator refused, in order. */
  violations: PluginUiViolation[];
  /** Renders (or re-renders) the Plugin's tree and waits for the observer to deliver. */
  mount(node: ReactNode): Promise<void>;
  /**
   * Stops the Worker: unmounts the Plugin's tree and disconnects its observer,
   * while the host side stays mounted. The host can no longer receive a
   * mutation or an echo, which is what "a stopped Worker" means to the host.
   */
  stopWorker(): void;
  /** Tears down both roots, the observer, the container, and the receiver. */
  cleanup(): void;
}

export function renderRemoteUi(options?: {
  wrapper?: ComponentType<{ children: ReactNode }>;
  /** The manifest's `customUi`; a tree with a `Frame` is refused without it. */
  customUi?: boolean;
}): RemoteUiHarness {
  const violations: PluginUiViolation[] = [];
  const ui = createPluginRemoteUi({
    onViolation: (violation) => violations.push(violation),
    ...(options?.customUi === undefined ? {} : { customUi: options.customUi }),
  });

  // Kept out of the document so RTL queries see only the host tree; a
  // MutationObserver still observes a detached subtree.
  const container = document.createElement("div");
  const observer = new RemoteMutationObserver(ui.connection);
  observer.observe(container);
  let root: Root | null = createRoot(container);

  // The host side is a second React root, as in the app; RTL cleans it up.
  const host = <RemoteRootRenderer receiver={ui.receiver} components={ui.components} />;
  render(options?.wrapper ? <options.wrapper>{host}</options.wrapper> : host);

  return {
    ui,
    violations,
    async mount(node) {
      await act(async () => {
        root?.render(node);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    stopWorker() {
      act(() => {
        root?.unmount();
      });
      root = null;
      observer.disconnect();
    },
    cleanup() {
      act(() => {
        root?.unmount();
      });
      root = null;
      observer.disconnect();
      ui.dispose();
    },
  };
}
