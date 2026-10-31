/**
 * Remote UI under the QuickJS runner (#516, ADR 0019/0021): a real Plugin's page
 * and Settings row body, served from inside the VM over the bridged mount ports,
 * drawn by the real host renderer. The Plugin runs as real bytes (the fixture,
 * built from the real SDK Worker Remote UI entry) inside a memory-capped QuickJS
 * engine; the mount port crosses as a structured value and is bridged by
 * `bridge.ts`, exactly as on Android.
 *
 * The keyboard lane drives the drawn page with `user-event` and asserts what the
 * Plugin did and what the host drew, never an attribute (CODING_STANDARDS.md,
 * "Keyboard and accessibility test gate").
 */

import { resolve } from "node:path";
import { NODE_TYPE_ELEMENT, NODE_TYPE_TEXT, type RemoteMutationRecord } from "@remote-dom/core";
import { RemoteReceiver, type RemoteReceiverElement } from "@remote-dom/core/receivers";
import { release, retain, ThreadMessagePort } from "@quilted/threads";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runQuickJsPlugin,
  type QuickJsPluginEndpoint,
  type QuickJsPluginRun,
} from "@/features/plugins/quickjs";
import { createTestHost } from "@/features/plugins/test-kit";
import type { TestHost } from "@/features/plugins/types";
import {
  PLUGIN_INIT_MESSAGE,
  PLUGIN_UI_MOUNT_REQUEST,
  type PluginUiMountKind,
} from "@/plugin-sdk/protocol";
import { bundlePluginFixture } from "@/test/support/bundle-plugin-fixture";
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";

const FIXTURE_ENTRY = resolve(process.cwd(), "src/test/fixtures/quickjs/remote-ui.tsx");

/** The Worker global scope the runner posts to and receives messages from. */
class EndpointDouble implements QuickJsPluginEndpoint {
  readonly messages: unknown[] = [];
  private readonly listeners = new Set<
    (event: { data: unknown; ports: readonly MessagePort[] }) => void
  >();

  postMessage(data: unknown): void {
    this.messages.push(data);
  }

  addEventListener(
    _type: "message",
    listener: (event: { data: unknown; ports: readonly MessagePort[] }) => void
  ): void {
    this.listeners.add(listener);
  }
}

interface RemoteUiSession {
  run: QuickJsPluginRun;
  endpoint: EndpointDouble;
  host: TestHost;
}

const channels: MessageChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
  vi.restoreAllMocks();
});

/** Start the Remote UI fixture against a real host broker over the runner. */
async function startRemoteUi(): Promise<RemoteUiSession> {
  const host = createTestHost({ manifest: PLUGIN_MANIFEST });
  const endpoint = new EndpointDouble();
  const source = await bundlePluginFixture(FIXTURE_ENTRY);
  const run = runQuickJsPlugin({
    sources: { "index.js": source },
    entry: "index.js",
    endpoint,
    initEvent: {
      data: { kind: PLUGIN_INIT_MESSAGE.kind, startReason: "enable" },
      ports: [host.port],
    },
  });
  await expect(run.outcome).resolves.toEqual({ kind: "ready" });
  return { run, endpoint, host };
}

/**
 * The host end of one mount over a fresh MessageChannel, with every `mutate`
 * batch recorded: the same wiring `renderPage` uses, but the batch boundaries
 * are visible here, which is what the 16 ms flush proof needs.
 */
function createRecordingHost() {
  const channel = new MessageChannel();
  channels.push(channel);
  const receiver = new RemoteReceiver({ retain, release });
  const batches: RemoteMutationRecord[][] = [];
  new ThreadMessagePort(channel.port1, {
    exports: {
      mutate: (records: readonly RemoteMutationRecord[]) => {
        batches.push([...records]);
        return receiver.connection.mutate(records);
      },
      call: (id: string, method: string, ...args: unknown[]) =>
        receiver.connection.call(id, method, ...args),
    },
  });
  channel.port1.start();
  return { receiver, batches, port: channel.port2 };
}

/** Mount one surface of the fixture over a recording host, through the broker. */
async function mountRecording(
  host: TestHost,
  page: string,
  kind: PluginUiMountKind
): Promise<ReturnType<typeof createRecordingHost>> {
  const recording = createRecordingHost();
  await host.broker.request(
    PLUGIN_UI_MOUNT_REQUEST,
    { surface: `${kind}:${page}#recording`, kind, page, port: recording.port },
    [recording.port]
  );
  return recording;
}

function elements(receiver: RemoteReceiver): RemoteReceiverElement[] {
  return receiver.root.children.filter(
    (node): node is RemoteReceiverElement => node.type === NODE_TYPE_ELEMENT
  );
}

function element(receiver: RemoteReceiver, tag: string): RemoteReceiverElement | undefined {
  return elements(receiver).find((node) => node.element === tag);
}

function textOf(receiver: RemoteReceiver, tag: string): string[] {
  return elements(receiver)
    .filter((node) => node.element === tag)
    .map((node) =>
      node.children.map((child) => (child.type === NODE_TYPE_TEXT ? child.data : "")).join("")
    );
}

describe("Remote UI under the QuickJS runner", () => {
  it("mounts a Plugin page through renderPage() and updates it", async () => {
    const { run, host } = await startRemoteUi();
    try {
      const page = await host.renderPage("main");
      expect(await screen.findByRole("heading", { name: "Find" })).toBeInTheDocument();

      const user = userEvent.setup();
      const field = screen.getByRole("textbox", { name: "Search" });
      for (let i = 0; i < 10 && document.activeElement !== field; i++) await user.tab();
      expect(field).toHaveFocus();
      await user.keyboard("dune");

      expect(await screen.findByText("You typed: dune")).toBeInTheDocument();
      expect(page.violations).toEqual([]);
      page.unmount();
    } finally {
      run.dispose();
      host.stop();
    }
  });

  it("mounts a Settings row body through renderSettingsRow() and updates it", async () => {
    const { run, host } = await startRemoteUi();
    try {
      const row = await host.renderSettingsRow("threshold");
      expect(await screen.findByRole("switch", { name: "Threshold" })).toBeInTheDocument();

      const user = userEvent.setup();
      const control = screen.getByRole("switch", { name: "Threshold" });
      for (let i = 0; i < 10 && document.activeElement !== control; i++) await user.tab();
      expect(control).toHaveFocus();
      await user.keyboard(" ");

      expect(await screen.findByRole("switch", { name: "Threshold" })).toBeChecked();
      expect(row.violations).toEqual([]);
      row.unmount();
    } finally {
      run.dispose();
      host.stop();
    }
  });

  it("drives the drawn page by keyboard alone and the Plugin reacts", async () => {
    const { run, host } = await startRemoteUi();
    try {
      await host.renderPage("main");
      const user = userEvent.setup();

      const go = await screen.findByRole("button", { name: "Go" });
      for (let i = 0; i < 10 && document.activeElement !== go; i++) await user.tab();
      expect(go).toHaveFocus();
      await user.keyboard("{Enter}");

      expect(await screen.findByText("Runs: 1")).toBeInTheDocument();
    } finally {
      run.dispose();
      host.stop();
    }
  });

  it("coalesces two updates in one tick into one flush batch", async () => {
    const { run, host } = await startRemoteUi();
    try {
      const recording = await mountRecording(host, "batched", "page");
      await vi.waitFor(() => {
        expect(element(recording.receiver, "maibuk-button")).toBeDefined();
      });
      const before = recording.batches.length;

      const button = element(recording.receiver, "maibuk-button") as RemoteReceiverElement;
      void (button.eventListeners.press as () => unknown)();

      await vi.waitFor(() => {
        expect(textOf(recording.receiver, "maibuk-text")).toContain("left:1");
      });
      expect(textOf(recording.receiver, "maibuk-text")).toContain("right:1");
      expect(recording.batches.length - before).toBe(1);
    } finally {
      run.dispose();
      host.stop();
    }
  });
});
