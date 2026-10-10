import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  PLUGIN_API_NAMESPACES,
  PLUGIN_API_RESERVED_NAMESPACES,
  PLUGIN_API_TABLE,
  type PluginApiMethodId,
  type PluginApiRow,
  type PluginApiTable,
  defineApiRow,
  inputJsonSchema,
  outputJsonSchema,
  projectMcpTools,
} from "@/features/plugins/api-table";
import {
  jsonSchemaToTypeScript,
  renderPluginApiDocs,
  renderPluginApiTypes,
} from "@/features/plugins/api-codegen";
import { type PluginApiHandlers, createPluginBroker } from "@/features/plugins/broker";
import { PLUGIN_PERMISSION_NAMES } from "@/features/plugins/manifest-validate";
import { PLUGIN_API_METHODS, type PluginApiMethods } from "@/plugin-sdk/api.generated";

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

  it("lists every table method at runtime for the SDK client", () => {
    expect([...PLUGIN_API_METHODS]).toEqual(PLUGIN_API_TABLE.map((r) => r.id));
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
    const grants = new Set(["library:read"]);
    createPluginBroker({
      pluginId: "fixture",
      port: channel.port1,
      declared: ["library:read"],
      granted: () => grants,
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
      grants.clear();
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

describe("generated types", () => {
  it("match the Zod rows for every method's input and output", () => {
    expectTypeOf<InputMismatch>().toEqualTypeOf<never>();
    expectTypeOf<OutputMismatch>().toEqualTypeOf<never>();
  });
});
