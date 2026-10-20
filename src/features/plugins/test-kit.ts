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
import {
  collectEndpointAnswer,
  dispatchEndpointRequest,
  endpointUrlFor,
} from "@/features/plugins/endpoint";
import { assertToggleButton } from "@/features/plugins/handlers";
import { applyPluginLocale } from "@/features/plugins/manifest-validate";
import { pluginFetch } from "@/features/plugins/network";
import { openPluginUiMount, type PluginUiMount } from "@/features/plugins/remote-ui/mount";
import { createPluginRemoteUi } from "@/features/plugins/remote-ui/receiver";
import { PluginRemoteUiSurface } from "@/features/plugins/remote-ui/surface";
import type { PluginUiViolation } from "@/features/plugins/remote-ui/validate";
import type { PluginSecretStore } from "@/features/plugins/secret-store";
import {
  PLUGIN_INIT_MESSAGE,
  bytesToBase64,
  type PluginUiMountKind,
} from "@/plugin-sdk/protocol";
import type {
  EndpointListenerState,
  PluginApiHandlers,
  PluginApproval,
  PluginManifest,
  PluginPermissionId,
  PluginRuntime,
  TestEndpointAnswer,
  TestEndpointRequest,
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

/**
 * The approval record the Plugin Endpoint dispatcher reads in a test: enabled,
 * holding the grants this host has right now. The pinned hash and the approved
 * files play no part in routing, so they are placeholders.
 */
function endpointApproval(
  manifest: PluginManifest,
  granted: ReadonlySet<PluginPermissionId>
): PluginApproval {
  return {
    pluginId: manifest.id,
    pinnedHash: "h1:test",
    granted: [...granted],
    enabled: true,
    approvedVersion: manifest.version,
    approvedPermissions: {
      required: [...manifest.permissions.required],
      optional: [...manifest.permissions.optional],
    },
    approvedFiles: {},
  };
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
  const testFetch = options.fetch;
  let clipboard = options.clipboard ?? "";
  // The pressed state of each Toggle Button the Plugin set, by its local id.
  const toolbarPressedState = new Map<string, boolean>();
  let language = options.language ?? "en";
  let libraryAvailable = true;
  // The Plugin Endpoint's listener as this host fakes it: off until the test
  // gives the Plugin an address, then bound on that port.
  let endpointState: EndpointListenerState = { state: "off" };
  const startReason = options.startReason ?? "enable";
  const declared = [
    ...options.manifest.permissions.required,
    ...options.manifest.permissions.optional,
  ] as PluginPermissionId[];
  let granted = new Set<PluginPermissionId>(options.permissions ?? declared);

  // The `network.fetch` header injection reads through the same store seam the
  // app registers, over the test's in-memory `secrets`, scoped to this Plugin.
  const secretStore: PluginSecretStore = {
    set: async (pluginId, name, value) => {
      if (pluginId === options.manifest.id) secrets.set(name, value);
    },
    delete: async (pluginId, name) => {
      if (pluginId === options.manifest.id) secrets.delete(name);
    },
    listNames: async (pluginId) =>
      pluginId === options.manifest.id ? [...secrets.keys()].sort() : [],
    read: async (pluginId, name) =>
      pluginId === options.manifest.id ? (secrets.get(name) ?? null) : null,
    clearPlugin: async (pluginId) => {
      if (pluginId === options.manifest.id) secrets.clear();
    },
    clearAll: async () => {
      secrets.clear();
    },
  };

  const networkHandler: PluginApiHandlers = testFetch
    ? {
        "network.fetch": (params, { pluginId }) =>
          pluginFetch(params, { pluginId, store: secretStore, fetch: testFetch }),
      }
    : {};

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
    // Present only when the test supplied a fetch; otherwise the row refuses
    // `not-implemented` exactly like any other unwired row.
    ...networkHandler,
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
    "endpoint.address": (_params, { pluginId }) => ({
      url: endpointUrlFor(endpointState, pluginId),
    }),
    // Refuses what the host refuses (the same rule as the app's handler), then records the state.
    "toolbar.setPressed": ({ button, pressed }) => {
      assertToggleButton(options.manifest, button);
      toolbarPressedState.set(button, pressed);
      return null;
    },
  };

  const broker = createPluginBroker({
    pluginId: options.manifest.id,
    port: channel.port1,
    declared,
    granted: () => granted,
    handlers,
    isLibraryAvailable: () => libraryAvailable,
    eventSnapshot: (event) => {
      if (event === "language.changed") return { language };
      if (event === "endpoint.addressChanged") {
        return { url: endpointUrlFor(endpointState, options.manifest.id) };
      }
      return undefined;
    },
  });

  // Deliver the activation's start reason over the Plugin's own port, the way
  // the Worker receives it on the init message in production; the SDK reads it
  // and exposes it as `client.activation` (#445).
  channel.port1.postMessage({ kind: PLUGIN_INIT_MESSAGE.kind, startReason });

  // The Plugin Endpoint's host side routes with a runtime and an approval, as
  // the app does; here both are this host: the manifest behind the broker,
  // always enabled, with whatever `setGranted` holds at that moment.
  const endpointRuntime: PluginRuntime = {
    manifest: options.manifest,
    broker,
    files: [],
    sendFrame: () => {},
    stop: () => {},
  };
  let nextEndpointRequestId = 1;

  /**
   * Hands the Plugin one request on its Plugin Endpoint through the very
   * dispatcher the app routes with, and resolves with the answer once it is
   * complete: a streamed answer resolves after its `end`, and its chunks are
   * joined into `body`. Without the `serve` grant the dispatcher answers 404
   * and the request never reaches the Plugin.
   */
  function endpoint(request: TestEndpointRequest): Promise<TestEndpointAnswer> {
    const tail = request.path.startsWith("/") ? request.path : `/${request.path}`;
    const headers: [string, string][] = Array.isArray(request.headers)
      ? request.headers.map(([name, value]) => [name, value])
      : Object.entries(request.headers ?? {});
    const bytes =
      request.body === undefined
        ? new Uint8Array()
        : typeof request.body === "string"
          ? new TextEncoder().encode(request.body)
          : request.body;

    return collectEndpointAnswer((sink) =>
      dispatchEndpointRequest(
        {
          runtime: () => endpointRuntime,
          approval: () => endpointApproval(options.manifest, granted),
        },
        {
          requestId: String(nextEndpointRequestId++),
          pluginId: options.manifest.id,
          request: {
            method: request.method ?? "GET",
            path: `/plugin/${options.manifest.id}${tail}`,
            headers,
            body: bytesToBase64(bytes),
          },
        },
        sink
      )
    ).then((answer) => ({ ...answer, text: () => new TextDecoder().decode(answer.body) }));
  }

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
    toolbarPressed(button) {
      return toolbarPressedState.get(button) ?? false;
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
    setEndpointAddress(port) {
      const next: EndpointListenerState =
        port === null ? { state: "off" } : { state: "listening", port };
      const before = endpointUrlFor(endpointState, options.manifest.id);
      endpointState = next;
      const after = endpointUrlFor(next, options.manifest.id);
      if (after !== before) broker.emit("endpoint.addressChanged", { url: after });
    },
    setLibraryAvailable(available) {
      libraryAvailable = available;
    },
    endpoint,
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
