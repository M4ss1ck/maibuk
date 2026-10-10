import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  PLUGIN_API_EVENTS,
  PLUGIN_API_NAMESPACES,
  PLUGIN_API_RESERVED_NAMESPACES,
  PLUGIN_API_TABLE,
  defineApiEvent,
  defineApiRow,
  inputJsonSchema,
  outputJsonSchema,
  payloadJsonSchema,
  projectMcpTools,
} from "@/features/plugins/api-table";
import {
  jsonSchemaToTypeScript,
  renderPluginApiDocs,
  renderPluginApiTypes,
} from "@/features/plugins/api-codegen";
import { createPluginBroker } from "@/features/plugins/broker";
import { PLUGIN_PERMISSION_NAMES } from "@/features/plugins/manifest-validate";
import type { BulkSignal, Change } from "@/features/sync/change-feed";
import type {
  PluginApiEventId,
  PluginApiEventRow,
  PluginApiEvents,
  PluginApiHandlers,
  PluginApiMethodId,
  PluginApiRow,
  PluginApiStreamingMethodId,
  PluginApiTable,
  PluginPermissionId,
} from "@/features/plugins/types";
import {
  PLUGIN_API_EVENT_IDS,
  PLUGIN_API_METHODS,
  PLUGIN_API_STREAMING_METHODS,
  type PluginApiEvents as GeneratedEvents,
  type PluginApiMethods,
} from "@/plugin-sdk/api.generated";

const UNGATED = new Set(["storage", "notifications", "navigation"]);

describe("PLUGIN_API_TABLE", () => {
  it("names every method <namespace>.<verb> with unique ids", () => {
    const ids = PLUGIN_API_TABLE.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z]*)+$/);
      expect(PLUGIN_API_NAMESPACES).toContain(id.split(".")[0]);
    }
  });

  it("declares no row in a reserved namespace", () => {
    expect(PLUGIN_API_RESERVED_NAMESPACES).toEqual(["process"]);
    for (const row of PLUGIN_API_TABLE) {
      expect(PLUGIN_API_RESERVED_NAMESPACES).not.toContain(row.id.split(".")[0]);
    }
  });

  it("gates every method by one Plugin Permission, except the ungated namespaces", () => {
    for (const row of PLUGIN_API_TABLE) {
      const namespace = row.id.split(".")[0];
      if (UNGATED.has(namespace)) {
        expect(row.permission, row.id).toBeNull();
      } else if (namespace === "network") {
        expect(row.permission, row.id).toBe("network");
      } else {
        expect(PLUGIN_PERMISSION_NAMES, row.id).toContain(row.permission);
      }
    }
  });

  it("puts reads under library:read and writes under library:write", () => {
    for (const row of PLUGIN_API_TABLE.filter((r) => r.id.startsWith("library."))) {
      expect(row.permission, row.id).toBe(row.effect === "read" ? "library:read" : "library:write");
      expect(row.requiresLibrary, row.id).toBe(true);
    }
  });

  it("keeps Echoes read-only: highlights need editor:decorate, never editor:write", () => {
    const highlights = PLUGIN_API_TABLE.find((r) => r.id === "editor.setHighlights");
    expect(highlights?.permission).toBe("editor:decorate");
  });

  it("rate-limits notifications to one per 5 s", () => {
    const show = PLUGIN_API_TABLE.find((r) => r.id === "notifications.show");
    expect(show?.minIntervalMs).toBe(5000);
  });

  it("describes every method and takes an object as input", () => {
    for (const row of PLUGIN_API_TABLE) {
      expect(row.description.length, row.id).toBeGreaterThan(10);
      expect(inputJsonSchema(row).type, row.id).toBe("object");
    }
  });

  it("emits JSON Schema for every input and output", () => {
    for (const row of PLUGIN_API_TABLE) {
      expect(() => inputJsonSchema(row)).not.toThrow();
      expect(() => outputJsonSchema(row)).not.toThrow();
    }
  });

  it("streams the network.fetch response body in chunks", () => {
    const streaming = PLUGIN_API_TABLE.filter((row) => "chunk" in row && row.chunk);
    expect(streaming.map((row) => row.id)).toEqual(["network.fetch"]);
  });
});

/** Every property name anywhere in a JSON Schema. */
function propertyNames(schema: unknown): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  const own = Object.keys((schema as { properties?: object }).properties ?? {});
  return [...own, ...Object.values(schema).flatMap(propertyNames)];
}

describe("PLUGIN_API_EVENTS", () => {
  it("lists the v1 events: library.changed, availability, and the two editor events", () => {
    expect(PLUGIN_API_EVENTS.map((event) => event.id)).toEqual([
      "library.changed",
      "library.availabilityChanged",
      "editor.contentChanged",
      "editor.focusChanged",
    ]);
  });

  it("gates each event by its namespace's read permission, availability by none", () => {
    for (const event of PLUGIN_API_EVENTS) {
      const namespace = event.id.split(".")[0];
      expect(PLUGIN_API_NAMESPACES).toContain(namespace);
      const expected = event.id === "library.availabilityChanged" ? null : `${namespace}:read`;
      expect(event.permission, event.id).toBe(expected);
    }
  });

  it("carries ids only, never content", () => {
    for (const event of PLUGIN_API_EVENTS) {
      const names = propertyNames(payloadJsonSchema(event));
      for (const forbidden of ["content", "text", "html", "title"]) {
        expect(names, event.id).not.toContain(forbidden);
      }
    }
  });
});

describe("projectMcpTools()", () => {
  const tools = projectMcpTools(PLUGIN_API_TABLE);

  it("emits one MCP-style tool per method", () => {
    expect(tools.map((t) => t.name)).toEqual(PLUGIN_API_TABLE.map((r) => r.id));
  });

  it("uses names and schemas an MCP client accepts", () => {
    for (const tool of tools) {
      // MCP tool names: 1-128 chars of A-Z a-z 0-9 _ - .
      expect(tool.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema).not.toHaveProperty("$schema");
      // MCP structuredContent is an object, so non-object outputs are wrapped as { result }.
      expect(tool.outputSchema.type).toBe("object");
    }
  });

  it("wraps a non-object output as { result } and keeps object outputs as they are", () => {
    const list = tools.find((t) => t.name === "library.books.list");
    expect(list?.outputSchema.required).toEqual(["result"]);
    expect((list?.outputSchema.properties as any).result.type).toBe("array");
    const create = tools.find((t) => t.name === "library.notes.create");
    expect(create?.outputSchema.properties).toHaveProperty("noteId");
  });

  it("marks reads read-only and writes not", () => {
    const books = tools.find((t) => t.name === "library.books.list");
    const update = tools.find((t) => t.name === "library.chapters.updateContent");
    expect(books?.annotations).toEqual({ readOnlyHint: true });
    expect(update?.annotations).toEqual({ readOnlyHint: false });
  });
});

describe("generated SDK files", () => {
  it("api.generated.ts is exactly what the generator emits (run pnpm generate:plugin-api)", () => {
    const committed = readFileSync("src/plugin-sdk/api.generated.ts", "utf8");
    expect(committed).toBe(renderPluginApiTypes(PLUGIN_API_TABLE));
  });

  it("api-reference.md is exactly what the generator emits (run pnpm generate:plugin-api)", () => {
    const committed = readFileSync("docs/plugins/api-reference.md", "utf8");
    expect(committed).toBe(renderPluginApiDocs(PLUGIN_API_TABLE));
  });

  it("lists every table method, streaming method, and event at runtime for the SDK client", () => {
    expect([...PLUGIN_API_METHODS]).toEqual(PLUGIN_API_TABLE.map((r) => r.id));
    expect([...PLUGIN_API_STREAMING_METHODS]).toEqual(["network.fetch"]);
    expect([...PLUGIN_API_EVENT_IDS]).toEqual(PLUGIN_API_EVENTS.map((e) => e.id));
  });
});

describe("SDK entry point", () => {
  it("imports nothing outside src/plugin-sdk/, because Plugins bundle it", () => {
    for (const file of readdirSync("src/plugin-sdk")) {
      const source = readFileSync(`src/plugin-sdk/${file}`, "utf8");
      const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const specifier of specifiers) {
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^@\/plugin-sdk\//);
      }
    }
  });
});

describe("adding a row", () => {
  const extra: PluginApiRow = defineApiRow({
    id: "library.books.countWords",
    description: "Counts the words in one Book.",
    input: z.strictObject({ bookId: z.string() }),
    output: z.strictObject({ words: z.int() }),
    permission: "library:read",
    effect: "read",
    requiresLibrary: true,
  });
  const table = [...PLUGIN_API_TABLE, extra];

  it("reaches the SDK types, the docs stub, and the MCP list with no other change", () => {
    const types = renderPluginApiTypes(table);
    expect(types).toContain('"library.books.countWords"');
    expect(types).toMatch(/countWords\(params: PluginApiMethods\["library\.books\.countWords"\]/);
    expect(renderPluginApiDocs(table)).toContain("### `library.books.countWords`");
    expect(projectMcpTools(table).map((t) => t.name)).toContain("library.books.countWords");
  });

  it("reaches the broker's Plugin Permission and schema checks with no other change", async () => {
    const channel = new MessageChannel();
    const granted = new Set<PluginPermissionId>(["library:read"]);
    createPluginBroker({
      pluginId: "fixture",
      port: channel.port1,
      declared: ["library:read"],
      granted: () => granted,
      table,
      handlers: { "library.books.countWords": async () => ({ words: 3 }) } as PluginApiHandlers,
    });
    const send = (id: number, params: unknown) =>
      new Promise<unknown>((resolve) => {
        channel.port2.onmessage = (event) => resolve(event.data);
        channel.port2.postMessage(
          JSON.stringify({ kind: "call", id, method: "library.books.countWords", params })
        );
      });
    try {
      expect(await send(1, { bookId: "b1" })).toEqual({
        kind: "result",
        id: 1,
        ok: true,
        result: { words: 3 },
      });
      expect(await send(2, {})).toMatchObject({ ok: false, error: { code: "invalid-params" } });
      granted.clear();
      expect(await send(3, { bookId: "b1" })).toMatchObject({
        ok: false,
        error: { code: "permission-denied", permission: "library:read" },
      });
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });
});

describe("adding an event", () => {
  const extra: PluginApiEventRow = defineApiEvent({
    id: "library.bookOpened",
    description: "A Book was opened in the editor.",
    payload: z.strictObject({ bookId: z.string() }),
    permission: "library:read",
  });
  const events = [...PLUGIN_API_EVENTS, extra];

  it("reaches the SDK types and the docs stub with no other change", () => {
    const types = renderPluginApiTypes(PLUGIN_API_TABLE, events);
    expect(types).toContain('"library.bookOpened": {\n    bookId: string;\n  };');
    expect(renderPluginApiDocs(PLUGIN_API_TABLE, events)).toContain("### `library.bookOpened`");
  });

  it("reaches the broker's subscription and Plugin Permission checks with no other change", async () => {
    const channel = new MessageChannel();
    const granted = new Set<PluginPermissionId>(["library:read"]);
    const broker = createPluginBroker({
      pluginId: "fixture",
      port: channel.port1,
      declared: ["library:read"],
      granted: () => granted,
      events,
    });
    const next = () =>
      new Promise<unknown>((resolve) => {
        channel.port2.onmessage = (message) => resolve(message.data);
      });
    const send = (id: number, event: string) => {
      const reply = next();
      channel.port2.postMessage(JSON.stringify({ kind: "subscribe", id, event }));
      return reply;
    };
    const emit = broker.emit as (event: string, payload: unknown) => boolean;
    try {
      expect(await send(1, "library.bookOpened")).toMatchObject({ id: 1, ok: true });
      const delivered = next();
      expect(emit("library.bookOpened", { bookId: "b1" })).toBe(true);
      expect(await delivered).toEqual({
        kind: "event",
        event: "library.bookOpened",
        payload: { bookId: "b1" },
      });
      granted.clear();
      expect(emit("library.bookOpened", { bookId: "b1" })).toBe(false);
      expect(await send(2, "library.bookOpened")).toMatchObject({
        ok: false,
        error: { code: "permission-denied", permission: "library:read" },
      });
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });
});

describe("jsonSchemaToTypeScript()", () => {
  const ts = (schema: z.ZodType) =>
    jsonSchemaToTypeScript(z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>, "");

  it("maps primitives, literals, enums, and null", () => {
    expect(ts(z.string())).toBe("string");
    expect(ts(z.int())).toBe("number");
    expect(ts(z.number())).toBe("number");
    expect(ts(z.boolean())).toBe("boolean");
    expect(ts(z.null())).toBe("null");
    expect(ts(z.literal("ok"))).toBe('"ok"');
    expect(ts(z.enum(["a", "b"]))).toBe('"a" | "b"');
    expect(ts(z.unknown())).toBe("unknown");
  });

  it("maps arrays, records, unions, and nullable values", () => {
    expect(ts(z.array(z.string()))).toBe("string[]");
    expect(ts(z.array(z.union([z.string(), z.number()])))).toBe("(string | number)[]");
    expect(ts(z.record(z.string(), z.string()))).toBe("Record<string, string>");
    expect(ts(z.string().nullable())).toBe("string | null");
    expect(jsonSchemaToTypeScript({ type: ["integer", "null"] }, "")).toBe("number | null");
  });

  it("maps objects with optional keys and descriptions as doc comments", () => {
    const out = ts(z.strictObject({ a: z.string().describe("The a."), b: z.int().optional() }));
    expect(out).toBe("{\n  /** The a. */\n  a: string;\n  b?: number;\n}");
    expect(ts(z.strictObject({}))).toBe("Record<string, never>");
  });

  it("refuses a keyword it does not translate, so a new row cannot silently lose types", () => {
    expect(() => jsonSchemaToTypeScript({ $ref: "#/$defs/x" }, "")).toThrow(/\$ref/);
    expect(() => jsonSchemaToTypeScript({ type: "string", pattern: "^a" }, "")).not.toThrow();
    expect(() => jsonSchemaToTypeScript({ allOf: [] }, "")).toThrow(/allOf/);
  });
});

// Type-level: the generated SDK types say exactly what the Zod rows accept and return.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type RowOf<M extends PluginApiMethodId> = Extract<PluginApiTable[number], { id: M }>;
type InputMismatch = {
  [M in PluginApiMethodId]: Same<
    PluginApiMethods[M]["input"],
    z.input<RowOf<M>["input"]>
  > extends true
    ? never
    : M;
}[PluginApiMethodId];
type OutputMismatch = {
  [M in PluginApiMethodId]: Same<
    PluginApiMethods[M]["output"],
    z.output<RowOf<M>["output"]>
  > extends true
    ? never
    : M;
}[PluginApiMethodId];

type ChunkMismatch = {
  [M in PluginApiStreamingMethodId]: Same<
    PluginApiMethods[M] extends { chunk: infer C } ? C : never,
    z.output<NonNullable<RowOf<M>["chunk"]>>
  > extends true
    ? never
    : M;
}[PluginApiStreamingMethodId];
type EventMismatch = {
  [E in PluginApiEventId]: Same<GeneratedEvents[E], PluginApiEventPayloadOf<E>> extends true
    ? never
    : E;
}[PluginApiEventId];
type PluginApiEventPayloadOf<E extends PluginApiEventId> = z.output<
  Extract<PluginApiEvents[number], { id: E }>["payload"]
>;

describe("generated types", () => {
  it("match the Zod rows for every method's input, output, and chunk, and every event", () => {
    expectTypeOf<InputMismatch>().toEqualTypeOf<never>();
    expectTypeOf<OutputMismatch>().toEqualTypeOf<never>();
    expectTypeOf<ChunkMismatch>().toEqualTypeOf<never>();
    expectTypeOf<EventMismatch>().toEqualTypeOf<never>();
    expectTypeOf<PluginApiStreamingMethodId>().toEqualTypeOf<"network.fetch">();
  });

  it("pass the Change Feed's own shapes through library.changed, so they cannot drift", () => {
    expectTypeOf<PluginApiEventPayloadOf<"library.changed">>().toEqualTypeOf<
      Change | BulkSignal
    >();
  });
});
