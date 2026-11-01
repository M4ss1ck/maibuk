import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Launch parses and holds only what the first screen needs (RAM, PR #680).
// These read the sources, because a single static import puts a whole
// screen or library back into the launch chunk without any test noticing.

const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

/** The specifiers a file imports statically (not `import()`, not `import type`). */
function staticImports(source: string): string[] {
  return [...source.matchAll(/^import (?!type )[^;]*?from "([^"]+)";/gms)].map((m) => m[1] ?? "");
}

describe("launch chunk", () => {
  it("App loads every screen lazily except Home and Embed", () => {
    const pages = staticImports(read("src/App.tsx")).filter((s) => s.startsWith("@/pages/"));
    expect(pages.sort()).toEqual(["@/pages/Embed", "@/pages/Home"]);
  });
});

/** The modules behind PDF and image export: @react-pdf and html-to-image, about 1.5 MB. */
const EXPORT_RUNTIMES = [
  "@/features/export/pdf-generator",
  "@/features/export/document-pdf",
  "@/features/export/pdf-document",
  "@/features/export/pdf-content-renderer",
  "@/features/export/pdf-styles",
  "@/features/export/element-to-image",
  "@react-pdf/renderer",
  "html-to-image",
];

function appSources(dir: string): string[] {
  return readdirSync(resolve(__dirname, "../../..", dir), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts"))
    .map((f) => `${dir}/${f}`);
}

describe("screen chunks: export runtimes", () => {
  it("the export barrel re-exports no PDF or image runtime", () => {
    const reexports = [
      ...read("src/features/export/index.ts").matchAll(/^export (?!type )[^;]*?from "([^"]+)";/gms),
    ].map((m) => m[1]);
    expect(reexports.filter((s) => EXPORT_RUNTIMES.includes(s ?? ""))).toEqual([]);
  });

  it("only the export modules import a PDF or image runtime statically", () => {
    const offenders = appSources("src")
      .filter((f) => !f.startsWith("src/test/") && !f.startsWith("src/features/export/"))
      .filter((f) => staticImports(read(f)).some((s) => EXPORT_RUNTIMES.includes(s)));
    expect(offenders).toEqual([]);
  });
});

describe("launch chunk: libraries", () => {
  it("the Tutorial Library imports sqlite-wasm only when it starts", () => {
    expect(staticImports(read("src/features/tutorial/tutorial-library.ts"))).not.toContain(
      "@/lib/db/memory-database"
    );
  });
});
