/**
 * The supported entry point for Plugin tests, built-in and third-party.
 * `createTestHost()` runs the real broker and method table over an in-process
 * MessageChannel with in-memory platform adapters: a Plugin test hands the
 * returned port to its own setup and asserts against the host's records, and
 * never imports the broker, a store, or a platform adapter directly.
 *
 * The sandbox itself is not simulated here; the browser lanes prove it. The
 * kit proves the host logic around a Plugin (permissions, the method table,
 * the Library adapter) in the same jsdom the app's other suites use.
 */

import { createPluginBroker } from "@/features/plugins/broker";
import type {
  PluginApiHandlers,
  PluginPermissionId,
  TestHost,
  TestHostOptions,
  TestNotification,
} from "@/features/plugins/types";

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

  return {
    port: channel.port2,
    broker,
    notifications,
    locale: options.locale ?? null,
    setGranted(permissions) {
      granted = new Set(permissions);
    },
    stop() {
      broker.stop("requested");
      channel.port1.close();
      channel.port2.close();
    },
  };
}
