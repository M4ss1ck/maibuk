import { afterEach, describe, expect, it } from "vitest";
import { clearPluginApprovals, savePluginApproval } from "@/features/plugins/approvals";
import { dispatchSeamEndpointRequest } from "@/features/plugins/endpoint-seam";
import {
  resetPluginLifecycleForTests,
  setPluginLifecycleInstance,
} from "@/features/plugins/lifecycle-instance";
import type {
  PluginApproval,
  PluginEndpointSink,
  PluginLifecycle,
  PluginManifest,
  PluginRuntime,
} from "@/features/plugins/types";
import { type EndpointRequest, bytesToBase64 } from "@/plugin-sdk/protocol";

/**
 * The seam reads the app's live lifecycle and approvals (#586). These tests
 * stand in one running Plugin holding `serve` whose broker answers the way the
 * shape under test needs, which is all the seam itself decides.
 */
function servingRuntime(answer: (sink: PluginEndpointSink) => void): PluginRuntime {
  const manifest = {
    id: "acme",
    permissions: { required: ["serve"], optional: [] },
  } as unknown as PluginManifest;
  const approval: PluginApproval = {
    pluginId: "acme",
    pinnedHash: "h1:test",
    granted: ["serve"],
    enabled: true,
    approvedVersion: "1.0.0",
    approvedPermissions: { required: ["serve"], optional: [] },
    approvedFiles: {},
  };
  savePluginApproval(approval);
  return {
    manifest,
    broker: {
      requestEndpoint: (_request: EndpointRequest, sink: PluginEndpointSink) => answer(sink),
    },
    files: [],
    sendFrame: () => {},
    stop: () => {},
  } as unknown as PluginRuntime;
}

/** Installs one Plugin as the app's running runtime. */
function serve(runtime: PluginRuntime): void {
  setPluginLifecycleInstance({
    runtime: (pluginId: string) => (runtime.manifest.id === pluginId ? runtime : null),
    dispose: () => {},
  } as unknown as PluginLifecycle);
}

afterEach(() => {
  resetPluginLifecycleForTests();
  clearPluginApprovals();
});

describe("dispatchSeamEndpointRequest", () => {
  it("decodes a multi-byte character split across two chunks intact", async () => {
    // "héllo" with the two bytes of "é" split between the chunks: decoding each
    // chunk on its own would turn both halves into U+FFFD.
    const bytes = new TextEncoder().encode("héllo");
    expect(Array.from(bytes.slice(0, 2))).toEqual([104, 195]);
    serve(
      servingRuntime((sink) => {
        sink.respond(200, [["content-type", "text/plain"]], undefined, true);
        sink.chunk(bytesToBase64(bytes.slice(0, 2)));
        sink.chunk(bytesToBase64(bytes.slice(2)));
        sink.end();
      })
    );

    const answer = await dispatchSeamEndpointRequest("acme", { path: "/plugin/acme/hello" });

    expect(answer.status).toBe(200);
    expect(answer.headers).toEqual([["content-type", "text/plain"]]);
    expect(answer.chunks).toEqual(["h", "éllo"]);
    expect(answer.text).toBe("héllo");
  });

  it("returns a whole answer's status, headers and text", async () => {
    serve(
      servingRuntime((sink) => {
        sink.respond(201, [["x-tag", "a"]], bytesToBase64(new TextEncoder().encode("pong")), false);
      })
    );

    const answer = await dispatchSeamEndpointRequest("acme", {
      method: "POST",
      path: "/plugin/acme/mcp",
    });

    expect(answer).toEqual({
      status: 201,
      headers: [["x-tag", "a"]],
      chunks: [],
      text: "pong",
    });
  });
});
