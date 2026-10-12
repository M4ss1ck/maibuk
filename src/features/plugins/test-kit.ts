/**
 * The supported entry point for Plugin tests, built-in and third-party.
 * `createTestHost()` runs the real broker and method table over an in-process
 * MessageChannel with in-memory platform adapters: a Plugin test hands the
 * returned port to its own setup and asserts against the host's records, and
 * never imports the broker, a store, or a platform adapter directly.
 * `renderPage()` goes further and draws one of the Plugin's pages through the
 * real host renderer, over a real Remote UI mount, so a test drives the page
 * with the keyboard and asserts what the host drew.
 *
 * The sandbox itself is not simulated here; the browser lanes prove it. The
 * kit proves the host logic around a Plugin (permissions, the method table,
 * the Library adapter, the Remote UI renderer) in the same jsdom the app's
 * other suites use.
 */

import type { RemoteMutationRecord } from "@remote-dom/core";
import { ThreadMessagePort } from "@quilted/threads";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createPluginBroker } from "@/features/plugins/broker";
import { applyPluginLocale } from "@/features/plugins/manifest-validate";
import { openPluginUiMount, type PluginUiMount } from "@/features/plugins/remote-ui/mount";
import { createPluginRemoteUi } from "@/features/plugins/remote-ui/receiver";
import { PluginRemoteUiSurface } from "@/features/plugins/remote-ui/surface";
import type { PluginUiViolation } from "@/features/plugins/remote-ui/validate";
import type {
  PluginApiHandlers,
  PluginPermissionId,
  TestHost,
  TestHostOptions,
  TestNotification,
  TestPage,
} from "@/features/plugins/types";

/**
 * Runs a render step inside `act()` only where the test enabled the act
 * environment (Testing Library for React does); elsewhere React warns that
 * act is unsupported, so the step runs directly.
 */
function inAct(step: () => void): void {
  if ((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT) act(step);
  else step();
}

export function createTestHost(options: TestHostOptions): TestHost {
  const channel = new MessageChannel();
  const notifications: TestNotification[] = [];
  const books = [...(options.library?.books ?? [])];
  const declared = [
    ...options.manifest.permissions.required,
    ...options.manifest.permissions.optional,
  ] as PluginPermissionId[];
  let granted = new Set<PluginPermissionId>(options.permissions ?? declared);

  const handlers: PluginApiHandlers = {
    "notifications.show": ({ variant, message }) => {
      notifications.push({ variant, message });
      return null;
    },
    "library.books.list": () => books,
    "library.books.get": ({ bookId }) => books.find((book) => book.id === bookId) ?? null,
  };

  const broker = createPluginBroker({
    pluginId: options.manifest.id,
    port: channel.port1,
    declared,
    granted: () => granted,
    handlers,
  });

  /** Every page `renderPage` opened and has not unmounted yet. */
  const openPages = new Set<TestPage>();
  /** The live mount behind each open page, so `stopWorker` can sever it. */
  const openMounts = new Map<TestPage, { mount: PluginUiMount; thread: { close(): void } }>();

  function renderPage(page: string): Promise<TestPage> {
    const violations: PluginUiViolation[] = [];
    const ui = createPluginRemoteUi({ onViolation: (violation) => violations.push(violation) });
    const mount = openPluginUiMount(broker, page);
    // The thread listens through `addEventListener`, which a MessagePort only
    // dispatches after `start()`.
    mount.port.start();
    // The host end of the mount: exactly what `usePluginRemoteUi` wires, so the
    // page crosses the same thread the app uses.
    const thread = new ThreadMessagePort(mount.port, {
      exports: {
        mutate: (records: readonly RemoteMutationRecord[]) => ui.connection.mutate(records),
        call: (id: string, method: string, ...args: readonly unknown[]) =>
          ui.connection.call(id, method, ...args),
      },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    inAct(() => {
      root.render(createElement(PluginRemoteUiSurface, { ui, onError: () => {} }));
    });

    const testPage: TestPage = {
      container,
      violations,
      unmount() {
        if (!openPages.delete(testPage)) return;
        openMounts.delete(testPage);
        mount.unmount();
        thread.close();
        inAct(() => {
          root.unmount();
        });
        ui.dispose();
        container.remove();
      },
    };
    openPages.add(testPage);

    return mount.mounted.then(
      () => {
        openMounts.set(testPage, { mount, thread });
        return testPage;
      },
      (error: unknown) => {
        testPage.unmount();
        throw error;
      }
    );
  }

  return {
    port: channel.port2,
    broker,
    manifest: applyPluginLocale(options.manifest, options.locale ?? {}),
    notifications,
    locale: options.locale ?? null,
    setGranted(permissions) {
      granted = new Set(permissions);
    },
    renderPage,
    stopWorker() {
      broker.stop("requested");
      // Sever every mount so no mutation or echo can arrive, but leave the
      // host renderer mounted: a stopped Worker leaves a host tree behind.
      for (const { mount, thread } of openMounts.values()) {
        thread.close();
        mount.port.close();
      }
    },
    stop() {
      for (const page of [...openPages]) page.unmount();
      broker.stop("requested");
      channel.port1.close();
      channel.port2.close();
    },
  };
}
