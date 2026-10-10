/**
 * Renders the Plugin API table into the SDK's TypeScript types and the API
 * reference stub. `pnpm generate:plugin-api` writes both files; a gate test
 * fails when either is stale.
 *
 * The JSON Schema to TypeScript step covers the subset Zod emits for the
 * table and throws on anything else, so a row that needs a new keyword fails
 * here instead of shipping a wrong type.
 */

import {
  PLUGIN_API_RESERVED_NAMESPACES,
  PLUGIN_API_VERSION,
  type PluginApiRow,
  inputJsonSchema,
  outputJsonSchema,
} from "@/features/plugins/api-table";
import { PLUGIN_API_ERROR_CODES } from "@/plugin-sdk/protocol";

type JsonSchema = Record<string, unknown>;

// Validation-only keywords: they narrow values but do not change the type.
const IGNORED_KEYWORDS = new Set([
  "$schema",
  "description",
  "default",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "propertyNames",
]);
const TYPE_KEYWORDS = new Set([
  "type",
  "const",
  "enum",
  "anyOf",
  "oneOf",
  "items",
  "properties",
  "required",
  "additionalProperties",
]);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function docComment(text: string, indent: string): string {
  return `${indent}/** ${text.replace(/\*\//g, "*\\/")} */\n`;
}

function propertyKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

function needsParens(type: string): boolean {
  return type.includes(" | ") && !type.startsWith("{");
}

function objectType(schema: JsonSchema, indent: string): string {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema.required ?? []) as string[]);
  const keys = Object.keys(properties);
  const extra = schema.additionalProperties;
  if (keys.length === 0) {
    if (extra === false) return "Record<string, never>";
    if (extra === undefined || extra === true) return "Record<string, unknown>";
    return `Record<string, ${jsonSchemaToTypeScript(extra as JsonSchema, indent)}>`;
  }
  if (extra !== undefined && extra !== false) {
    throw new Error("an object with both properties and additionalProperties is not translated");
  }
  const inner = `${indent}  `;
  const lines = keys.map((key) => {
    const property = properties[key];
    const optional = required.has(key) ? "" : "?";
    const doc =
      typeof property.description === "string" ? docComment(property.description, inner) : "";
    return `${doc}${inner}${propertyKey(key)}${optional}: ${jsonSchemaToTypeScript(property, inner)};`;
  });
  return `{\n${lines.join("\n")}\n${indent}}`;
}

/** One JSON Schema as a TypeScript type expression, nested lines indented from `indent`. */
export function jsonSchemaToTypeScript(schema: JsonSchema, indent: string): string {
  for (const keyword of Object.keys(schema)) {
    if (!IGNORED_KEYWORDS.has(keyword) && !TYPE_KEYWORDS.has(keyword)) {
      throw new Error(`JSON Schema keyword "${keyword}" is not translated to TypeScript`);
    }
  }
  if ("const" in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  }
  const union = (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined;
  if (union) return union.map((member) => jsonSchemaToTypeScript(member, indent)).join(" | ");
  if (Array.isArray(schema.type)) {
    return schema.type
      .map((type) => jsonSchemaToTypeScript({ ...schema, type }, indent))
      .join(" | ");
  }
  switch (schema.type) {
    case undefined:
      return "unknown";
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      const item = jsonSchemaToTypeScript((schema.items ?? {}) as JsonSchema, indent);
      return needsParens(item) ? `(${item})[]` : `${item}[]`;
    }
    case "object":
      return objectType(schema, indent);
    default:
      throw new Error(`JSON Schema type ${JSON.stringify(schema.type)} is not translated`);
  }
}

function hasRequiredInput(row: PluginApiRow): boolean {
  const required = inputJsonSchema(row).required;
  return Array.isArray(required) && required.length > 0;
}

interface NamespaceNode {
  children: Map<string, NamespaceNode>;
  row?: PluginApiRow;
}

function namespaceTree(table: readonly PluginApiRow[]): NamespaceNode {
  const root: NamespaceNode = { children: new Map() };
  for (const row of table) {
    let node = root;
    for (const part of row.id.split(".")) {
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map() };
        node.children.set(part, child);
      }
      node = child;
    }
    node.row = row;
  }
  return root;
}

function renderClientNode(node: NamespaceNode, indent: string): string {
  const lines: string[] = [];
  for (const [name, child] of node.children) {
    if (child.row) {
      const row = child.row;
      const method = `PluginApiMethods[${JSON.stringify(row.id)}]`;
      const optional = hasRequiredInput(row) ? "" : "?";
      lines.push(
        `${docComment(row.description, indent)}${indent}${name}(params${optional}: ${method}["input"]): Promise<${method}["output"]>;`
      );
    } else {
      lines.push(`${indent}${name}: {\n${renderClientNode(child, `${indent}  `)}\n${indent}};`);
    }
  }
  return lines.join("\n");
}

const GENERATED_NOTE =
  "Generated by `pnpm generate:plugin-api` from src/features/plugins/api-table.ts";

/** The SDK's `api.generated.ts`: method ids, per-method input/output types, and the client shape. */
export function renderPluginApiTypes(table: readonly PluginApiRow[]): string {
  const ids = table.map((row) => `  ${JSON.stringify(row.id)},`).join("\n");
  const methods = table
    .map((row) => {
      const input = jsonSchemaToTypeScript(inputJsonSchema(row), "    ");
      const output = jsonSchemaToTypeScript(outputJsonSchema(row), "    ");
      return `${docComment(row.description, "  ")}  ${JSON.stringify(row.id)}: {\n    input: ${input};\n    output: ${output};\n  };`;
    })
    .join("\n");
  return `// ${GENERATED_NOTE}. Do not edit.

export const PLUGIN_API_VERSION = ${JSON.stringify(PLUGIN_API_VERSION)};

export const PLUGIN_API_METHODS = [
${ids}
] as const;

export type PluginApiMethodId = (typeof PLUGIN_API_METHODS)[number];

export interface PluginApiMethods {
${methods}
}

export interface PluginApi {
${renderClientNode(namespaceTree(table), "  ")}
}
`;
}

function permissionLabel(row: PluginApiRow): string {
  if (row.permission === null) return "none (rate-limited instead)";
  if (row.permission === "network") return "`network:<host>` matching the URL's host";
  return `\`${row.permission}\``;
}

/** The API reference stub in `docs/plugins/api-reference.md`. */
export function renderPluginApiDocs(table: readonly PluginApiRow[]): string {
  const sections: string[] = [];
  let namespace = "";
  for (const row of table) {
    const rowNamespace = row.id.split(".")[0];
    if (rowNamespace !== namespace) {
      namespace = rowNamespace;
      sections.push(`## ${namespace}`);
    }
    const facts = [
      `- Plugin Permission: ${permissionLabel(row)}`,
      `- Effect: ${row.effect}`,
      ...(row.requiresLibrary
        ? ["- Refused with `library-unavailable` while the Library cannot be read or written"]
        : []),
      ...(row.minIntervalMs ? [`- At most one call every ${row.minIntervalMs / 1000} s`] : []),
    ];
    sections.push(
      [
        `### \`${row.id}\``,
        row.description,
        facts.join("\n"),
        `Input:\n\n\`\`\`ts\n${jsonSchemaToTypeScript(inputJsonSchema(row), "")}\n\`\`\``,
        `Output:\n\n\`\`\`ts\n${jsonSchemaToTypeScript(outputJsonSchema(row), "")}\n\`\`\``,
      ].join("\n\n")
    );
  }
  const reserved = PLUGIN_API_RESERVED_NAMESPACES.map(
    (name) => `- \`${name}\`: every call refuses with \`not-implemented\`.`
  ).join("\n");
  const errors = PLUGIN_API_ERROR_CODES.map((code) => `- \`${code}\``).join("\n");
  return `# Plugin API reference

${GENERATED_NOTE}. Do not edit by hand.

Plugin API version: \`${PLUGIN_API_VERSION}\`. Before 1.0 there is no compatibility promise.

Every method returns a promise. A refused call rejects with a \`PluginApiError\` whose \`code\` is one of:

${errors}

A \`permission-denied\` error also names the missing Plugin Permission in \`permission\`.

${sections.join("\n\n")}

## Reserved namespaces

${reserved}
`;
}
