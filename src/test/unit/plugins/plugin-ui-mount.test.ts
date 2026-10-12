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

  it("sends ui.unmount for the same surface exactly once and closes the port", async () => {
    const { broker, client } = harness();
    const requests: { method: string; params: unknown }[] = [];
    client.onHostRequest(async (method, params) => {
      requests.push({ method, params });
      return null;
    });

    const mount = openPluginUiMount(broker, "page.three");
    await mount.mounted;
    expect(requests.map((request) => request.method)).toEqual([PLUGIN_UI_MOUNT_REQUEST]);

    const close = vi.spyOn(mount.port, "close");
    mount.unmount();
    mount.unmount();

    await vi.waitFor(() =>
      expect(requests.map((request) => request.method)).toEqual([
        PLUGIN_UI_MOUNT_REQUEST,
        PLUGIN_UI_UNMOUNT_REQUEST,
      ])
    );
    expect(requests[1].params).toEqual({ surface: mount.surface });
    expect(close).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requests).toHaveLength(2);
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
    broker.stop("requested");

    expect(() => mount.unmount()).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requests).toEqual([PLUGIN_UI_MOUNT_REQUEST]);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
