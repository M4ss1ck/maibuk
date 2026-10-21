import { describe, expect, it } from "vitest";
import { PluginApiError } from "@/plugin-sdk";
import { excerptOf, libraryCall, readWindow } from "./library";

describe("excerptOf", () => {
  it("collapses whitespace runs and trims", () => {
    expect(excerptOf("  Once   upon\n\ta   time  ")).toBe("Once upon a time");
  });

  it("returns short text as is", () => {
    expect(excerptOf("Hello world")).toBe("Hello world");
    expect(excerptOf("")).toBe("");
    expect(excerptOf("   \n\t  ")).toBe("");
  });

  it("cuts text longer than 150 chars with …", () => {
    const text = "a".repeat(200);
    expect(excerptOf(text)).toBe(`${"a".repeat(150)}…`);
  });

  it("leaves exactly 150 chars alone", () => {
    const text = "b".repeat(150);
    expect(excerptOf(text)).toBe(text);
  });

  it("never splits a surrogate pair at 150", () => {
    const text = `${"a".repeat(149)}😀${"b".repeat(50)}`;
    expect(excerptOf(text)).toBe(`${"a".repeat(149)}…`);
  });

  it("keeps a pair that ends exactly at 150", () => {
    const text = "😀".repeat(100);
    expect(excerptOf(text)).toBe(`${"😀".repeat(75)}…`);
  });
});

describe("readWindow", () => {
  it("defaults to the whole content", () => {
    expect(readWindow("hello")).toEqual({
      window: "hello",
      start: 0,
      end: 5,
      total: 5,
      nextOffset: null,
    });
  });

  it("windows from an offset with a next offset", () => {
    expect(readWindow("hello world", 6, 3)).toEqual({
      window: "wor",
      start: 6,
      end: 9,
      total: 11,
      nextOffset: 9,
    });
  });

  it("caps length at 50,000 chars", () => {
    const content = "a".repeat(60_000);
    const result = readWindow(content, 0, 60_000);
    expect("pastEnd" in result).toBe(false);
    if (!("pastEnd" in result)) {
      expect(result.window.length).toBe(50_000);
      expect(result.end).toBe(50_000);
      expect(result.total).toBe(60_000);
      expect(result.nextOffset).toBe(50_000);
    }
  });

  it("allows offset == total as an empty window", () => {
    expect(readWindow("abc", 3)).toEqual({
      window: "",
      start: 3,
      end: 3,
      total: 3,
      nextOffset: null,
    });
  });

  it("reports an offset past the end", () => {
    expect(readWindow("abc", 4)).toEqual({ pastEnd: true, total: 3 });
  });

  it("never splits a surrogate pair", () => {
    const content = `${"a".repeat(19_999)}😀`;
    const first = readWindow(content);
    expect("pastEnd" in first).toBe(false);
    if (!("pastEnd" in first)) {
      expect(first.end).toBe(19_999);
      expect(first.window).toBe("a".repeat(19_999));
      expect(first.nextOffset).toBe(19_999);
      expect(readWindow(content, first.nextOffset ?? 0)).toEqual({
        window: "😀",
        start: 19_999,
        end: 20_001,
        total: 20_001,
        nextOffset: null,
      });
    }
  });
});

describe("libraryCall", () => {
  const READ_ONLY_TEXT =
    "The author made this Plugin read-only, so it cannot change the Library; use the read tools.";

  it("answers the read-only text when the host refuses a write as permission-denied", async () => {
    const result = await libraryCall(() => {
      throw new PluginApiError({
        code: "permission-denied",
        permission: "library:write",
        message: "Library write needs library:write.",
      });
    });
    expect(result).toEqual({
      content: [{ type: "text", text: READ_ONLY_TEXT }],
      isError: true,
    });
  });

  it("still answers the Tutorial refusal on library-unavailable", async () => {
    const result = await libraryCall(() => {
      throw new PluginApiError({ code: "library-unavailable", message: "Tutorial runs." });
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
  });

  it("rethrows a permission-denied for any other permission", async () => {
    const refusal = new PluginApiError({
      code: "permission-denied",
      permission: "library:read",
      message: "Library read needs library:read.",
    });
    await expect(libraryCall(() => Promise.reject(refusal))).rejects.toBe(refusal);
  });

  it("rethrows any other failure", async () => {
    const failure = new Error("The shelf collapsed.");
    await expect(libraryCall(() => Promise.reject(failure))).rejects.toBe(failure);
  });
});
