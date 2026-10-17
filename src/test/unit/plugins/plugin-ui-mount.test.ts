import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginBroker } from "@/features/plugins/broker";
import { openPluginUiMount } from "@/features/plugins/remote-ui";
import { createPluginClient } from "@/plugin-sdk";
import {
  PLUGIN_UI_MOUNT_REQUEST,
  PLUGIN_UI_UNMOUNT_REQUEST,
} from "@/plugin-sdk/protocol";

const channels: MessageChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

/** The real broker and SDK client over one in-process MessageChannel. */
function harness() {
  const channel = new MessageChannel();
  channels.push(channel);
  const broker = createPluginBroker({
    pluginId: "fixture",
    port: channel.port1,
    declared: [],
    granted: () => [],
  });
  const client = createPluginClient(channel.port2);
  return { broker, client };
}

describe("openPluginUiMount", () => {
  it("asks the Plugin to mount the page over a working transferred port", async () => {
    const { broker, client } = harness();
    const mounts: { surface: string; page: string; port: MessagePort }[] = [];
    client.onHostRequest(async (method, params) => {
      if (method === PLUGIN_UI_MOUNT_REQUEST) {
        mounts.push(params as { surface: string; page: string; port: MessagePort });
      }
      return null;
    });

    const mount = openPluginUiMount(broker, "page.one");
    await mount.mounted;

    expect(mounts).toHaveLength(1);
    expect(mounts[0].surface).toBe(mount.surface);
    expect(mounts[0].page).toBe("page.one");
    expect(mounts[0].port).toBeInstanceOf(MessagePort);

    const pluginSaid = new Promise<string>((resolve) => {
      mount.port.onmessage = (event) => resolve(event.data as string);
    });
    mounts[0].port.postMessage("from the plugin");
    await expect(pluginSaid).resolves.toBe("from the plugin");

    const hostSaid = new Promise<string>((resolve) => {
      mounts[0].port.onmessage = (event) => resolve(event.data as string);
    });
    mount.port.postMessage("from the host");
    await expect(hostSaid).resolves.toBe("from the host");
  });

  it("gives each mount its own surface id", async () => {
    const { broker, client } = harness();
    client.onHostRequest(async () => null);
    const first = openPluginUiMount(broker, "page.one");
    const second = openPluginUiMount(broker, "page.one");
    await Promise.all([first.mounted, second.mounted]);
    expect(first.surface).not.toBe(second.surface);
  });

  it("rejects mounted with the broker's error when the handler throws", async () => {
    const { broker, client } = harness();
    client.onHostRequest(async () => {
      throw new Error("no such page");
    });
    const mount = openPluginUiMount(broker, "page.two");
    await expect(mount.mounted).rejects.toMatchObject({
      code: "internal-error",
      message: "no such page",
    });
  });

  it("does not become an unhandled rejection when a refused mount is never awaited", async () => {
    const { broker, client } = harness();
    client.onHostRequest(async (method) => {
      if (method === "health.check") return "pong";
      throw new Error("no such page");
    });
    // Deliberately never observe `mounted` until after the rejection settles;
    // vitest fails the run on an unhandled rejection, so this test only passes
    // when the module attaches its own no-op handler. The refusal and the
    // witness are replies on one port, which the host reads in order: the
    // witness settling means the refusal has settled first.
    const mount = openPluginUiMount(broker, "page.refused");
    await expect(broker.request("health.check", {})).resolves.toBe("pong");
    await expect(mount.mounted).rejects.toMatchObject({ message: "no such page" });
  });

  it("sends ui.unmount for the same surface exactly once and closes the port", async () => {
    const { broker, client } = harness();
    const requests: { method: string; params: unknown }[] = [];
    client.onHostRequest(async (method, params) => {
      requests.push({ method, params });
      return method === "health.check" ? "pong" : null;
    });

    const mount = openPluginUiMount(broker, "page.three");
    await mount.mounted;
    expect(requests.map((request) => request.method)).toEqual([PLUGIN_UI_MOUNT_REQUEST]);

    const close = vi.spyOn(mount.port, "close");
    mount.unmount();
    mount.unmount();

    // The second unmount sends nothing. The witness is queued behind any unmount
    // that was sent, so once it resolves the host has seen every request.
    await expect(broker.request("health.check", {})).resolves.toBe("pong");
    expect(requests.map((request) => request.method)).toEqual([
      PLUGIN_UI_MOUNT_REQUEST,
      PLUGIN_UI_UNMOUNT_REQUEST,
      "health.check",
    ]);
    expect(requests[1].params).toEqual({ surface: mount.surface });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not send ui.unmount and does not throw once the broker is stopped", async () => {
    const { broker, client } = harness();
    const requests: string[] = [];
    client.onHostRequest(async (method) => {
      requests.push(method);
      return null;
    });

    const mount = openPluginUiMount(broker, "page.four");
    await mount.mounted;
    const close = vi.spyOn(mount.port, "close");
    // A stopped broker takes no messages, so no event could witness a skipped send.
    // unmount() decides synchronously, and the send is the broker's request call.
    const send = vi.spyOn(broker, "request");
    broker.stop("requested");

    expect(() => mount.unmount()).not.toThrow();

    expect(send).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(requests).toEqual([PLUGIN_UI_MOUNT_REQUEST]);
  });
});
