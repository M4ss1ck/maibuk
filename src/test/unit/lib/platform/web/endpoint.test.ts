import { describe, expect, it, vi } from "vitest";
import { webPluginEndpoint } from "@/lib/platform/web/endpoint";

describe("webPluginEndpoint", () => {
  it("stays off and never delivers a request", async () => {
    const onRequest = vi.fn();

    const state = await webPluginEndpoint.sync(["acme"], onRequest);

    expect(state).toEqual({ state: "off" });
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("accepts an answer that can never reach a socket", async () => {
    await expect(webPluginEndpoint.respond("7", 200, [], "aGk=", false)).resolves.toBeUndefined();
    await expect(webPluginEndpoint.chunk("7", "aGk=")).resolves.toBe(false);
    await expect(webPluginEndpoint.end("7")).resolves.toBeUndefined();
  });
});
