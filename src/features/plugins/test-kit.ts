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
import { PLUGIN_INIT_MESSAGE, type PluginUiMountKind } from "@/plugin-sdk/protocol";
import type {
  PluginApiHandlers,
  PluginPermissionId,
  TestHost,
  TestHostOptions,
  TestNavigation,
  TestNotification,
  TestPage,
  TestPageNavigation,
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
  const navigations: TestNavigation[] = [];
  const pageNavigations: TestPageNavigation[] = [];
  const books = [...(options.library?.books ?? [])];
  const chapters = [...(options.library?.chapters ?? [])];
  const notes = [...(options.library?.notes ?? [])];
  const canvases = [...(options.library?.canvases ?? [])];
  const storage = options.storage ?? new Map<string, unknown>();
  const secrets = options.secrets ?? new Map<string, string>();
  let clipboard = options.clipboard ?? "";
  let language = options.language ?? "en";
  let libraryAvailable = true;
  const startReason = options.startReason ?? "enable";
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
    "library.chapters.list": ({ bookId }) =>
      chapters
        .filter((chapter) => chapter.bookId === bookId)
        .map(({ content: _content, ...summary }) => summary),
    "library.chapters.get": ({ chapterId }) => {
      const chapter = chapters.find((entry) => entry.id === chapterId);
      if (!chapter) return null;
      const { content, ...summary } = chapter;
      return { ...summary, content: content ?? { text: "", html: "" } };
    },
    "library.notes.list": ({ bookId }) =>
      notes
        .filter((note) => bookId === undefined || note.bookId === bookId)
        .map(({ content: _content, ...summary }) => summary),
    "library.notes.get": ({ noteId }) => {
      const note = notes.find((entry) => entry.id === noteId);
      if (!note) return null;
      const { content, ...summary } = note;
      return { ...summary, content: content ?? { text: "", html: "" } };
    },
    "library.canvases.list": ({ bookId }) =>
      bookId === undefined ? canvases : canvases.filter((canvas) => canvas.bookId === bookId),
    "library.canvases.get": ({ canvasId }) =>
      canvases.find((canvas) => canvas.id === canvasId) ?? null,
    "storage.get": ({ key }) => {
      const value = storage.get(key);
      return value === undefined ? null : value;
    },
    "storage.set": ({ key, value }) => {
      storage.set(key, value);
      return null;
    },
    "storage.delete": ({ key }) => {
      storage.delete(key);
      return null;
    },
    "storage.keys": () => [...storage.keys()].sort(),
    // Secret values are kept host-side only: `listNames` is the Plugin's one
    // read, and it returns names, never a value.
    "secrets.set": ({ name, value }) => {
      secrets.set(name, value);
      return null;
    },
    "secrets.delete": ({ name }) => {
      secrets.delete(name);
      return null;
    },
    "secrets.listNames": () => [...secrets.keys()].sort(),
    "clipboard.readText": () => clipboard,
    "clipboard.writeText": ({ text }) => {
      clipboard = text;
      return null;
    },
    "navigation.openEntity": ({ entity, reveal }) => {
      navigations.push(reveal === undefined ? { entity } : { entity, reveal });
      return null;
    },
    "navigation.openPage": ({ pageId, pluginId }) => {
      pageNavigations.push({ pluginId: pluginId ?? options.manifest.id, pageId });
      return { status: "opened" };
    },
    "language.get": () => ({ language }),
  };

  const broker = createPluginBroker({
    pluginId: options.manifest.id,
    port: channel.port1,
    declared,
    granted: () => granted,
    handlers,
    isLibraryAvailable: () => libraryAvailable,
    eventSnapshot: (event) => (event === "language.changed" ? { language } : undefined),
  });

  // Deliver the activation's start reason over the Plugin's own port, the way
  // the Worker receives it on the init message in production; the SDK reads it
  // and exposes it as `client.activation` (#445).
  channel.port1.postMessage({ kind: PLUGIN_INIT_MESSAGE.kind, startReason });

  /** Every page `renderPage` opened and has not unmounted yet. */
  const openPages = new Set<TestPage>();
  /** The live mount behind each open page, so `stopWorker` can sever it. */
  const openMounts = new Map<TestPage, { mount: PluginUiMount; thread: { close(): void } }>();

  function renderSurface(name: string, kind: PluginUiMountKind): Promise<TestPage> {
    const violations: PluginUiViolation[] = [];
    const ui = createPluginRemoteUi({ onViolation: (violation) => violations.push(violation) });
    const mount = openPluginUiMount(broker, name, kind);
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
    navigations,
    pageNavigations,
    locale: options.locale ?? null,
    startReason,
    get language() {
      return language;
    },
    get clipboard() {
      return clipboard;
    },
    setClipboard(next) {
      clipboard = next;
    },
    setGranted(permissions) {
      granted = new Set(permissions);
    },
    setLanguage(next) {
      language = next;
      broker.emit("language.changed", { language });
    },
    setLibraryAvailable(available) {
      libraryAvailable = available;
    },
    renderPage(page: string) {
      return renderSurface(page, "page");
    },
    renderSettingsRow(rowId: string) {
      return renderSurface(rowId, "settingsRow");
    },
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
