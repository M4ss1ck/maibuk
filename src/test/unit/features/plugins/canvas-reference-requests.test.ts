import { describe, expect, it, vi } from "vitest";
import {
  CANVAS_REFERENCE_MAX_ROWS,
  CANVAS_REFERENCE_MAX_TEXT,
  CANVAS_REFERENCE_REQUEST_TIMEOUT_MS,
  listPluginCanvasReferences,
  openPluginCanvasReference,
  resolvePluginCanvasReferences,
} from "@/features/plugins/canvas-reference-requests";
import type { PluginCanvasReferenceSourceDef } from "@/features/plugins/contributions-registry";
import type {
  PluginLifecycle,
  PluginLifecycleState,
  PluginRuntime,
} from "@/features/plugins/types";

const def = {
  pluginId: "sample",
  displayName: "Sample",
  localId: "items",
  id: "plugin.sample.items",
} as unknown as PluginCanvasReferenceSourceDef;

function stubLifecycle(
  state: () => PluginLifecycleState,
  runtime: () => PluginRuntime | null,
  start: PluginLifecycle["start"] = vi.fn(async () => ({
    ok: true as const,
    startReason: "warmStart" as const,
  }))
): PluginLifecycle {
  return { state, runtime, start } as unknown as PluginLifecycle;
}

/** A ready Plugin whose broker answers with `answer`. */
function readyLifecycle(answer: () => Promise<unknown>) {
  const request = vi.fn(answer);
  const runtime = { broker: { request }, stop: vi.fn() } as unknown as PluginRuntime;
  const lifecycle = stubLifecycle(
    () => ({ status: "ready", startReason: "launch" }),
    () => runtime
  );
  return { lifecycle, request };
}

describe("listPluginCanvasReferences", () => {
  it("sends the Plugin-local source id and the query", async () => {
    const { lifecycle, request } = readyLifecycle(async () => ({ rows: [] }));

    await listPluginCanvasReferences(lifecycle, def, "drag");

    expect(request).toHaveBeenCalledWith("canvasReference.list", {
      source: "items",
      query: "drag",
    });
  });

  it("cuts more rows than the cap to the cap", async () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({
      id: `item-${index}`,
      title: `Item ${index}`,
    }));
    const { lifecycle } = readyLifecycle(async () => ({ rows }));

    const listed = await listPluginCanvasReferences(lifecycle, def, "");

    expect(listed).toHaveLength(CANVAS_REFERENCE_MAX_ROWS);
    expect(listed[0]).toEqual({ id: "item-0", title: "Item 0" });
  });

  it("caps the title and the subtitle at the text limit", async () => {
    const long = "x".repeat(500);
    const { lifecycle } = readyLifecycle(async () => ({
      rows: [{ id: "one", title: long, subtitle: long }],
    }));

    const [row] = await listPluginCanvasReferences(lifecycle, def, "");

    expect(row?.title).toHaveLength(CANVAS_REFERENCE_MAX_TEXT);
    expect(row?.subtitle).toHaveLength(CANVAS_REFERENCE_MAX_TEXT);
  });

  it("passes markup through as plain text", async () => {
    const { lifecycle } = readyLifecycle(async () => ({
      rows: [{ id: "one", title: "<b>x</b>" }],
    }));

    await expect(listPluginCanvasReferences(lifecycle, def, "")).resolves.toEqual([
      { id: "one", title: "<b>x</b>" },
    ]);
  });

  it("drops rows without an id or a title", async () => {
    const { lifecycle } = readyLifecycle(async () => ({
      rows: [
        { id: "", title: "No id" },
        { id: "untitled" },
        { title: "No id either" },
        "junk",
        null,
        { id: "ok", title: "Ok", subtitle: 42 },
      ],
    }));

    await expect(listPluginCanvasReferences(lifecycle, def, "")).resolves.toEqual([
      { id: "ok", title: "Ok" },
    ]);
  });

  it("rejects when the Plugin does not answer in time", async () => {
    vi.useFakeTimers();
    try {
      const { lifecycle, request } = readyLifecycle(() => new Promise<never>(() => {}));
      const pending = listPluginCanvasReferences(lifecycle, def, "");
      const rejected = expect(pending).rejects.toThrow(/did not answer/);

      await vi.advanceTimersByTimeAsync(CANVAS_REFERENCE_REQUEST_TIMEOUT_MS);
      await rejected;
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("warm-starts a stopped Plugin before the request", async () => {
    const request = vi.fn(async () => ({ rows: [] }));
    const runtime = { broker: { request }, stop: vi.fn() } as unknown as PluginRuntime;
    let status: PluginLifecycleState = { status: "stopped", reason: null, refusal: null };
    const start = vi.fn(async () => {
      status = { status: "ready", startReason: "warmStart" };
      return { ok: true as const, startReason: "warmStart" as const };
    });
    const lifecycle = stubLifecycle(
      () => status,
      () => runtime,
      start
    );

    await listPluginCanvasReferences(lifecycle, def, "");

    expect(start).toHaveBeenCalledWith("sample", "warmStart");
    expect(start.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]);
    expect(request).toHaveBeenCalledWith("canvasReference.list", {
      source: "items",
      query: "",
    });
  });

  it("rejects and sends nothing when the warm start is refused", async () => {
    const request = vi.fn(async () => ({ rows: [] }));
    const start = vi.fn(async () => ({
      ok: false as const,
      refusal: { code: "not-installed" as const },
    }));
    const lifecycle = stubLifecycle(
      () => ({ status: "stopped", reason: null, refusal: null }),
      () => null,
      start
    );

    await expect(listPluginCanvasReferences(lifecycle, def, "")).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects with no lifecycle", async () => {
    await expect(listPluginCanvasReferences(null, def, "")).rejects.toThrow();
  });
});

describe("resolvePluginCanvasReferences", () => {
  it("keeps the asked ids, maps present and missing, and drops a bad entry", async () => {
    const { lifecycle, request } = readyLifecycle(async () => ({
      a: { status: "present", title: "A", subtitle: "sub" },
      gone: { status: "missing" },
      unasked: { status: "present", title: "Not asked" },
      bad: { status: "present" },
      weird: { status: "elsewhere" },
    }));

    const answers = await resolvePluginCanvasReferences(lifecycle, def, [
      "a",
      "gone",
      "bad",
      "weird",
    ]);

    expect(request).toHaveBeenCalledWith("canvasReference.resolve", {
      source: "items",
      ids: ["a", "gone", "bad", "weird"],
    });
    expect(answers).toEqual({
      a: { status: "present", title: "A", value: { subtitle: "sub" } },
      gone: { status: "missing" },
    });
  });

  it("caps the title and subtitle of a present answer", async () => {
    const long = "y".repeat(500);
    const { lifecycle } = readyLifecycle(async () => ({
      a: { status: "present", title: long, subtitle: long },
    }));

    const [answer] = Object.values(await resolvePluginCanvasReferences(lifecycle, def, ["a"]));

    expect(answer?.status).toBe("present");
    if (answer?.status !== "present") return;
    expect(answer.title).toHaveLength(CANVAS_REFERENCE_MAX_TEXT);
    expect(answer.value).toEqual({ subtitle: long.slice(0, CANVAS_REFERENCE_MAX_TEXT) });
  });
});

describe("openPluginCanvasReference", () => {
  it("passes opened and missing through", async () => {
    const opened = readyLifecycle(async () => "opened");
    await expect(openPluginCanvasReference(opened.lifecycle, def, "a")).resolves.toBe("opened");
    expect(opened.request).toHaveBeenCalledWith("canvasReference.open", {
      source: "items",
      id: "a",
    });

    const missing = readyLifecycle(async () => "missing");
    await expect(openPluginCanvasReference(missing.lifecycle, def, "a")).resolves.toBe("missing");
  });

  it("rejects an answer that is neither opened nor missing", async () => {
    const { lifecycle } = readyLifecycle(async () => "yes");

    await expect(openPluginCanvasReference(lifecycle, def, "a")).rejects.toThrow();
  });
});
